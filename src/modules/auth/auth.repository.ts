import { Injectable } from '@nestjs/common';
import { User } from '../../infra/prisma/prisma-client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Persistence for the local mirror of Supabase Auth users.
 *
 * Returns null on failure instead of throwing, so the caller branches on a
 * value rather than unwinding — a database fault must not surface as an
 * unhandled 500.
 */
@Injectable()
export class AuthRepository {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AuthRepository.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Creates or refreshes the local row for a verified token.
   *
   * `role` is mirrored from the token on every call: Supabase
   * `app_metadata.role` is the single source of truth for authorization, and
   * the admin module writes it through the Supabase Admin API. Keeping this
   * column as a mirror avoids two divergent answers to "what can this user do".
   */
  async upsertFromToken(authenticated: AuthenticatedUser): Promise<User | null> {
    try {
      const seenAt = new Date();
      return await this.prisma.user.upsert({
        where: { supabaseUserId: authenticated.supabaseUserId },
        create: {
          supabaseUserId: authenticated.supabaseUserId,
          email: authenticated.email ?? null,
          phone: authenticated.phone ?? null,
          role: authenticated.role,
          lastSeenAt: seenAt,
        },
        update: {
          email: authenticated.email ?? null,
          phone: authenticated.phone ?? null,
          role: authenticated.role,
          lastSeenAt: seenAt,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId: authenticated.supabaseUserId },
        'Exception occurred in AuthRepository.upsertFromToken',
      );
      return null;
    }
  }

  /**
   * Reads the local row for a verified token without provisioning it.
   *
   * Three-valued on purpose: `undefined` means there is no such row, `null` means the read
   * itself failed. Collapsing them would answer "user not found" to a caller holding a
   * perfectly valid token during a database outage — a 404 that sends everyone hunting in
   * the wrong place.
   */
  /**
   * Looks a user up by email, case-insensitively.
   *
   * Used to refuse a staff invitation to an address that already has an account: two paths to
   * the same state invite drift, and changing a role is the other endpoint.
   */
  async findByEmail(email: string): Promise<User | null | undefined> {
    try {
      return (
        (await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        })) ?? undefined
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Exception occurred in AuthRepository.findByEmail');
      return null;
    }
  }

  async findBySupabaseId(supabaseUserId: string): Promise<User | null | undefined> {
    try {
      return (await this.prisma.user.findUnique({ where: { supabaseUserId } })) ?? undefined;
    } catch (error) {
      this.logger.error(
        { err: error, supabaseUserId },
        'Exception occurred in AuthRepository.findBySupabaseId',
      );
      return null;
    }
  }
}
