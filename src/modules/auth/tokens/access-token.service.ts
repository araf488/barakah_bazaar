import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../../../config';
import { UserRole } from '../../../infra/prisma/prisma-client';
import { AuthConstants } from '../auth.constants';

export type TokenType = 'access' | 'mfa' | 'enrolment';

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly role: UserRole;
  readonly email: string;
  readonly type: TokenType;
}

/**
 * Signs and verifies this application's own access tokens.
 *
 * Deliberately not a Supabase token: nothing outside this service issues a credential it
 * will accept. HS256 with one shared secret, because exactly one service both signs and
 * verifies — an asymmetric keypair earns its keep only when a second service must verify
 * without holding the signing secret.
 *
 * Verification is stage one of the guard: it runs on CPU alone, so a forged, expired or
 * wrong-device token is rejected without a database query.
 */
@Injectable()
export class AccessTokenService {
  private readonly secret: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    @Inject(ConfigService) config: AppConfigService,
    @InjectPinoLogger(AccessTokenService.name) private readonly logger: PinoLogger,
  ) {
    const configured = config.get('JWT_SECRET', { infer: true });

    if (!configured) {
      // A shipped default secret would be a forged-token factory. A random one keeps a
      // fresh clone booting; sessions simply do not survive a restart.
      this.logger.warn(
        'JWT_SECRET is not set — using a random secret; sessions will not survive a restart',
      );
    }

    this.secret = new TextEncoder().encode(
      configured ?? randomBytes(AuthConstants.JwtSecretBytes).toString('base64'),
    );
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.audience = config.get('JWT_AUDIENCE', { infer: true });
  }

  /** SHA-256 of the device id. Only the device id — see the spec, §5.6. */
  static bindingFor(deviceId: string): string {
    return createHash('sha256').update(deviceId).digest('base64url');
  }

  async sign(
    claims: Omit<AccessTokenClaims, 'type'> & { deviceId: string },
    ttlMinutes: number,
    type: TokenType = 'access',
  ): Promise<string> {
    try {
      return await new SignJWT({
        sid: claims.sessionId,
        typ: type,
        role: claims.role,
        email: claims.email,
        bnd: AccessTokenService.bindingFor(claims.deviceId),
      })
        .setProtectedHeader({ alg: AuthConstants.JwtAlgorithm })
        .setSubject(claims.userId)
        .setIssuedAt()
        .setIssuer(this.issuer)
        .setAudience(this.audience)
        .setExpirationTime(`${ttlMinutes}m`)
        .sign(this.secret);
    } catch (error) {
      // No safe default exists for a token that failed to sign — returning one anyway (or a
      // sentinel string) would be a credential-shaped value nothing can verify. This layer
      // logs, for the caller's context, and rethrows rather than swallowing it.
      this.logger.error({ err: error }, 'Exception occurred in AccessTokenService.sign');
      throw error;
    }
  }

  /** Null for any failure. The caller answers 401 without saying which check failed. */
  async verify(
    token: string,
    deviceId: string | undefined,
    expected: TokenType,
  ): Promise<AccessTokenClaims | null> {
    if (!deviceId) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: AuthConstants.JwtClockToleranceSeconds,
        // Pins verification to the same algorithm `sign` uses. `this.secret` is a raw HMAC
        // key today, which already confines jose to the HS family, so this is presently
        // belt-and-braces — but it is the line that keeps pinning true if the key is ever
        // swapped for a KeyObject, a JWK, or a JWKS resolver.
        algorithms: [AuthConstants.JwtAlgorithm],
        // A correctly signed token missing one of these could still pass issuer/audience/
        // expiry and fall through with an `undefined` claim (e.g. `userId: "undefined"`).
        // The `typ`/`bnd` checks below would still catch it, but this makes the requirement
        // structural rather than incidental to those checks running afterward.
        requiredClaims: ['sub', 'sid', 'typ', 'bnd'],
      });

      if (payload.typ !== expected) {
        return null;
      }
      if (!AccessTokenService.bindingMatches(payload.bnd, deviceId)) {
        return null;
      }

      return {
        userId: String(payload.sub),
        sessionId: String(payload.sid),
        role: payload.role as UserRole,
        email: String(payload.email),
        type: expected,
      };
    } catch (error) {
      // Expired and forged are both expected traffic, not faults — debug, not error — but
      // the error object is still worth keeping: it is what tells a misconfiguration (e.g.
      // a wrong key type) apart from routine expiry. jose's messages carry no token material.
      this.logger.debug({ err: error }, 'Access token failed verification');
      return null;
    }
  }

  private static bindingMatches(claimed: unknown, deviceId: string): boolean {
    if (typeof claimed !== 'string') {
      return false;
    }
    const expected = Buffer.from(AccessTokenService.bindingFor(deviceId));
    const actual = Buffer.from(claimed);

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
