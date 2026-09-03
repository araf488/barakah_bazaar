import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AccessTokenService } from '../../modules/auth/tokens/access-token.service';
import { AuthConstants } from '../../modules/auth/auth.constants';
import { SessionService } from '../../modules/auth/sessions/session.service';
import { ApplicationConstants, MetadataKeys } from '../constants/app.constants';
import { ErrorMessages } from '../constants/error-messages.constants';
import { AuthenticatedUser } from '../types/authenticated-user';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/**
 * Registered globally, so every route requires a verified session unless it is marked
 * `@Public()`. Authentication is opt-out by design: forgetting a decorator fails closed.
 *
 * Two stages, deliberately in this order:
 *
 * 1. Verify the access token on CPU alone (`AccessTokenService.verify`) — a forged, expired
 *    or wrong-device token dies here and never reaches Postgres.
 * 2. Ask `SessionService` whether the session behind that token may still act — this is the
 *    only source of truth for revocation, disablement and the caller's *current* role, since
 *    all three can change after the token was signed.
 *
 * Guards are the HTTP authentication boundary, so they signal failure by throwing the
 * matching HttpException rather than returning a value — the global exception filter renders
 * it.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    // So an interceptor can tell an auth failure from an unrelated 401 without parsing a
    // body that is deliberately uninformative.
    response.setHeader('WWW-Authenticate', 'Bearer');

    const token = SessionAuthGuard.bearerToken(request);
    if (!token) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }

    // Stage one: CPU only. A forged, expired or wrong-device token dies here and never
    // reaches Postgres, which is the whole reason the token is a JWT rather than opaque.
    const deviceId = SessionAuthGuard.deviceId(request);
    if (!deviceId) {
      // AccessTokenService.verify would refuse a falsy device id anyway (it treats one as an
      // automatic rejection), but that is a cross-class invariant this guard cannot prove —
      // asserting it here locally removes the non-null assertion below and keeps the same
      // 401 the caller would have gotten either way.
      throw new UnauthorizedException(ErrorMessages.InvalidAccessToken);
    }

    const claims = await this.tokens.verify(token, deviceId, 'access');
    if (!claims) {
      throw new UnauthorizedException(ErrorMessages.InvalidAccessToken);
    }

    // Stage two: the row is the authority on revocation, disablement and role.
    const validated = await this.sessions.validate(claims, deviceId);
    if (!validated.ok) {
      throw new HttpException(validated.message, validated.status);
    }

    request.user = {
      userId: validated.data.user.id,
      sessionId: validated.data.sessionId,
      // Phone-only accounts have no email; empty is honest about that rather than widening
      // AuthenticatedUser.email to optional for every one of its ~40 call sites. Matches the
      // same convention SessionService uses for the access token's own `email` claim.
      email: validated.data.user.email ?? '',
      phone: validated.data.user.phone ?? undefined,
      role: validated.data.user.role,
    };

    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(MetadataKeys.IsPublic, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private static bearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith(ApplicationConstants.BearerPrefix)) {
      return null;
    }
    const token = header.slice(ApplicationConstants.BearerPrefix.length).trim();
    return token.length > 0 ? token : null;
  }

  /**
   * The client's self-declared device identifier, used to bind the access token and the
   * session row to one device. `undefined` when absent or over length, which the caller
   * refuses the same way it refuses a genuinely missing one.
   *
   * Never an array: Node's HTTP parser only produces one for `set-cookie` — repeated
   * `x-device-id` headers arrive pre-joined as a single comma-separated string, which simply
   * fails the length check or matches no binding, so no special casing is needed here.
   */
  private static deviceId(request: Request): string | undefined {
    // Express types every header as `string | string[] | undefined` because that union is
    // shared across all headers; only `set-cookie` is ever actually the array member.
    const value = request.headers[AuthConstants.DeviceIdHeader] as string | undefined;

    if (!value || value.length > AuthConstants.DeviceIdMaxLength) {
      return undefined;
    }

    return value;
  }
}
