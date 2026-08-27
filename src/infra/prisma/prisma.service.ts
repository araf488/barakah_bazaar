import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config';
import { PrismaClient } from './prisma-client';

/**
 * Placeholder connection string used when DATABASE_URL is unset, so
 * constructing the adapter cannot throw at boot. Nothing will connect to it —
 * that is the point: /health reports the database as down instead.
 */
const UNCONFIGURED_DATASOURCE_URL =
  'postgresql://unconfigured:unconfigured@127.0.0.1:5432/postgres';

/**
 * Prisma client bound to Supabase Postgres through the `pg` driver adapter,
 * which is how Prisma 7 takes a connection string at runtime.
 *
 * Connection is attempted at boot but a failure does not stop the app: the
 * service records the outcome and /health reports the database as down. That
 * keeps a fresh clone runnable before a Supabase project exists, and means a
 * transient database outage does not turn into a crash-loop.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private connected = false;

  constructor(
    @Inject(ConfigService) config: AppConfigService,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    const connectionString =
      config.get('DATABASE_URL', { infer: true }) ?? UNCONFIGURED_DATASOURCE_URL;

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();

      // `$connect()` on a driver adapter is lazy: it resolves without proving
      // the host is reachable or the credentials are valid. Only a real
      // round-trip can, so claim a connection off the query, not the connect —
      // otherwise the log says "connected" while /health says "down".
      this.connected = await this.ping();

      if (this.connected) {
        this.logger.info('Connected to Postgres');
        return;
      }

      this.logger.error('Postgres is unreachable at boot; the API will run in degraded mode');
    } catch (error) {
      this.connected = false;
      this.logger.error(
        { err: error },
        'Could not connect to Postgres at boot; the API will run in degraded mode',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to disconnect the Prisma client cleanly');
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Liveness probe for /health. Never throws. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      this.connected = true;
      return true;
    } catch (error) {
      this.connected = false;
      this.logger.warn({ err: error }, 'Postgres ping failed');
      return false;
    }
  }
}
