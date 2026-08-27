import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../infra/prisma/prisma-client';
import { SupabaseJwtVerifier } from '../../infra/supabase/supabase-jwt.verifier';
import { AuthenticatedUser } from '../types/authenticated-user';
import { createExecutionContext } from '../../../test/support/mocks';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const verifiedUser: AuthenticatedUser = {
  supabaseUserId: '11111111-1111-1111-1111-111111111111',
  email: 'customer@example.com',
  role: UserRole.CUSTOMER,
};

describe('SupabaseAuthGuard', () => {
  let reflector: Reflector;
  let verifier: { isEnabled: boolean; verify: jest.Mock };
  let guard: SupabaseAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    verifier = { isEnabled: true, verify: jest.fn() };
    guard = new SupabaseAuthGuard(reflector, verifier as unknown as SupabaseJwtVerifier);
  });

  const markPublic = (isPublic: boolean): void => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic ? true : undefined);
  };

  describe('public routes', () => {
    it('allows a request with no token', async () => {
      markPublic(true);
      const { context } = createExecutionContext({});

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('does not attempt verification', async () => {
      markPublic(true);
      const { context } = createExecutionContext({ headers: { authorization: 'Bearer abc' } });

      await guard.canActivate(context);

      expect(verifier.verify).not.toHaveBeenCalled();
    });
  });

  describe('protected routes', () => {
    beforeEach(() => markPublic(false));

    it('attaches the verified user to the request', async () => {
      verifier.verify.mockResolvedValue(verifiedUser);
      const { context, request } = createExecutionContext({
        headers: { authorization: 'Bearer valid-token' },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(verifiedUser);
    });

    it('passes only the token, without the Bearer prefix, to the verifier', async () => {
      verifier.verify.mockResolvedValue(verifiedUser);
      const { context } = createExecutionContext({
        headers: { authorization: 'Bearer valid-token' },
      });

      await guard.canActivate(context);

      expect(verifier.verify).toHaveBeenCalledWith('valid-token');
    });

    it('rejects a request with no Authorization header', async () => {
      const { context } = createExecutionContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a non-Bearer scheme', async () => {
      const { context } = createExecutionContext({ headers: { authorization: 'Basic abc123' } });

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Authentication is required to access this resource.',
      );
    });

    it('rejects an empty Bearer token', async () => {
      const { context } = createExecutionContext({ headers: { authorization: 'Bearer    ' } });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token the verifier refuses', async () => {
      verifier.verify.mockResolvedValue(null);
      const { context } = createExecutionContext({ headers: { authorization: 'Bearer expired' } });

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Your session is invalid or has expired. Please sign in again.',
      );
    });

    it('answers 503 rather than crashing when verification is unconfigured', async () => {
      verifier.isEnabled = false;
      const { context } = createExecutionContext({ headers: { authorization: 'Bearer any' } });

      await expect(guard.canActivate(context)).rejects.toThrow(ServiceUnavailableException);
    });

    it('does not leak the request through an unconfigured verifier', async () => {
      verifier.isEnabled = false;
      const { context, request } = createExecutionContext({
        headers: { authorization: 'Bearer any' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ServiceUnavailableException);
      expect(request.user).toBeUndefined();
    });
  });
});
