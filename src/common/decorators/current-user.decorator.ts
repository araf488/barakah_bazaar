import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Injects the verified caller. Undefined only on `@Public()` routes, which is
 * why the parameter type is nullable at the call site.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    return (request as Request & { user?: AuthenticatedUser }).user;
  },
);
