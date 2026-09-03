import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../infra/prisma/prisma-client';
import { Request } from 'express';
import { MetadataKeys } from '../constants/app.constants';
import { ErrorMessages } from '../constants/error-messages.constants';
import { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Enforces `@Roles(...)`. Runs after SessionAuthGuard, so a request reaching
 * it is already authenticated; a route with no `@Roles` metadata is open to
 * any authenticated caller.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(MetadataKeys.Roles, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const role = request.user?.role;

    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException(ErrorMessages.InsufficientPermission);
    }

    return true;
  }
}
