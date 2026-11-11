import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Lints source text through the real shared config file, loaded by path exactly as `web:lint`
 * loads it, and answers the messages `no-restricted-syntax` reported. The fixture path is virtual: nothing is read from
 * disk, it only has to look like a web source file so the config's `files` globs apply.
 */
const configDir = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({
  cwd: configDir,
  overrideConfigFile: join(configDir, 'eslint.config.mjs'),
});

const restrictedSyntaxMessages = async (code: string): Promise<string[]> => {
  const results = await eslint.lintText(code, { filePath: join(configDir, 'fixtures/probe.ts') });
  return results
    .flatMap((result) => result.messages)
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.message);
};

const ALLOWLIST_MESSAGE =
  'process.env may only be read by an allowlisted name: NEXT_PUBLIC_*, VITE_*, NODE_ENV, ' +
  'WEB_INTERNAL_API_BASE_URL or NEXT_RUNTIME. Server secrets must never reach web code.';

describe('process.env allowlist (ruling R7)', () => {
  it.each([
    // eslint-disable-next-line no-restricted-syntax -- a fixture naming the secret the rule exists to catch
    ['a dotted server secret', 'export const url = process.env.DATABASE_URL;'],
    ['a dotted signing key', 'export const key = process.env.JWT_SECRET;'],
    // eslint-disable-next-line no-restricted-syntax -- a fixture naming the secret the rule exists to catch
    ['a destructured server secret', 'export const { DIRECT_URL } = process.env;'],
    ['a destructured, renamed secret', 'export const { SMS_API_KEY: key } = process.env;'],
    ['a destructuring rest element', 'export const { ...everything } = process.env;'],
    ['a bracket read by a dynamic name', 'export const read = (k: string) => process.env[k];'],
    [
      'a bracket read by a literal off the list',
      "export const v = process.env['PAYMENT_PASSWORD'];",
    ],
    ['the whole environment, spread', 'export const all = { ...process.env };'],
    ['the whole environment, stored', 'export const env = process.env;'],
    ['an optional-chained read', 'export const v = process.env?.TOTP_ENCRYPTION_KEY;'],
  ])('reports %s', async (_label, code) => {
    expect(await restrictedSyntaxMessages(code)).toEqual([ALLOWLIST_MESSAGE]);
  });

  it.each([
    'export const v = process.env.NEXT_PUBLIC_X;',
    'export const v = process.env.VITE_APP_ENV;',
    "export const dev = process.env.NODE_ENV === 'development';",
    "export const base = process.env.WEB_INTERNAL_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';",
    "export const edge = process.env.NEXT_RUNTIME === 'edge';",
    "export const v = process.env['NEXT_PUBLIC_X'];",
    'export const { NEXT_PUBLIC_X, NODE_ENV: mode } = process.env;',
  ])('lets `%s` through', async (code) => {
    expect(await restrictedSyntaxMessages(code)).toEqual([]);
  });

  it('keeps the literal ban on server secret names alongside the allowlist', async () => {
    // eslint-disable-next-line no-restricted-syntax -- a fixture naming the secret the rule exists to catch
    const fixture = "export const name = 'DATABASE_URL';";
    expect(await restrictedSyntaxMessages(fixture)).toEqual([
      'Server-only secret name must not appear in frontend code.',
    ]);
  });
});
