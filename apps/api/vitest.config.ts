import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts', 'src/lib/**/*.test.ts'],
    testTimeout: 10000,
    hookTimeout: 15000,
  },
});
