import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationConstants } from '../../common/constants/app.constants';
import { SERVICE_VERSION } from '../../common/service-version';
import { AppConfigService } from '../../config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
import { SupabaseJwtVerifier } from '../../infra/supabase/supabase-jwt.verifier';
import { ComponentStatus, HealthReport } from './health.types';

const SECONDS_PER_MILLISECOND = 1000;

/**
 * Reports what this instance can actually do right now.
 *
 * Deliberately dependency-tolerant: an unconfigured Supabase project or a
 * missing Redis is reported, not thrown, so a fresh clone starts and tells the
 * developer what is still missing.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verifier: SupabaseJwtVerifier,
    private readonly supabase: SupabaseAdminService,
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(HealthService.name) private readonly logger: PinoLogger,
  ) {}

  async check(): Promise<HealthReport> {
    try {
      const database: ComponentStatus = (await this.prisma.ping()) ? 'up' : 'down';

      return {
        status: database === 'up' ? 'ok' : 'degraded',
        service: ApplicationConstants.ServiceName,
        version: SERVICE_VERSION,
        environment: this.config.get('NODE_ENV', { infer: true }),
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: {
          database,
          authentication: this.verifier.isEnabled ? 'up' : 'disabled',
          storage: this.supabase.isConfigured ? 'up' : 'disabled',
          queue: this.config.get('QUEUE_ENABLED', { infer: true }) ? 'up' : 'disabled',
        },
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in HealthService.check');
      return HealthService.unknownReport(this.config.get('NODE_ENV', { infer: true }));
    }
  }

  /** True when this instance can serve requests that touch the database. */
  async isReady(): Promise<boolean> {
    const report = await this.check();
    return report.checks.database === 'up';
  }

  private static unknownReport(environment: string): HealthReport {
    return {
      status: 'degraded',
      service: ApplicationConstants.ServiceName,
      version: SERVICE_VERSION,
      environment,
      uptimeSeconds:
        Math.floor(process.uptime() * SECONDS_PER_MILLISECOND) / SECONDS_PER_MILLISECOND,
      timestamp: new Date().toISOString(),
      checks: {
        database: 'down',
        authentication: 'down',
        storage: 'down',
        queue: 'down',
      },
    };
  }
}
