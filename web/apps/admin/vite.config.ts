/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: { proxy: { '/api': 'http://localhost:3000' } },
  test: { globals: true, environment: 'jsdom', setupFiles: ['./vitest.setup.ts'] },
});
