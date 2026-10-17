import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Manual only (ADR-0005): real Claude calls with the owner's key. Not in CI.
// Reuses the base config's markdown loader, but not its test list.
export default defineConfig({
  plugins: base.plugins,
  test: { include: ['apps/api/eval/**/*.eval.ts'], testTimeout: 120_000 },
});
