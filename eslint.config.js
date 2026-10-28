import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

// Code-quality limits (see scripts/quality.js for the function-length rule,
// which allows longer functions only when they are very simple).
export default [
  { ignores: ['node_modules/', 'data/', 'test/fixtures/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    plugins: { sonarjs },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      complexity: ['error', 10],
      'max-params': ['error', 5],
      'max-lines': ['error', { max: 800, skipBlankLines: false, skipComments: false }],
      'sonarjs/cognitive-complexity': ['error', 14],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
