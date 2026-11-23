import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    pool: 'threads',
  },
  esbuild: { jsx: 'automatic' },
});
