import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // Ignore build output
  {
    ignores: ['dist/**', 'out/**', '.ch5-build/**', 'node_modules/**']
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript rules
  ...ts.configs.recommended,

  // Svelte rules
  ...svelte.configs['flat/recommended'],

  // Language options for TS/JS files
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      // Use the TypeScript parser so features like `import type` and generic
      // type arguments (`$state<T>(...)`) parse correctly in .ts (and
      // .svelte.ts) files.
      parser: ts.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },

  // Language options for .svelte files — use svelte parser, ts inside <script>
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte']
      },
      globals: {
        ...globals.browser
      }
    }
  },

  // Must come LAST so it disables conflicting style rules
  prettier
];
