import { PrismaService } from '../../infra/prisma/prisma.service';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { WebMountState } from '../../web/web-mount-state';
import { HealthService } from './health.service';

interface Dependencies {
  databaseUp?: boolean;
  jwtSecretConfigured?: boolean;
  storageConfigured?: boolean;
  queueEnabled?: boolean;
  pingThrows?: boolean;
  webEnabled?: boolean;
  webPrepared?: boolean;
}

const buildService = (options: Dependencies = {}): HealthService => {
  const ping = options.pingThrows
    ? jest.fn().mockRejectedValue(new Error('pool exhausted'))
    : jest.fn().mockResolvedValue(options.databaseUp ?? true);
  const webMountState = new WebMountState();
  if (options.webPrepared) {
    webMountState.markPrepared();
  }

  return new HealthService(
    { ping } as unknown as PrismaService,
    { isConfigured: options.storageConfigured ?? true } as unknown as SupabaseAdminService,
    createMockConfig({
      NODE_ENV: 'test',
      QUEUE_ENABLED: options.queueEnabled ?? false,
      JWT_SECRET: (options.jwtSecretConfigured ?? true) ? 'a'.repeat(32) : undefined,
      WEB_ENABLED: options.webEnabled ?? false,
    }),
    createMockLogger(),
    webMountState,
  );
};

describe('HealthService', () => {
  describe('check', () => {
    it('reports ok when the database answers', async () => {
      const report = await buildService({ databaseUp: true }).check();

      expect(report.status).toBe('ok');
      expect(report.checks.database).toBe('up');
    });

    it('reports degraded when the database is unreachable', async () => {
      const report = await buildService({ databaseUp: false }).check();

      expect(report.status).toBe('degraded');
      expect(report.checks.database).toBe('down');
    });

    it('reports authentication as up when this application has its own signing secret', async () => {
      const report = await buildService({ jwtSecretConfigured: true }).check();

      expect(report.checks.authentication).toBe('up');
    });

    it('reports authentication as down when JWT_SECRET is not configured', async () => {
      // Not "disabled": the app still boots and issues working sessions on a random per-boot
      // secret, but every one of them silently dies on the next restart. An operator needs to
      // see this as a real problem, not a deliberately-off feature.
      const report = await buildService({ jwtSecretConfigured: false }).check();

      expect(report.checks.authentication).toBe('down');
    });

    it('does not treat a missing JWT_SECRET as an overall failure', async () => {
      const report = await buildService({ jwtSecretConfigured: false, databaseUp: true }).check();

      expect(report.status).toBe('ok');
    });

    it('reports storage as disabled when Supabase is unconfigured', async () => {
      const report = await buildService({ storageConfigured: false }).check();

      expect(report.checks.storage).toBe('disabled');
    });

    it('reports the queue as up when it is enabled', async () => {
      const report = await buildService({ queueEnabled: true }).check();

      expect(report.checks.queue).toBe('up');
    });

    it('includes the environment and a version', async () => {
      const report = await buildService().check();

      expect(report.environment).toBe('test');
      expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('includes a whole-second uptime and an ISO timestamp', async () => {
      const report = await buildService().check();

      expect(Number.isInteger(report.uptimeSeconds)).toBe(true);
      expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
    });

    it('reports web as disabled when WEB_ENABLED is off', async () => {
      const report = await buildService({ webEnabled: false }).check();

      expect(report.checks.web).toBe('disabled');
    });

    it('reports web as up once the web mount has been prepared', async () => {
      const report = await buildService({ webEnabled: true, webPrepared: true }).check();

      expect(report.checks.web).toBe('up');
    });

    it('reports web as down while WEB_ENABLED is on but the mount is not prepared', async () => {
      const report = await buildService({ webEnabled: true, webPrepared: false }).check();

      expect(report.checks.web).toBe('down');
    });

    it('does not degrade the overall status while web is down, since the API still serves', async () => {
      const report = await buildService({ webEnabled: true, webPrepared: false }).check();

      expect(report.status).toBe('ok');
    });

    it('reports web as down when the probe itself fails', async () => {
      const report = await buildService({ pingThrows: true, webEnabled: true }).check();

      expect(report.checks.web).toBe('down');
    });

    it('degrades instead of throwing when the probe itself fails', async () => {
      const report = await buildService({ pingThrows: true }).check();

      expect(report.status).toBe('degraded');
      expect(report.checks.database).toBe('down');
    });
  });

  describe('isReady', () => {
    it('is ready when the database is up', async () => {
      await expect(buildService({ databaseUp: true }).isReady()).resolves.toBe(true);
    });

    it('is not ready when the database is down', async () => {
      await expect(buildService({ databaseUp: false }).isReady()).resolves.toBe(false);
    });
  });
});
