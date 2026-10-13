import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
