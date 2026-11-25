import { resolveWebTarget } from './web-route';

const API_PREFIX = 'api';

describe('resolveWebTarget', () => {
  describe('API paths go to Nest', () => {
    it.each(['/api/v1/health', '/api/v1/nope', '/api/v1/orders/x/unknown', '/api/docs'])(
      'routes %s to the API',
      (path) => {
        expect(resolveWebTarget(path, API_PREFIX)).toBe('api');
      },
    );

    it('routes the bare prefix /api to the API, so Nest answers it with its JSON 404', () => {
      expect(resolveWebTarget('/api', API_PREFIX)).toBe('api');
    });

    it('routes /api/ to the API, so Nest answers it with its JSON 404', () => {
      expect(resolveWebTarget('/api/', API_PREFIX)).toBe('api');
    });

    it('routes /api/v2/x to the API: the check is on API_PREFIX only, versioning lives under it, so Nest answers 404 JSON', () => {
      expect(resolveWebTarget('/api/v2/x', API_PREFIX)).toBe('api');
    });

    it('honours a non-default prefix', () => {
      expect(resolveWebTarget('/backend/v1/health', 'backend')).toBe('api');
    });
  });

  describe('paths that only look like the API prefix go to Next', () => {
    it('routes /apiary to Next: the prefix must be a whole segment', () => {
      expect(resolveWebTarget('/apiary', API_PREFIX)).toBe('next');
    });

    it('routes /API/v1/x to Next: the prefix match is case-sensitive, stricter than Express routing', () => {
      expect(resolveWebTarget('/API/v1/x', API_PREFIX)).toBe('next');
    });

    it('routes /api/v1/x to Next when the configured prefix is different', () => {
      expect(resolveWebTarget('/api/v1/x', 'backend')).toBe('next');
    });
  });

  describe('admin paths go to the admin SPA', () => {
    it.each([
      '/admin',
      '/admin/',
      '/admin/orders/123',
      '/admin/assets/app.js',
      '/admin/missing.js',
    ])('routes %s to admin', (path) => {
      expect(resolveWebTarget(path, API_PREFIX)).toBe('admin');
    });

    it('routes /administrator to Next: admin must be a whole segment', () => {
      expect(resolveWebTarget('/administrator', API_PREFIX)).toBe('next');
    });

    it('routes /Admin/orders to Next: the admin match is case-sensitive', () => {
      expect(resolveWebTarget('/Admin/orders', API_PREFIX)).toBe('next');
    });
  });

  describe('everything else goes to Next', () => {
    it.each(['/', '/products/dates', '/_next/static/chunks/main.js', '/favicon.ico'])(
      'routes %s to Next',
      (path) => {
        expect(resolveWebTarget(path, API_PREFIX)).toBe('next');
      },
    );
  });
});
