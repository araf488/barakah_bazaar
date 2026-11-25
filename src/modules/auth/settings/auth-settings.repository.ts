import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthSettings } from '../../../infra/prisma/prisma-client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { AuthConstants } from '../auth.constants';

/**
 * Reads the single, singleton `auth_settings` row.
 *
 * There is exactly one row, keyed by `AuthConstants.AuthSettingsRowId`. Failure and absence
 * are reported differently, per the repository contract (`null` for failure, `undefined` for
 * not-found): a fresh install with no row yet is expected and quiet, but a database outage is
 * not — collapsing the two into one `null` would let an outage be silently reported upstream
 * as "row absent; using defaults".
 */
@Injectable()
export class AuthSettingsRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AuthSettingsRepository.name) private readonly logger: PinoLogger,
  ) {}

  /** The settings row; `undefined` when it is absent; `null` when the read itself failed. */
  async load(): Promise<AuthSettings | null | undefined> {
    try {
      const row = await this.prisma.authSettings.findUnique({
        where: { id: AuthConstants.AuthSettingsRowId },
      });
      return row ?? undefined;
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthSettingsRepository.load');
      return null;
    }
  }
}
