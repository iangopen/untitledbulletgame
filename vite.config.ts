import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
