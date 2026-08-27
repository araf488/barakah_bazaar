import { UserRole } from '../prisma/prisma-client';
import { SignJWT } from 'jose';
import { createMockConfig, createMockLogger } from '../../../test/support/mocks';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier';

const JWT_SECRET = 'a-test-jwt-secret-long-enough-for-hs256-signing';
const SUPABASE_USER_ID = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = 'authenticated';

const secretKey = new TextEncoder().encode(JWT_SECRET);

interface TokenOptions {
  secret?: Uint8Array;
  audience?: string;
  expiresIn?: string;
  subject?: string | null;
  role?: string;
  email?: string;
}

/** Signs a real HS256 token, so verification exercises actual cryptography. */
const signToken = async (options: TokenOptions = {}): Promise<string> => {
  const claims: Record<string, unknown> = {};
  if (options.email) {
    claims.email = options.email;
  }
  if (options.role !== undefined) {
    claims.app_metadata = { role: options.role };
  }

  let builder = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h');

  if (options.subject !== null) {
    builder = builder.setSubject(options.subject ?? SUPABASE_USER_ID);
  }

  return builder.sign(options.secret ?? secretKey);
};

const buildVerifier = (env: Record<string, unknown>): SupabaseJwtVerifier => {
  const verifier = new SupabaseJwtVerifier(
    createMockConfig({ SUPABASE_JWT_AUDIENCE: AUDIENCE, ...env }),
    createMockLogger(),
  );
  verifier.onModuleInit();
  return verifier;
};

describe('SupabaseJwtVerifier', () => {
  describe('configuration', () => {
    it('is disabled when nothing is configured', () => {
      const verifier = buildVerifier({});

      expect(verifier.currentMode).toBe('disabled');
      expect(verifier.isEnabled).toBe(false);
    });

    it('uses the symmetric secret when one is set', () => {
      expect(buildVerifier({ SUPABASE_JWT_SECRET: JWT_SECRET }).currentMode).toBe('secret');
    });

    it('derives a key set from the project URL when no secret is set', () => {
      expect(buildVerifier({ SUPABASE_URL: 'https://project.supabase.co' }).currentMode).toBe(
        'jwks',
      );
    });

    it('prefers an explicit JWKS URL over everything else', () => {
      const verifier = buildVerifier({
        SUPABASE_JWKS_URL: 'https://project.supabase.co/auth/v1/.well-known/jwks.json',
        SUPABASE_JWT_SECRET: JWT_SECRET,
      });

      expect(verifier.currentMode).toBe('jwks');
    });

    it('prefers the secret over a URL-derived key set, so legacy HS256 projects keep working', () => {
      const verifier = buildVerifier({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_JWT_SECRET: JWT_SECRET,
      });

      expect(verifier.currentMode).toBe('secret');
    });
  });

  describe('verify', () => {
    let verifier: SupabaseJwtVerifier;

    beforeEach(() => {
      verifier = buildVerifier({ SUPABASE_JWT_SECRET: JWT_SECRET });
    });

    it('accepts a correctly signed token', async () => {
      const user = await verifier.verify(await signToken({ email: 'customer@example.com' }));

      expect(user).toEqual(
        expect.objectContaining({
          supabaseUserId: SUPABASE_USER_ID,
          email: 'customer@example.com',
        }),
      );
    });

    it('rejects a token signed with a different secret', async () => {
      const token = await signToken({
        secret: new TextEncoder().encode('a-completely-different-secret-value'),
      });

      await expect(verifier.verify(token)).resolves.toBeNull();
    });

    it('rejects an expired token', async () => {
      await expect(verifier.verify(await signToken({ expiresIn: '-1h' }))).resolves.toBeNull();
    });

    it('rejects a token issued for a different audience', async () => {
      await expect(
        verifier.verify(await signToken({ audience: 'some-other-app' })),
      ).resolves.toBeNull();
    });

    it('rejects a malformed token', async () => {
      await expect(verifier.verify('not.a.jwt')).resolves.toBeNull();
    });

    it('rejects a token with no subject claim', async () => {
      await expect(verifier.verify(await signToken({ subject: null }))).resolves.toBeNull();
    });

    it('returns null when the verifier is disabled', async () => {
      const disabled = buildVerifier({});

      await expect(disabled.verify(await signToken())).resolves.toBeNull();
    });
  });

  describe('role mapping', () => {
    let verifier: SupabaseJwtVerifier;

    beforeEach(() => {
      verifier = buildVerifier({ SUPABASE_JWT_SECRET: JWT_SECRET });
    });

    const roleOf = async (claimed?: string): Promise<UserRole | undefined> =>
      (await verifier.verify(await signToken(claimed === undefined ? {} : { role: claimed })))
        ?.role;

    it('defaults to CUSTOMER when the claim is absent', async () => {
      await expect(roleOf()).resolves.toBe(UserRole.CUSTOMER);
    });

    it('maps a lowercase staff role', async () => {
      await expect(roleOf('ops')).resolves.toBe(UserRole.OPS);
    });

    it('maps a hyphenated role to its underscored form', async () => {
      await expect(roleOf('super-admin')).resolves.toBe(UserRole.SUPER_ADMIN);
    });

    it('never grants privilege for an unrecognised role', async () => {
      await expect(roleOf('root')).resolves.toBe(UserRole.CUSTOMER);
    });

    it('never grants privilege for an empty role claim', async () => {
      await expect(roleOf('')).resolves.toBe(UserRole.CUSTOMER);
    });
  });
});
