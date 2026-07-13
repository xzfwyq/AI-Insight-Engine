/* eslint-env node */
module.exports = {
  root: true,
  env: { node: true, es2022: true, browser: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  extends: ['eslint:recommended', 'prettier'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'prefer-const': 'warn',
  },
  overrides: [
    {
      files: ['**/*.vue'],
      parser: 'vue-eslint-parser',
      extends: ['eslint:recommended', 'plugin:vue/vue3-recommended', 'prettier'],
    },
  ],
  ignorePatterns: ['node_modules/', 'dist/', 'web/dist/', 'data/'],
};
