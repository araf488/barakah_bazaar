import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  LoggerService,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import request from 'supertest';
import { mountWeb, WebRequestHandler } from './web-mount';

/**
 * Proves the mount order against a real Nest + Express app: API traffic reaches Nest's router
 * and guard chain, web traffic never does. Next is replaced by a stub handler (no real Next
 * app is ever prepared here) and the build output by a temp directory.
 */

/** Every path the stub guard was asked about — a web path showing up here is the bug. */
const guardedPaths: string[] = [];

/**
 * Stands in for SessionAuthGuard (ruling R1): rejects any request without a bearer token. The
 * real guard needs a database; Task 4's smoke test exercises it against the real image.
 */
@Injectable()
class StubTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    guardedPaths.push(req.path);
    if (!req.headers.authorization) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Controller('probe')
class ProbeController {
  @Get('secret')
  secret(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({
  controllers: [ProbeController],
  providers: [{ provide: APP_GUARD, useClass: StubTokenGuard }],
})
class ProbeModule {}

const stubNextHandler: WebRequestHandler = (req: IncomingMessage, res: ServerResponse) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`next:${req.url ?? ''}`);
  return Promise.resolve();
};

const createSilentLogger = (): jest.Mocked<LoggerService> => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
});

interface Harness {
  app: NestExpressApplication;
  root: string;
  logger: jest.Mocked<LoggerService>;
}

const createHarness = async (nextHandler: WebRequestHandler): Promise<Harness> => {
  const root = mkdtempSync(join(tmpdir(), 'web-mount-int-'));
  const storefrontDir = join(root, 'storefront');
  mkdirSync(join(storefrontDir, '.next'), { recursive: true });

  const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  // Same order as main.ts: prefix and pipes first, then the mount, then init/listen.
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  const logger = createSilentLogger();
  await mountWeb(app, {
    apiPrefix: 'api',
    storefrontDir,
    internalApiBaseUrl: 'http://127.0.0.1:3000/api/v1',
    createNextHandler: () => Promise.resolve(nextHandler),
    logger,
  });
  await app.init();
  await app.listen(0);
  return { app, root, logger };
};

const closeHarness = async (harness: Harness | undefined): Promise<void> => {
  await harness?.app.close();
  if (harness) {
    rmSync(harness.root, { recursive: true, force: true });
  }
};

describe('mountWeb (integration)', () => {
  let harness: Harness;
  const http = () => request(harness.app.getHttpServer());

  beforeAll(async () => {
    harness = await createHarness(stubNextHandler);
  });

  afterAll(async () => {
    await closeHarness(harness);
  });

  beforeEach(() => {
    guardedPaths.length = 0;
  });

  describe('API paths reach Nest', () => {
    it('answers an unknown API route with Nest JSON 404, never a Next page', async () => {
      const response = await http().get('/api/v1/nope');

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toEqual({
        message: 'Cannot GET /api/v1/nope',
        error: 'Not Found',
        statusCode: 404,
      });
    });

    it('answers an unknown POST under an API resource with Nest JSON 404', async () => {
      const response = await http().post('/api/v1/orders/x/unknown').send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        message: 'Cannot POST /api/v1/orders/x/unknown',
        error: 'Not Found',
        statusCode: 404,
      });
    });

    it.each(['/api', '/api/', '/api/v2/x'])(
      'answers %s with Nest JSON 404 because it sits under API_PREFIX',
      async (path) => {
        const response = await http().get(path);

        expect(response.status).toBe(404);
        expect(response.headers['content-type']).toMatch(/^application\/json/);
        expect(response.body.statusCode).toBe(404);
      },
    );

    it('runs the global guard on an API route: no token answers 401 JSON', async () => {
      const response = await http().get('/api/v1/probe/secret');

      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.body).toEqual({ message: 'Unauthorized', statusCode: 401 });
      expect(guardedPaths).toEqual(['/api/v1/probe/secret']);
    });

    it('lets a tokened API request through the guard to the controller', async () => {
      const response = await http()
        .get('/api/v1/probe/secret')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });

  describe('web paths never reach a guard', () => {
    it('sends / to the Next handler', async () => {
      const response = await http().get('/');

      expect(response.status).toBe(200);
      expect(response.text).toBe('next:/');
    });

    it.each(['/administrator', '/apiary', '/API/v1/x', '/products/dates?page=2'])(
      'sends %s to the Next handler',
      async (path) => {
        const response = await http().get(path);

        expect(response.status).toBe(200);
        expect(response.text).toBe(`next:${path}`);
      },
    );

    it('serves web paths without the guard ever running', async () => {
      await http().get('/');
      await http().get('/admin');
      await http().get('/admin/orders/1');
      await http().get('/administrator');

      expect(guardedPaths).toEqual([]);
    });
  });

  describe('admin paths', () => {
    it.each(['/admin', '/admin/orders/1'])('sends %s to the Next handler', async (path) => {
      const response = await http().get(path);

      expect(response.status).toBe(200);
      expect(response.text).toBe(`next:${path}`);
      expect(guardedPaths).toEqual([]);
    });
  });
});

describe('mountWeb (integration) — a failing Next handler', () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await closeHarness(harness);
    harness = undefined;
  });

  it('answers 500 and logs the error first with a literal message', async () => {
    const failure = new Error('render exploded');
    harness = await createHarness(() => Promise.reject(failure));

    const response = await request(harness.app.getHttpServer()).get('/');

    expect(response.status).toBe(500);
    expect(response.text).toBe('Internal Server Error');
    expect(harness.logger.error).toHaveBeenCalledWith(
      failure,
      'Exception occurred in the web request handler',
    );
  });
});
