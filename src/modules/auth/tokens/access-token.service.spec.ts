import { UnsecuredJWT } from 'jose';
import { UserRole } from '../../../infra/prisma/prisma-client';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { AccessTokenService } from './access-token.service';

const claims = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-1',
  sessionId: 'session-1',
  role: UserRole.CUSTOMER,
  email: 'shopper@example.com',
  deviceId: 'device-1',
  ...overrides,
});

const makeService = (configOverrides: Record<string, unknown> = {}) =>
  new AccessTokenService(
    createMockConfig({
      JWT_SECRET: 'a'.repeat(32),
      JWT_ISSUER: 'barakah-bazaar-api',
      JWT_AUDIENCE: 'barakah-bazaar',
      ...configOverrides,
    }),
    createMockLogger(),
  );

const decodePayload = (token: string): Record<string, unknown> => {
  const [, payloadSegment] = token.split('.');
  return JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
};

describe('AccessTokenService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('round-trips every claim', async () => {
    const service = makeService();
    const token = await service.sign(claims(), 30);

    const verified = await service.verify(token, 'device-1', 'access');

    expect(verified).toMatchObject({
      ok: true,
      claims: {
        userId: 'user-1',
        sessionId: 'session-1',
        role: UserRole.CUSTOMER,
        email: 'shopper@example.com',
        type: 'access',
      },
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const signer = makeService({ JWT_SECRET: 'a'.repeat(32) });
    const verifier = makeService({ JWT_SECRET: 'b'.repeat(32) });
    const token = await signer.sign(claims(), 30);

    expect(await verifier.verify(token, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('rejects a tampered payload', async () => {
    const service = makeService();
    const token = await service.sign(claims(), 30);
    const [header, payload, signature] = token.split('.');

    // Flip the first character of the payload segment; whatever it decodes to, the
    // signature was computed over the original bytes and can no longer match.
    const flippedChar = payload[0] === 'a' ? 'b' : 'a';
    const tampered = [header, flippedChar + payload.slice(1), signature].join('.');

    expect(await service.verify(tampered, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  // One 5-minute token, read at three moments either side of its expiry. The middle row is
  // the requirement: 30 seconds of clock tolerance, because logging someone out for a handset
  // that is forty seconds fast is an unexplainable failure.
  it.each([
    ['20 seconds past expiry, inside the tolerance', '2026-09-02T00:05:20Z', true],
    ['1 minute past expiry', '2026-09-02T00:06:00Z', false],
    ['5 minutes past expiry', '2026-09-02T00:10:00Z', false],
  ])('%s', async (_label, readAt, accepted) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T00:00:00Z'));
    const service = makeService();
    const token = await service.sign(claims(), 5);

    jest.setSystemTime(new Date(readAt));

    expect(await service.verify(token, 'device-1', 'access')).toMatchObject({ ok: accepted });
  });

  it('rejects a wrong issuer', async () => {
    const service = makeService();
    const otherIssuer = makeService({ JWT_ISSUER: 'someone-else' });
    const token = await otherIssuer.sign(claims(), 30);

    expect(await service.verify(token, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('rejects a wrong audience', async () => {
    const service = makeService();
    const otherAudience = makeService({ JWT_AUDIENCE: 'someone-else' });
    const token = await otherAudience.sign(claims(), 30);

    expect(await service.verify(token, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('refuses an mfa token when an access token was expected', async () => {
    const service = makeService();
    const token = await service.sign(claims(), 5, 'mfa');

    expect(await service.verify(token, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('names the session when the bnd claim does not match the presented device', async () => {
    // The one failure a caller may act on. It is reachable only after the signature, issuer,
    // audience and expiry have all passed, which is what makes the session id trustworthy —
    // a forged token cannot get here and so cannot name somebody else's session.
    const service = makeService();
    const token = await service.sign(claims({ deviceId: 'device-1' }), 30);

    expect(await service.verify(token, 'device-2', 'access')).toEqual({
      ok: false,
      deviceMismatch: { sessionId: 'session-1' },
    });
  });

  it('names no session for a forged token, however its device id is presented', async () => {
    // The safety property: a token this API did not sign must never be able to end a session
    // by naming it, so every other failure carries no session id at all.
    const signer = makeService({ JWT_SECRET: 'a'.repeat(32) });
    const verifier = makeService({ JWT_SECRET: 'b'.repeat(32) });
    const token = await signer.sign(claims({ deviceId: 'device-1' }), 30);

    expect(await verifier.verify(token, 'device-2', 'access')).toEqual({ ok: false });
  });

  it('refuses when no device id is presented at all', async () => {
    const service = makeService();
    const token = await service.sign(claims(), 30);

    expect(await service.verify(token, undefined, 'access')).toMatchObject({ ok: false });
  });

  it('binds to the device id only, so a changed user agent still verifies', async () => {
    const service = makeService();
    // sign()/verify() take no user-agent parameter at all — the binding is computed from the
    // device id alone, so nothing here can be invalidated by a browser update changing the
    // user-agent string.
    const token = await service.sign(claims({ deviceId: 'device-1' }), 30);

    expect(await service.verify(token, 'device-1', 'access')).toMatchObject({ ok: true });
  });

  it('honours the ttl it was given', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T00:00:00Z'));
    const service = makeService();
    const token = await service.sign(claims(), 30);

    const payload = decodePayload(token);

    expect((payload.exp as number) - (payload.iat as number)).toBe(30 * 60);
  });

  it('rejects a malformed token', async () => {
    const service = makeService();

    expect(await service.verify('not-a-jwt', 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('rejects an unsigned token', async () => {
    const service = makeService();
    const token = await service.sign(claims(), 30);
    const [header, payload] = token.split('.');
    const unsigned = [header, payload, ''].join('.');

    expect(await service.verify(unsigned, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('rejects an alg:none token', async () => {
    const service = makeService();
    // UnsecuredJWT produces a valid-shaped, 3-segment token with a `{ alg: 'none' }` header
    // and no signature at all — the classic alg-confusion forgery, distinct from "unsigned"
    // above because jose refuses the algorithm outright rather than failing signature checks.
    const token = new UnsecuredJWT({ sub: 'user-1', sid: 'session-1', typ: 'access' })
      .setIssuedAt()
      .setIssuer('barakah-bazaar-api')
      .setAudience('barakah-bazaar')
      .setExpirationTime('30m')
      .encode();

    expect(await service.verify(token, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('rejects a token with a truncated signature', async () => {
    const service = makeService();
    const token = await service.sign(claims(), 30);
    const [header, payload, signature] = token.split('.');
    const truncated = [header, payload, signature.slice(0, -4)].join('.');

    expect(await service.verify(truncated, 'device-1', 'access')).toMatchObject({ ok: false });
  });

  it('signs without a configured secret, using the generated one', async () => {
    const logger = createMockLogger();
    const service = new AccessTokenService(
      createMockConfig({ JWT_ISSUER: 'barakah-bazaar-api', JWT_AUDIENCE: 'barakah-bazaar' }),
      logger,
    );

    const token = await service.sign(claims(), 30);

    expect(await service.verify(token, 'device-1', 'access')).toMatchObject({ ok: true });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
