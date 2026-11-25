import { existsSync, readFileSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { HttpStatus, Logger, LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import { formatMessage } from '../common/constants/error-messages.constants';
import { AppConfigService } from '../config';
import { resolveWebTarget } from './web-route';
import { WebConstants, WebMessages } from './web.constants';

/** The shape of Next's `getRequestHandler()`, narrowed to what the mount calls. */
export type WebRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface WebMountOptions {
  /** `API_PREFIX` — paths under `/${apiPrefix}` pass through to Nest. */
  apiPrefix: string;
  /** The storefront app directory; its `.next` build is what Next serves. */
  storefrontDir: string;
  /** The admin SPA's Vite build output (holds `index.html` and `assets/`). */
  adminDistDir: string;
  /** Validated `WEB_INTERNAL_API_BASE_URL`, exported to `process.env` before Next is prepared. */
  internalApiBaseUrl: string;
  /** Test seam. Defaults to preparing a real Next app with `dev: false`. */
  createNextHandler?: (dir: string) => Promise<WebRequestHandler>;
  /** Defaults to a Nest `Logger`, which forwards to the app's pino logger. */
  logger?: LoggerService;
}

/** The options `main.ts` derives from config; the test seams keep their defaults. */
export type ConfiguredWebMountOptions = Omit<WebMountOptions, 'createNextHandler' | 'logger'>;

/**
 * Prepares Next in production mode from the built `.next` output. Never the dev server: local
 * full-stack work runs `next dev` as its own process. Imported lazily so the API-only path
 * (WEB_ENABLED=false) never loads Next at all.
 */
const prepareNextHandler = async (dir: string): Promise<WebRequestHandler> => {
  const { default: createNextServer } = await import('next/dist/server/next');
  const nextApp = createNextServer({ dev: false, dir });
  await nextApp.prepare();
  return nextApp.getRequestHandler();
};

/** Throws the one startup error naming the missing path; never serve half a site. */
const assertBuildPresent = (path: string): void => {
  if (!existsSync(path)) {
    throw new Error(formatMessage(WebMessages.BuildMissingTemplate, path));
  }
};

const sendText = (res: Response, status: HttpStatus, body: string): void => {
  res.status(status).type(WebConstants.PlainTextContentType).send(body);
};

const failRequest = (res: Response, error: unknown, logger: LoggerService): void => {
  logger.error(error, 'Exception occurred in the web request handler');
  if (res.headersSent) {
    res.end();
    return;
  }
  sendText(res, HttpStatus.INTERNAL_SERVER_ERROR, WebMessages.InternalServerError);
};

/**
 * The admin SPA: hashed assets with a long immutable cache, other build files as-is, and
 * `index.html` (no-cache) for every extension-less path so client-side routes survive a hard
 * refresh. A path with an extension and no file is a 404 — never the SPA shell.
 */
const createAdminHandler = (
  adminDistDir: string,
  indexHtml: string,
  logger: LoggerService,
): ((req: Request, res: Response) => void) => {
  const indexPath = join(adminDistDir, WebConstants.AdminIndexFileName);
  const router = express.Router();
  router.use(
    `${WebConstants.AdminBasePath}/${WebConstants.AdminAssetsSegment}`,
    express.static(join(adminDistDir, WebConstants.AdminAssetsSegment), {
      index: false,
      redirect: false,
      maxAge: WebConstants.AdminAssetMaxAgeMs,
      immutable: true,
    }),
  );
  // redirect: false — serve-static would otherwise 301 `/admin` (a directory) to `/admin/`;
  // the SPA shell below answers both directly.
  router.use(
    WebConstants.AdminBasePath,
    express.static(adminDistDir, {
      index: false,
      redirect: false,
      // A direct GET /admin/index.html revalidates like the SPA fallback below, so a deploy is
      // picked up on refresh. serve-static leaves a Cache-Control set here alone.
      setHeaders: (res, path) => {
        if (path === indexPath) {
          res.setHeader(WebConstants.CacheControlHeader, WebConstants.NoCacheDirective);
        }
      },
    }),
  );
  router.use(WebConstants.AdminBasePath, (req: Request, res: Response) => {
    if (extname(req.path) !== '') {
      sendText(res, HttpStatus.NOT_FOUND, WebMessages.NotFound);
      return;
    }
    res
      .status(HttpStatus.OK)
      .set(WebConstants.CacheControlHeader, WebConstants.NoCacheDirective)
      .type(WebConstants.HtmlContentType)
      .send(indexHtml);
  });

  return (req, res) =>
    router(req, res, (error?: unknown) =>
      error
        ? failRequest(res, error, logger)
        : sendText(res, HttpStatus.NOT_FOUND, WebMessages.NotFound),
    );
};

/**
 * The single Express middleware in front of Nest's router. API paths call `next()` so Nest's
 * router, guards, pipes and JSON 404 answer them exactly as before; web paths are answered
 * here and never reach Nest.
 */
const createWebMiddleware = (
  apiPrefix: string,
  adminHandler: (req: Request, res: Response) => void,
  nextHandler: WebRequestHandler,
  logger: LoggerService,
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const target = resolveWebTarget(req.path, apiPrefix);
      if (target === 'api') {
        next();
        return;
      }
      if (target === 'admin') {
        adminHandler(req, res);
        return;
      }
      nextHandler(req, res).catch((error: unknown) => failRequest(res, error, logger));
    } catch (error) {
      failRequest(res, error, logger);
    }
  };
};

