import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SupabaseJwtVerifier } from '../../infra/supabase/supabase-jwt.verifier';
import { ApplicationConstants, MetadataKeys } from '../constants/app.constants';
import { ErrorMessages } from '../constants/error-messages.constants';
import { AuthenticatedUser } from '../types/authenticated-user';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

/**
 * Registered globally, so every route requires a verified Supabase access
 * token unless it is marked `@Public()`. Authentication is opt-out by design:
 * forgetting a decorator fails closed.
 *
 * Guards are the HTTP authentication boundary, so they signal failure by
 * throwing the matching HttpException rather than returning a value — the
 * global exception filter renders it.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseJwtVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    if (!this.verifier.isEnabled) {
      throw new ServiceUnavailableException(ErrorMessages.AuthenticationUnavailable);
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = SupabaseAuthGuard.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException(ErrorMessages.MissingAccessToken);
    }

    const user = await this.verifier.verify(token);
    if (!user) {
      throw new UnauthorizedException(ErrorMessages.InvalidAccessToken);
    }

    request.user = user;
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

  private static extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith(ApplicationConstants.BearerPrefix)) {
      return null;
    }
    const token = header.slice(ApplicationConstants.BearerPrefix.length).trim();
    return token.length > 0 ? token : null;
  }
}
