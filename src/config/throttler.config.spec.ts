import { buildThrottlerOptions } from './throttler.config';

describe('buildThrottlerOptions', () => {
  it('configures a bucket named "auth", which is the name every @Throttle({ auth: ... }) decorator references', () => {
    const options = buildThrottlerOptions({ GEOCODING_RATE_LIMIT: 30, AUTH_RATE_LIMIT: 10 });

    expect(options).toContainEqual({ name: 'auth', ttl: 60_000, limit: 10 });
  });

  it('reads the limit from AUTH_RATE_LIMIT rather than a fixed number', () => {
    const options = buildThrottlerOptions({ GEOCODING_RATE_LIMIT: 30, AUTH_RATE_LIMIT: 7 });

    expect(options).toContainEqual(expect.objectContaining({ name: 'auth', limit: 7 }));
  });

  it('keeps the existing geocoding bucket alongside it', () => {
    const options = buildThrottlerOptions({ GEOCODING_RATE_LIMIT: 30, AUTH_RATE_LIMIT: 10 });

    expect(options).toContainEqual({ name: 'geocoding', ttl: 60_000, limit: 30 });
  });

  it('gives both buckets the same one-minute window', () => {
    const options = buildThrottlerOptions({ GEOCODING_RATE_LIMIT: 30, AUTH_RATE_LIMIT: 10 });

    expect(options.map((option) => option.ttl)).toEqual([60_000, 60_000]);
  });
});
