import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggerService } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createMockConfig } from '../../test/support/mocks';
import { WebMountState } from './web-mount-state';
import { mountWeb, shouldMountWeb, WebMountOptions, webMountOptionsFrom } from './web-mount';

const INTERNAL_API_BASE_URL = 'http://127.0.0.1:4321/api/v1';

interface Fixture {
  root: string;
  storefrontDir: string;
  adminDistDir: string;
}

/** A temp directory laid out like a finished `npm run web:build`, minus whatever is skipped. */
const createFixture = (skip: { nextBuild?: boolean; adminIndex?: boolean } = {}): Fixture => {
  const root = mkdtempSync(join(tmpdir(), 'web-mount-spec-'));
  const storefrontDir = join(root, 'storefront');
  const adminDistDir = join(root, 'admin-dist');
  mkdirSync(storefrontDir, { recursive: true });
  mkdirSync(adminDistDir, { recursive: true });
  if (!skip.nextBuild) {
    mkdirSync(join(storefrontDir, '.next'));
  }
  if (!skip.adminIndex) {
    writeFileSync(join(adminDistDir, 'index.html'), '<title>Barakah Bazaar Admin</title>');
  }
  return { root, storefrontDir, adminDistDir };
};

const createLogger = (): jest.Mocked<LoggerService> => ({
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
});

const createApp = (): { app: NestExpressApplication; use: jest.Mock } => {
  const use = jest.fn();
  return { app: { use } as unknown as NestExpressApplication, use };
};

describe('mountWeb', () => {
  let fixture: Fixture | undefined;
  const originalInternalBaseUrl = process.env.WEB_INTERNAL_API_BASE_URL;

  afterEach(() => {
    if (fixture) {
      rmSync(fixture.root, { recursive: true, force: true });
      fixture = undefined;
    }
    if (originalInternalBaseUrl === undefined) {
      delete process.env.WEB_INTERNAL_API_BASE_URL;
    } else {
      process.env.WEB_INTERNAL_API_BASE_URL = originalInternalBaseUrl;
    }
  });

  const optionsFor = (current: Fixture, overrides: Partial<WebMountOptions> = {}) => ({
    apiPrefix: 'api',
    storefrontDir: current.storefrontDir,
    adminDistDir: current.adminDistDir,
    internalApiBaseUrl: INTERNAL_API_BASE_URL,
    createNextHandler: jest.fn().mockResolvedValue(jest.fn()),
    logger: createLogger(),
    ...overrides,
  });

  describe('missing build output', () => {
    it('fails naming the storefront .next path when the storefront was never built', async () => {
      fixture = createFixture({ nextBuild: true });
      const { app } = createApp();

      await expect(mountWeb(app, optionsFor(fixture))).rejects.toThrow(
        `WEB_ENABLED=true but the web build output is missing: ${fixture.storefrontDir}/.next. Run "npm run web:build" before starting.`,
      );
    });

    it('fails naming the admin index.html path when the admin was never built', async () => {
      fixture = createFixture({ adminIndex: true });
      const { app } = createApp();

      await expect(mountWeb(app, optionsFor(fixture))).rejects.toThrow(
        `WEB_ENABLED=true but the web build output is missing: ${fixture.adminDistDir}/index.html. Run "npm run web:build" before starting.`,
      );
    });

    it('never prepares Next and never mounts anything when a build is missing, so half a site is never served', async () => {
      fixture = createFixture({ adminIndex: true });
      const { app, use } = createApp();
      const options = optionsFor(fixture);

      await expect(mountWeb(app, options)).rejects.toThrow(Error);

      expect(options.createNextHandler).not.toHaveBeenCalled();
      expect(use).not.toHaveBeenCalled();
    });

    it('logs the failure with the error first and a literal message', async () => {
      fixture = createFixture({ nextBuild: true });
      const { app } = createApp();
      const options = optionsFor(fixture);

      await expect(mountWeb(app, options)).rejects.toThrow(Error);

      expect(options.logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Web mount failed; refusing to start without the web build',
      );
    });
  });

  describe('a complete build', () => {
    it('prepares Next from the storefront directory', async () => {
      fixture = createFixture();
      const { app } = createApp();
      const options = optionsFor(fixture);

      await mountWeb(app, options);

      expect(options.createNextHandler).toHaveBeenCalledWith(fixture.storefrontDir);
    });

    it('sets WEB_INTERNAL_API_BASE_URL before Next is prepared, so server-side fetches hit the real port', async () => {
      fixture = createFixture();
      delete process.env.WEB_INTERNAL_API_BASE_URL;
      const { app } = createApp();
      let seenAtPrepare: string | undefined;
      const options = optionsFor(fixture, {
        createNextHandler: jest.fn().mockImplementation(() => {
          seenAtPrepare = process.env.WEB_INTERNAL_API_BASE_URL;
          return Promise.resolve(jest.fn());
        }),
      });

      await mountWeb(app, options);

      expect(seenAtPrepare).toBe('http://127.0.0.1:4321/api/v1');
    });

    it('registers exactly one Express middleware', async () => {
      fixture = createFixture();
      const { app, use } = createApp();

      await mountWeb(app, optionsFor(fixture));

      expect(use).toHaveBeenCalledTimes(1);
      expect(use).toHaveBeenCalledWith(expect.any(Function));
    });

    it('fails and mounts nothing when preparing Next throws', async () => {
      fixture = createFixture();
      const { app, use } = createApp();
      const options = optionsFor(fixture, {
        createNextHandler: jest.fn().mockRejectedValue(new Error('next prepare failed')),
      });

      await expect(mountWeb(app, options)).rejects.toThrow('next prepare failed');

      expect(use).not.toHaveBeenCalled();
    });
  });
});

describe('shouldMountWeb', () => {
  it('is false when WEB_ENABLED is off, so main.ts never calls mountWeb', () => {
    expect(shouldMountWeb(createMockConfig({ WEB_ENABLED: false }))).toBe(false);
  });

  it('is true when WEB_ENABLED is on', () => {
    expect(shouldMountWeb(createMockConfig({ WEB_ENABLED: true }))).toBe(true);
  });
});

describe('webMountOptionsFrom', () => {
  it('derives the build directories from the repository root and passes the API prefix and internal URL through', () => {
    const options = webMountOptionsFrom(
      createMockConfig({
        API_PREFIX: 'api',
        WEB_INTERNAL_API_BASE_URL: 'http://127.0.0.1:3000/api/v1',
      }),
      '/srv/app',
    );

    expect(options).toEqual({
      apiPrefix: 'api',
      storefrontDir: '/srv/app/web/apps/storefront',
      adminDistDir: '/srv/app/web/apps/admin/dist',
      internalApiBaseUrl: 'http://127.0.0.1:3000/api/v1',
    });
  });
});

describe('WebMountState', () => {
  it('starts unprepared', () => {
    expect(new WebMountState().isPrepared).toBe(false);
  });

  it('is prepared once marked', () => {
    const state = new WebMountState();

    state.markPrepared();

    expect(state.isPrepared).toBe(true);
  });
});
