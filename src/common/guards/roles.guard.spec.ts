import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../infra/prisma/prisma-client';
import { createExecutionContext } from '../../../test/support/mocks';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const withRequiredRoles = (roles: UserRole[] | undefined): void => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  };

  describe('routes without @Roles', () => {
    it('allows any authenticated caller', () => {
      withRequiredRoles(undefined);
      const { context } = createExecutionContext({ user: { role: UserRole.CUSTOMER } });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows when the metadata is an empty list', () => {
      withRequiredRoles([]);
      const { context } = createExecutionContext({ user: { role: UserRole.CUSTOMER } });

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('routes with @Roles', () => {
    it('allows a caller holding a required role', () => {
      withRequiredRoles([UserRole.SUPER_ADMIN, UserRole.OPS]);
      const { context } = createExecutionContext({ user: { role: UserRole.OPS } });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects a caller holding a different role', () => {
      withRequiredRoles([UserRole.SUPER_ADMIN]);
      const { context } = createExecutionContext({ user: { role: UserRole.CUSTOMER } });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('rejects an unauthenticated request', () => {
      withRequiredRoles([UserRole.SUPER_ADMIN]);
      const { context } = createExecutionContext({});

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('reports the permission message rather than leaking the required role', () => {
      withRequiredRoles([UserRole.WAREHOUSE]);
      const { context } = createExecutionContext({ user: { role: UserRole.CUSTOMER } });

      expect(() => guard.canActivate(context)).toThrow(
        'You do not have permission to perform this action.',
      );
    });
  });
});
