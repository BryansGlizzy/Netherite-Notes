const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'backups/**', 'docs/**', 'src/**', 'vite.config.js'] }, // src/ and the Vite config are ESM/TypeScript, checked by `npm run typecheck` and the build
  js.configs.recommended,
  {
    files: ['server.js', 'server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: { ...globals.node, WebSocket: 'readonly', fetch: 'readonly' } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
