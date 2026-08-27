import js from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint is where the quality gates become mechanical rather than remembered —
 * cognitive complexity, nested ternaries and dead code are all caught here
 * instead of in review.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/generated/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  sonarjs.configs.recommended,
  prettierRecommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── The gates ───────────────────────────────────────────────────────────
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-nested-conditional': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-commented-code': 'error',
      'max-params': ['error', 7],

      // ── Hygiene that otherwise accumulates during refactors ────────────────
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],

      // Nest's decorator metadata legitimately needs empty classes and
      // parameter properties, which these two rules would otherwise flag.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  {
    // Tests get latitude that production code does not: repeated literals are
    // how a test states its expectation, and mock members are unbound by design.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  { files: ['**/*.mjs', '**/*.js'], ...tseslint.configs.disableTypeChecked },
);
