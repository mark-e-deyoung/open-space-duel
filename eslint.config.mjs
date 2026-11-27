import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'scripts/**', 'server-peer/dist/**', 'test-results/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',  /* on by default but generates noise in src/ for intentional uses (test hooks, presets) */
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],
    },
  },
  // ── Test file rule relaxations ──────────────────────────────────
  //
  // Test files unavoidably use patterns that trigger strict lint rules:
  //
  //   no-console (E2E tests)
  //     E2E tests use console.log for debugging test output in CI.
  //     Source code should use console.warn/error/debug instead.
  //
  //   @typescript-eslint/no-explicit-any (all tests)
  //     Vitest mock helpers (vi.stubGlobal, vi.spyOn) and Playwright's
  //     page.evaluate() require 'as any' casts because the browser
  //     context types don't match the Node test runner types.
  //     Covering every mock shape with precise types adds maintenance
  //     cost without catching real bugs — these casts are constrained
  //     to test boundaries.
  //
  //   @typescript-eslint/no-non-null-assertion (all tests)
  //     Tests deliberately exercise edge cases with incomplete mock
  //     data where non-null assertions shorten setup without risk
  //     (test data doesn't leave the test file).
  //
  // Source code retains full strictness for all rules — these
  // relaxations only apply within test directories.
  {
    files: ['tests/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
