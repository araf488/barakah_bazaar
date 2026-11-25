import { createHash, randomInt } from 'node:crypto';
import {
  codeMatches,
  generateCode,
  hashCredential,
  isLive,
  withinCooldown,
} from './emailed-credential';

jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...actual,
    randomInt: jest.fn((min: number, max: number) => actual.randomInt(min, max)),
  };
});

const NOW = new Date('2026-10-05T00:00:00.000Z');

/** Hashed here rather than through the helper, so the test states the algorithm. */
const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('base64url');

describe('emailed credential helpers', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('hashCredential', () => {
    it('is the base64url SHA-256 of the raw value', () => {
      expect(hashCredential('481920')).toBe(sha256('481920'));
    });

    it('never returns the raw value', () => {
      expect(hashCredential('481920')).not.toContain('481920');
    });
  });

  describe('codeMatches', () => {
    it('accepts the code whose hash was stored', () => {
      expect(codeMatches('481920', sha256('481920'))).toBe(true);
    });

    it('refuses a different code', () => {
      expect(codeMatches('481921', sha256('481920'))).toBe(false);
    });

    it('refuses rather than throws when the stored hash has a different length', () => {
      expect(() => codeMatches('481920', 'short')).not.toThrow();
      expect(codeMatches('481920', 'short')).toBe(false);
    });
  });

  describe('generateCode', () => {
    it('is always exactly the requested number of digits', () => {
      for (let i = 0; i < 200; i += 1) {
        expect(generateCode(6)).toMatch(/^\d{6}$/);
      }
    });

    it('zero-pads a small draw rather than shortening the code', () => {
      (randomInt as unknown as jest.Mock).mockReturnValueOnce(42);

      expect(generateCode(6)).toBe('000042');
    });

    it('draws from randomInt over the whole range, never Math.random', () => {
      const mathRandom = jest.spyOn(Math, 'random');

      generateCode(6);

      expect(randomInt).toHaveBeenLastCalledWith(0, 1_000_000);
      expect(mathRandom).not.toHaveBeenCalled();
      mathRandom.mockRestore();
    });
  });

  describe('isLive', () => {
    const record = (overrides: { consumedAt?: Date | null; expiresAt?: Date } = {}) => ({
      consumedAt: null,
      expiresAt: new Date(NOW.getTime() + 60_000),
      ...overrides,
    });

    it('accepts an unconsumed record that has not expired', () => {
      expect(isLive(record())).toBe(true);
    });

    it('refuses no record at all', () => {
      expect(isLive(undefined)).toBe(false);
    });

    it('refuses a consumed record', () => {
      expect(isLive(record({ consumedAt: NOW }))).toBe(false);
    });

    it('refuses a record whose expiry is exactly now', () => {
      expect(isLive(record({ expiresAt: NOW }))).toBe(false);
    });
  });

  describe('withinCooldown', () => {
    const secondsAgo = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1_000);

    it('is inside the window up to and including its last second', () => {
      expect(withinCooldown(secondsAgo(59), 60)).toBe(true);
      expect(withinCooldown(secondsAgo(60), 60)).toBe(true);
    });

    it('is outside the window once it has passed', () => {
      expect(withinCooldown(secondsAgo(61), 60)).toBe(false);
    });

    it('uses the window it is given rather than a fixed one', () => {
      expect(withinCooldown(secondsAgo(31), 30)).toBe(false);
    });
  });
});
