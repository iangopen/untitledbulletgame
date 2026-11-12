import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
  // The long seeded simulations (40-60 s of all five characters) can pass 5 s on a busy machine.
  test: { include: ['src/**/*.test.ts'], environment: 'node', testTimeout: 20000 },
});
