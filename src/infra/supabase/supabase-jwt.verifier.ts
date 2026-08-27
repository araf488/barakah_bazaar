import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../prisma/prisma-client';
import { JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../config';
import { AuthenticatedUser } from '../../common/types/authenticated-user';

/** How the verifier was configured at boot. */
export type JwtVerifierMode = 'jwks' | 'secret' | 'disabled';

/** Path Supabase serves its signing keys from, relative to the project URL. */
const JWKS_PATH = '/auth/v1/.well-known/jwks.json';

type RemoteKeySet = ReturnType<typeof createRemoteJWKSet>;

interface SupabaseClaims extends JWTPayload {
  email?: string;
  phone?: string;
  app_metadata?: { role?: string };
}

/**
 * Verifies Supabase Auth access tokens locally — no network round-trip per
 * request for the symmetric case, and a cached, auto-rotating key set for the
 * asymmetric one.
 *
 * Configuration precedence is deliberate: an explicit `SUPABASE_JWKS_URL`
 * wins, then a legacy `SUPABASE_JWT_SECRET` (HS256), and only then a JWKS URL
 * derived from `SUPABASE_URL`. Checking the explicit secret before the derived
 * URL is what keeps older HS256 projects working when both vars are set.
 *
 * With none of them configured the verifier reports `disabled` and the app
 * still boots — protected routes then answer 503 rather than crashing at
 * startup, so a fresh clone runs before a Supabase project exists.
 */
@Injectable()
export class SupabaseJwtVerifier implements OnModuleInit {
  private mode: JwtVerifierMode = 'disabled';
  private secretKey: Uint8Array | null = null;
  private keySet: RemoteKeySet | null = null;
  private audience = 'authenticated';

  constructor(
    @Inject(ConfigService) private readonly config: AppConfigService,
    @InjectPinoLogger(SupabaseJwtVerifier.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.configure();
  }

  get currentMode(): JwtVerifierMode {
    return this.mode;
  }

  get isEnabled(): boolean {
    return this.mode !== 'disabled';
  }

  /** Returns the caller, or null when the token is absent/invalid/expired. */
  async verify(token: string): Promise<AuthenticatedUser | null> {
    try {
      const claims = await this.verifyClaims(token);
      return claims ? SupabaseJwtVerifier.toAuthenticatedUser(claims) : null;
    } catch (error) {
      // Verification failure is an expected outcome, not a fault: log at debug
      // so an expired token does not fill the error budget.
      this.logger.debug({ err: error }, 'Access token verification failed');
      return null;
    }
  }

  private async verifyClaims(token: string): Promise<SupabaseClaims | null> {
    const options = { audience: this.audience };

    if (this.mode === 'secret' && this.secretKey) {
      const { payload } = await jwtVerify<SupabaseClaims>(token, this.secretKey, options);
      return payload;
    }

    if (this.mode === 'jwks' && this.keySet) {
      const { payload } = await jwtVerify<SupabaseClaims>(token, this.keySet, options);
      return payload;
    }

    return null;
  }

  private configure(): void {
    this.audience = this.config.get('SUPABASE_JWT_AUDIENCE', { infer: true });

    const explicitJwksUrl = this.config.get('SUPABASE_JWKS_URL', { infer: true });
    if (explicitJwksUrl) {
      this.useJwks(explicitJwksUrl);
      return;
    }

    const secret = this.config.get('SUPABASE_JWT_SECRET', { infer: true });
    if (secret) {
      this.secretKey = new TextEncoder().encode(secret);
      this.mode = 'secret';
      this.logger.info('JWT verification configured with the project JWT secret (HS256)');
      return;
    }

    const projectUrl = this.config.get('SUPABASE_URL', { infer: true });
    if (projectUrl) {
      this.useJwks(new URL(JWKS_PATH, projectUrl).toString());
      return;
    }

    this.mode = 'disabled';
    this.logger.warn(
      'JWT verification is DISABLED: set SUPABASE_JWKS_URL, SUPABASE_JWT_SECRET or SUPABASE_URL. Protected routes will answer 503.',
    );
  }

  private useJwks(url: string): void {
    this.keySet = createRemoteJWKSet(new URL(url));
    this.mode = 'jwks';
    this.logger.info({ jwksUrl: url }, 'JWT verification configured with a remote key set');
  }

  private static toAuthenticatedUser(claims: SupabaseClaims): AuthenticatedUser | null {
    if (!claims.sub) {
      return null;
    }
    return {
      supabaseUserId: claims.sub,
      email: claims.email,
      phone: claims.phone,
      role: SupabaseJwtVerifier.parseRole(claims.app_metadata?.role),
      issuedAt: claims.iat,
      expiresAt: claims.exp,
    };
  }

  /**
   * Maps the `app_metadata.role` claim onto a known role. Anything absent or
   * unrecognised is treated as a plain customer — privilege is never inferred
   * from an unexpected value.
   */
  private static parseRole(claimed: string | undefined): UserRole {
    if (!claimed) {
      return UserRole.CUSTOMER;
    }
    const normalized = claimed.trim().toUpperCase().replace(/-/g, '_');
    const known = Object.values(UserRole).find((role) => role === normalized);
    return known ?? UserRole.CUSTOMER;
  }
}
