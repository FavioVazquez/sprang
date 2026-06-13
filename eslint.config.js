// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat ESLint config for the Sprang monorepo (ESLint v9).
 *
 * Scope: all first-party TypeScript / TSX under packages/&#42;/src plus root
 * config files. Uses the non-type-checked recommended sets so `pnpm lint`
 * stays fast and does not require a per-package `parserOptions.project`.
 */
export default tseslint.config(
  // ── Ignored paths ──────────────────────────────────────────────────────────
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/dashboard/e2e/.bridge-root-*/**',
      // cascade-messaging is gitignored (only the compiled .vsix is committed)
      'packages/cascade-messaging/**',
      // Agent git worktrees (gitignored, absent in CI) — ESLint flat config does
      // not read .gitignore, so without this `pnpm lint` descends into every
      // worktree copy and reports the whole repo's lint state N times over.
      '.claude/worktrees/**',
    ],
  },

  // ── Base JS + TypeScript recommended (non-type-checked) ──────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Project-wide rule tuning ─────────────────────────────────────────────────
  {
    rules: {
      // The MCP node-id sanitizers intentionally match control characters
      // (\x00-\x1f) to strip them from untrusted input.
      'no-control-regex': 'off',
      // MCP no-argument tool input contracts are modeled as empty interfaces.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Allow intentionally-unused args/vars when prefixed with `_` (everywhere).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ── Source files ─────────────────────────────────────────────────────────────
  {
    files: ['packages/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // ── React component files: hooks correctness ─────────────────────────────────
  {
    files: ['packages/dashboard/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Critical correctness — must never be violated.
      'react-hooks/rules-of-hooks': 'error',
      // Dependency completeness is advisory (non-blocking) — several effects
      // intentionally omit deps and document it with inline disables.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ── Test + e2e files: relax rules that are noisy in test scaffolding ─────────
  {
    files: [
      'packages/*/tests/**/*.{ts,tsx}',
      'packages/*/src/**/*.test.{ts,tsx}',
      'packages/*/e2e/**/*.{ts,tsx}',
      'packages/**/__tests__/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ── Root-level config / build files run in Node ──────────────────────────────
  {
    files: ['*.{js,ts}', '**/*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
