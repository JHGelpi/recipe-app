import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/expo-env.d.ts',
      'apps/mobile/public/@powersync/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'test-support/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    // asUser is the only database entry point in the API (spec §13).
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/db/asUser.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'postgres',
              message: 'Go through asUser in src/db/asUser.ts; do not open your own connection.',
            },
          ],
        },
      ],
    },
  },
  {
    // The Dishkept look: colors come from src/theme, text from src/ui (UI spec §3).
    files: ['apps/mobile/src/**/*.{ts,tsx}', 'apps/mobile/app/**/*.{ts,tsx}'],
    ignores: ['apps/mobile/src/theme/**', '**/*.test.ts', 'apps/mobile/src/sharing/pdf.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: 'Use a color from src/theme.',
        },
        {
          selector: 'Literal[value=/^rgba?\\(/]',
          message: 'Use a color from src/theme.',
        },
      ],
    },
  },
  {
    files: ['apps/mobile/src/**/*.tsx', 'apps/mobile/app/**/*.tsx'],
    ignores: ['apps/mobile/src/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text', 'TextInput'],
              message: 'Use Text and TextField from src/ui.',
            },
          ],
        },
      ],
    },
  },
);
