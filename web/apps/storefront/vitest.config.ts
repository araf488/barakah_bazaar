import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // next-intl's ESM build imports `next/server` without an extension, which Node's own
    // resolver rejects (next ships no exports map). Inlining hands it to Vite's resolver.
    server: { deps: { inline: ['next-intl'] } },
  },
});