/**
 * Mounts the storefront and the admin SPA in front of Nest's router. Call after
 * `setGlobalPrefix` and the global pipes, and before `init`/`listen`: middleware added through
 * `app.use` before init runs ahead of the routes Nest registers during init.
 */
export const mountWeb = async (
  app: NestExpressApplication,
  options: WebMountOptions,
): Promise<void> => {
  const logger = options.logger ?? new Logger(WebConstants.LoggerContext);
  try {
    assertBuildPresent(join(options.storefrontDir, WebConstants.NextBuildDirName));
    const indexPath = join(options.adminDistDir, WebConstants.AdminIndexFileName);
    assertBuildPresent(indexPath);
    const indexHtml = readFileSync(indexPath, WebConstants.AdminIndexEncoding);

    // The storefront's server-side fetches read this; it must hold the real port before Next
    // loads any page module.
    process.env[WebConstants.InternalApiBaseUrlEnvKey] = options.internalApiBaseUrl;
    const createNextHandler = options.createNextHandler ?? prepareNextHandler;
    const nextHandler = await createNextHandler(options.storefrontDir);

    const adminHandler = createAdminHandler(options.adminDistDir, indexHtml, logger);
    app.use(createWebMiddleware(options.apiPrefix, adminHandler, nextHandler, logger));
    logger.log('Web surfaces mounted: storefront and admin SPA');
  } catch (error) {
    // Rethrown on purpose: a missing build or a Next that will not prepare cannot be recovered
    // from, and startup must stop rather than serve half a site. Logged first so the reason
    // lands in the structured log stream, not only in the unhandled-rejection stack.
    logger.error(error, 'Web mount failed; refusing to start without the web build');
    throw error;
  }
};

/** `main.ts` mounts the web surfaces only when this is true. */
export const shouldMountWeb = (config: AppConfigService): boolean =>
  config.get('WEB_ENABLED', { infer: true });

/** Builds the mount options from validated config and the repository root. */
export const webMountOptionsFrom = (
  config: AppConfigService,
  rootDir: string,
): ConfiguredWebMountOptions => ({
  apiPrefix: config.get('API_PREFIX', { infer: true }),
  storefrontDir: join(rootDir, WebConstants.StorefrontRelativeDir),
  adminDistDir: join(rootDir, WebConstants.AdminDistRelativeDir),
  internalApiBaseUrl: config.get('WEB_INTERNAL_API_BASE_URL', { infer: true }),
});
