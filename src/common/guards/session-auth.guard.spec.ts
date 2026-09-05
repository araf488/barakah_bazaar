import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthConstants } from '../../modules/auth/auth.constants';
import {
  AccessTokenClaims,
  AccessTokenService,
} from '../../modules/auth/tokens/access-token.service';
import { SessionService, ValidatedSession } from '../../modules/auth/sessions/session.service';
import { ErrorMessages } from '../constants/error-messages.constants';
import { ServiceResponse } from '../types/service-response';
import { UserRole, User } from '../../infra/prisma/prisma-client';
import { createExecutionContext } from '../../../test/support/mocks';
import { SessionAuthGuard } from './session-auth.guard';

const DEVICE_ID = 'device-1';

// Literal, not the production constant (`ErrorMessages.*`) — asserting the constant against
// itself would pass no matter what the wording became. Named here only to avoid repeating the
// same literal across every test on that path; each still asserts the exact string.
const MISSING_TOKEN_MESSAGE = 'Authentication is required to access this resource.';
const INVALID_TOKEN_MESSAGE = 'Your session is invalid or has expired. Please sign in again.';

const claims = (overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  userId: 'user-1',
  sessionId: 'session-1',
  role: UserRole.OPS,
  email: 'ops@barakahbazaar.com.bd',
  type: 'access',
  ...overrides,
});

const userRow = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'ops@barakahbazaar.com.bd',
    phone: null,
    role: UserRole.OPS,
    isActive: true,
    ...overrides,
  }) as User;

const validated = (
  overrides: Partial<ValidatedSession> = {},
): ServiceResponse<ValidatedSession> => ({
  ok: true,
  data: { user: userRow(), sessionId: 'session-1', ...overrides },
});

/** Extracts the message text regardless of whether `getResponse()` is a string or an object. */
const messageOf = (error: HttpException): string => {
  const payload = error.getResponse();
  return typeof payload === 'string' ? payload : (payload as { message: string }).message;
};

