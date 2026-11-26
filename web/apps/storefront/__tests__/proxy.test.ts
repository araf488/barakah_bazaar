// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import proxy, { config } from '../proxy';

const ORIGIN = 'http://localhost:3000';

const run = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`${ORIGIN}${path}`, { headers }));

/** Next anchors a string matcher at both ends; this mirrors that for the assertions below. */
const matches = (path: string): boolean => new RegExp(`^${config.matcher}$`).test(path);

describe('locale proxy', () => {
  it('redirects the bare root to Bangla', async () => {
    const res = await run('/');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/bn`);
  });

  it('keeps Bangla for a browser that asks for English', async () => {
    const res = await run('/', { 'accept-language': 'en-US,en;q=0.9' });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/bn`);
  });

  it('carries the query string of an unprefixed email link into the locale', async () => {
    const res = await run('/verify-email?token=abc123');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/bn/verify-email?token=abc123`);
  });

  it.each(['/bn', '/en/p/ajwa-dates'])('lets the prefixed path %s through', async (path) => {
    const res = await run(path);
    expect(res.headers.get('location')).toBeNull();
  });

  it.each(['/', '/bn', '/en/account', '/verify-email'])('runs on the page path %s', (path) => {
    expect(matches(path)).toBe(true);
  });

  it.each(['/api/v1/health', '/_next/static/app.js', '/favicon.ico'])(
    'never runs on %s',
    (path) => {
      expect(matches(path)).toBe(false);
    },
  );
});

describe('staff portal paths', () => {
  it.each(['/admin', '/admin/sign-in', '/admin/orders/1'])('runs on %s', (path) => {
    expect(matches(path)).toBe(true);
  });

  it('never puts the portal into a locale', async () => {
    const res = await run('/admin/sign-in');
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('still sends /administrator, a shop path, into a locale', async () => {
    const res = await run('/administrator');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/bn/administrator`);
  });
});
