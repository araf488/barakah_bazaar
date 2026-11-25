import { PhoneSendLimits, PhoneLimits } from './phone-send-limits';

const limits: PhoneLimits = { cooldownSeconds: 60, perNumberDaily: 5, globalDaily: 500 };

const row = (over: Partial<Record<string, number>> = {}) => [
  { global_count: 0, number_count: 0, cooldown_remaining: 0, ...over },
];

const makeTx = (rows: unknown[]) => ({
  $executeRaw: jest.fn().mockResolvedValue(1),
  $queryRaw: jest.fn().mockResolvedValue(rows),
});

const check = (tx: ReturnType<typeof makeTx>) =>
  PhoneSendLimits.check(tx as never, '+8801712345678', limits);

describe('PhoneSendLimits.check', () => {
  it('takes the advisory lock with $executeRaw before the count query', async () => {
    const tx = makeTx(row());
    await check(tx);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((tx.$executeRaw.mock.calls[0] as [string[]])[0].join('?')).toContain(
      'pg_advisory_xact_lock',
    );
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
  });

  it('binds the phone into the lock and the count query', async () => {
    const tx = makeTx(row());
    await check(tx);

    expect((tx.$executeRaw.mock.calls[0] as unknown[])[1]).toBe('+8801712345678');
    expect((tx.$queryRaw.mock.calls[0] as unknown[]).slice(1)).toEqual([
      '+8801712345678',
      '+8801712345678',
      60,
    ]);
  });

  it('answers ok when every count is under its limit', async () => {
    expect(await check(makeTx(row({ global_count: 499, number_count: 4 })))).toEqual({
      kind: 'ok',
    });
  });

  it('answers global-limit at the global ceiling', async () => {
    expect(await check(makeTx(row({ global_count: 500 })))).toEqual({ kind: 'global-limit' });
  });

  it('answers cooldown carrying the remaining seconds', async () => {
    expect(await check(makeTx(row({ cooldown_remaining: 42 })))).toEqual({
      kind: 'cooldown',
      retryAfterSeconds: 42,
    });
  });

  it('answers number-limit at the per-number ceiling', async () => {
    expect(await check(makeTx(row({ number_count: 5 })))).toEqual({ kind: 'number-limit' });
  });

  it('lets global-limit win over cooldown', async () => {
    expect(await check(makeTx(row({ global_count: 500, cooldown_remaining: 30 })))).toEqual({
      kind: 'global-limit',
    });
  });

  it('lets cooldown win over number-limit', async () => {
    expect(await check(makeTx(row({ number_count: 5, cooldown_remaining: 30 })))).toEqual({
      kind: 'cooldown',
      retryAfterSeconds: 30,
    });
  });

  it('pins the SQL: both tables, 24h window on each, cooldown and lock text', async () => {
    const tx = makeTx(row());
    await check(tx);

    const query = (tx.$queryRaw.mock.calls[0] as [string[]])[0].join('?');
    const lock = (tx.$executeRaw.mock.calls[0] as [string[]])[0].join('?');
    expect(query).toContain('FROM phone_verifications WHERE created_at > now() - interval');
    expect(query).toContain('FROM phone_login_challenges WHERE created_at > now() - interval');
    expect(query.split("now() - interval '24 hours'")).toHaveLength(3);
    expect(query).toContain('UNION ALL');
    expect(query).toContain('make_interval(secs =>');
    expect(query).toContain('COALESCE');
    expect(query).toContain('FILTER (WHERE phone =');
    expect(lock).toContain('pg_advisory_xact_lock(hashtextextended(');
  });
});
