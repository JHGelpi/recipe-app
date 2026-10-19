import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      // Prompts are imported as text, as the API bundle does (--loader:.md=text).
      name: 'markdown-as-text',
      transform(code, id) {
        return id.endsWith('.md')
          ? { code: `export default ${JSON.stringify(code)};`, map: null }
          : null;
      },
    },
  ],
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/mobile/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
  },
});
