import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserApiBaseUrl, serverApiBaseUrl } from '../config';

describe('API base URLs', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('calls the API over loopback from the server when the env names no URL', () => {
    vi.stubEnv('WEB_INTERNAL_API_BASE_URL', undefined);
    expect(serverApiBaseUrl()).toBe('http://127.0.0.1:3000/api/v1');
  });

  it('uses the internal URL the monolith exports before preparing Next', () => {
    vi.stubEnv('WEB_INTERNAL_API_BASE_URL', 'http://127.0.0.1:8080/api/v1');
    expect(serverApiBaseUrl()).toBe('http://127.0.0.1:8080/api/v1');
  });

  it('calls the same origin from the browser in the deployed image', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', undefined);
    expect(browserApiBaseUrl()).toBe('/api/v1');
  });

  it('calls the configured API from the browser under next dev', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3000/api/v1');
    expect(browserApiBaseUrl()).toBe('http://localhost:3000/api/v1');
  });
});
