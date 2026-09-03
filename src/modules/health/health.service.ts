import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicationConstants } from '../../common/constants/app.constants';
import { SERVICE_VERSION } from '../../common/service-version';
import { AppConfigService } from '../../config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SupabaseAdminService } from '../../infra/supabase/supabase-admin.service';
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
          // This application signs and verifies its own session tokens (SessionAuthGuard,
          // AccessTokenService) — there is no third-party identity provider left to be
          // "unconfigured". What can actually go wrong is JWT_SECRET being unset: the app
          // still boots and issues working sessions on a random per-process secret, but every
          // one of them dies silently on the next restart. 'down', not 'disabled': this is a
          // real operational hazard the operator needs to see, not a deliberately-off feature.
          authentication: this.config.get('JWT_SECRET', { infer: true }) ? 'up' : 'down',
          storage: this.supabase.isConfigured ? 'up' : 'disabled',
          queue: this.config.get('QUEUE_ENABLED', { infer: true }) ? 'up' : 'disabled',
          // Third-party capabilities, each selected by a <THING>_PROVIDER env enum that
          // defaults to noop. 'disabled' rather than 'down': nothing is broken, the capability
          // is deliberately off, and a fresh clone boots with all four this way.
          sms: HealthService.providerStatus(this.config.get('SMS_PROVIDER', { infer: true })),
          email: HealthService.providerStatus(this.config.get('EMAIL_PROVIDER', { infer: true })),
          payment: HealthService.providerStatus(
            this.config.get('PAYMENT_PROVIDER', { infer: true }),
          ),
          geocoding: HealthService.providerStatus(
            this.config.get('GEOCODING_PROVIDER', { infer: true }),
          ),
        },
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in HealthService.check');
      return HealthService.unknownReport(this.config.get('NODE_ENV', { infer: true }));
    }
  }

  /**
   * A capability is 'disabled' when its provider is noop, 'up' otherwise.
   *
   * It reports what the operator asked for, not whether an adapter exists — a provider named
   * without an adapter is a misconfiguration, and the boot-time error log is where that
   * belongs. Health saying 'up' for a setting that does nothing would be the same silent lie
   * this pattern exists to prevent, so the two are read together.
   */
  private static providerStatus(provider: string): ComponentStatus {
    return provider === 'noop' ? 'disabled' : 'up';
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
        // 'down' rather than 'disabled' here: this report is produced when the check itself
        // threw, so nothing is known about any capability — claiming one is deliberately off
        // would assert something this path cannot see.
        sms: 'down',
        email: 'down',
        payment: 'down',
        geocoding: 'down',
      },
    };
  }
}
