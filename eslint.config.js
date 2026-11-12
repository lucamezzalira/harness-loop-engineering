export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'harness/state/**', 'harness/retro/**'],
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
];