describe('SessionAuthGuard', () => {
  let reflector: Reflector;
  let tokens: { verify: jest.Mock };
  let sessions: { validate: jest.Mock };
  let guard: SessionAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    tokens = { verify: jest.fn() };
    sessions = { validate: jest.fn() };
    guard = new SessionAuthGuard(
      reflector,
      tokens as unknown as AccessTokenService,
      sessions as unknown as SessionService,
    );
  });

  const markPublic = (isPublic: boolean): void => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(isPublic ? true : undefined);
  };

  const headers = (overrides: Record<string, string> = {}): Record<string, string> => ({
    authorization: 'Bearer valid-token',
    [AuthConstants.DeviceIdHeader]: DEVICE_ID,
    ...overrides,
  });

  describe('public routes', () => {
    it('lets a @Public() route through without verifying or querying', async () => {
      markPublic(true);
      const { context } = createExecutionContext({ headers: headers() });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(tokens.verify).not.toHaveBeenCalled();
      expect(sessions.validate).not.toHaveBeenCalled();
    });
  });

  describe('protected routes', () => {
    beforeEach(() => markPublic(false));

    it('answers 401 with no Authorization header', async () => {
      const { context } = createExecutionContext({ headers: {} });

      await expect(guard.canActivate(context)).rejects.toThrow(MISSING_TOKEN_MESSAGE);
      // Proves this is "no credential was presented", not "a credential was presented and
      // rejected" — a guard that fabricated one (e.g. `authorization ?? 'Bearer injected'`)
      // would still throw UnauthorizedException, but would call the verifier with it.
      expect(tokens.verify).not.toHaveBeenCalled();
    });

    it('answers 401 for a non-Bearer Authorization header', async () => {
      const { context } = createExecutionContext({ headers: { authorization: 'Basic abc123' } });

      await expect(guard.canActivate(context)).rejects.toThrow(MISSING_TOKEN_MESSAGE);
      expect(tokens.verify).not.toHaveBeenCalled();
    });

    it('answers 401 for an empty bearer token', async () => {
      const { context } = createExecutionContext({ headers: { authorization: 'Bearer    ' } });

      await expect(guard.canActivate(context)).rejects.toThrow(MISSING_TOKEN_MESSAGE);
      // Same proof as the no-header case: a guard that fabricated a token from the blank
      // string (e.g. `token.length > 0 ? token : 'injected'`) would still throw the right
      // exception class, but would hand something to the verifier.
      expect(tokens.verify).not.toHaveBeenCalled();
    });

    it('rejects a bad signature WITHOUT any database call', async () => {
      tokens.verify.mockResolvedValue(null);
      const { context } = createExecutionContext({ headers: headers() });

      await expect(guard.canActivate(context)).rejects.toThrow(INVALID_TOKEN_MESSAGE);
      expect(sessions.validate).not.toHaveBeenCalled();
    });

    it('rejects a missing X-Device-Id without a database call', async () => {
      const { context } = createExecutionContext({
        headers: { authorization: 'Bearer valid-token' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(INVALID_TOKEN_MESSAGE);
      // The guard refuses this locally now (M1) — it never even reaches the token verifier.
      expect(tokens.verify).not.toHaveBeenCalled();
      expect(sessions.validate).not.toHaveBeenCalled();
    });

    it('rejects an over-long X-Device-Id without a database call', async () => {
      const overLong = 'd'.repeat(AuthConstants.DeviceIdMaxLength + 1);
      const { context } = createExecutionContext({
        headers: headers({ [AuthConstants.DeviceIdHeader]: overLong }),
      });

      await expect(guard.canActivate(context)).rejects.toThrow(INVALID_TOKEN_MESSAGE);
      // The oversized value is treated as absent and never reaches the token verifier.
      expect(tokens.verify).not.toHaveBeenCalled();
      expect(sessions.validate).not.toHaveBeenCalled();
    });

    it('rejects a refresh-typed token presented as a bearer token', async () => {
      // AccessTokenService.verify returns null itself when `typ` does not match `expected`;
      // what this guard must get right is always asking for 'access', never anything looser.
      tokens.verify.mockResolvedValue(null);
      const { context } = createExecutionContext({ headers: headers() });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(tokens.verify).toHaveBeenCalledWith('valid-token', DEVICE_ID, 'access');
    });

    it('attaches userId, sessionId, email and role to the request', async () => {
      tokens.verify.mockResolvedValue(claims());
      sessions.validate.mockResolvedValue(validated());
      const { context, request } = createExecutionContext({ headers: headers() });

      await guard.canActivate(context);

      expect(request.user).toEqual({
        userId: 'user-1',
        sessionId: 'session-1',
        email: 'ops@barakahbazaar.com.bd',
        phone: undefined,
        role: UserRole.OPS,
      });
    });

    it('takes the role from the session row, not the token claim', async () => {
      // The claim says OPS — signed thirty minutes ago — but the row says a demotion to
      // CUSTOMER has since landed. The row must win.
      tokens.verify.mockResolvedValue(claims({ role: UserRole.OPS }));
      sessions.validate.mockResolvedValue(
        validated({ user: userRow({ role: UserRole.CUSTOMER }) }),
      );
      const { context, request } = createExecutionContext({ headers: headers() });

      await guard.canActivate(context);

      expect((request.user as { role: UserRole }).role).toBe(UserRole.CUSTOMER);
    });

    it('answers 403 for a disabled account', async () => {
      tokens.verify.mockResolvedValue(claims());
      sessions.validate.mockResolvedValue({
        ok: false,
        status: HttpStatus.FORBIDDEN,
        message: ErrorMessages.AccountDisabled,
      });
      const { context } = createExecutionContext({ headers: headers() });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('answers 401 for a revoked session', async () => {
      tokens.verify.mockResolvedValue(claims());
      sessions.validate.mockResolvedValue({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: ErrorMessages.InvalidAccessToken,
      });
      const { context } = createExecutionContext({ headers: headers() });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('answers 503 when the session lookup fails', async () => {
      tokens.verify.mockResolvedValue(claims());
      sessions.validate.mockResolvedValue({
        ok: false,
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: ErrorMessages.ServiceUnavailable,
      });
      const { context } = createExecutionContext({ headers: headers() });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    });

    it('sets WWW-Authenticate on every 401', async () => {
      const { context, response } = createExecutionContext({ headers: {} });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(response.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    });

    it('gives the same body for a stage-one and a stage-two rejection', async () => {
      const { context: stageOneContext } = createExecutionContext({ headers: headers() });
      tokens.verify.mockResolvedValueOnce(null);
      const stageOne = await guard
        .canActivate(stageOneContext)
        .catch((error: HttpException) => error);

      const { context: stageTwoContext } = createExecutionContext({ headers: headers() });
      tokens.verify.mockResolvedValueOnce(claims());
      sessions.validate.mockResolvedValueOnce({
        ok: false,
        status: HttpStatus.UNAUTHORIZED,
        message: ErrorMessages.InvalidAccessToken,
      });
      const stageTwo = await guard
        .canActivate(stageTwoContext)
        .catch((error: HttpException) => error);

      // Same status and message text — the client-visible contract. The raw `getResponse()`
      // shapes legitimately differ here (UnauthorizedException wraps its message; the bare
      // HttpException thrown for a stage-two failure does not); GlobalExceptionFilter is what
      // normalizes both into the one ErrorResponseBody shape the client actually receives, and
      // that filter has its own tests for that normalization.
      expect(stageOne).toBeInstanceOf(HttpException);
      expect(stageTwo).toBeInstanceOf(HttpException);
      expect((stageOne as HttpException).getStatus()).toBe((stageTwo as HttpException).getStatus());
      expect(messageOf(stageOne as HttpException)).toBe(messageOf(stageTwo as HttpException));
    });
  });
});
