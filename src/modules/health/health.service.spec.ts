import { PrismaService } from '../../infra/prisma/prisma.service';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { SupabaseJwtVerifier } from '../../infra/supabase/supabase-jwt.verifier';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { HealthService } from './health.service';

interface Dependencies {
  databaseUp?: boolean;
  authEnabled?: boolean;
  storageConfigured?: boolean;
  queueEnabled?: boolean;
  pingThrows?: boolean;
}

const buildService = (options: Dependencies = {}): HealthService => {
  const ping = options.pingThrows
    ? jest.fn().mockRejectedValue(new Error('pool exhausted'))
    : jest.fn().mockResolvedValue(options.databaseUp ?? true);

  return new HealthService(
    { ping } as unknown as PrismaService,
    { isEnabled: options.authEnabled ?? true } as unknown as SupabaseJwtVerifier,
    { isConfigured: options.storageConfigured ?? true } as unknown as SupabaseAdminService,
    createMockConfig({
      NODE_ENV: 'test',
      QUEUE_ENABLED: options.queueEnabled ?? false,
    }),
    createMockLogger(),
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

    it('reports authentication as disabled rather than down when unconfigured', async () => {
      const report = await buildService({ authEnabled: false }).check();

      expect(report.checks.authentication).toBe('disabled');
    });

    it('does not treat unconfigured authentication as an overall failure', async () => {
      const report = await buildService({ authEnabled: false, databaseUp: true }).check();

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
