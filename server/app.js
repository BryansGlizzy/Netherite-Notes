// Builds the Express app: middleware order matters (security -> health -> limits -> body parsing -> routes -> 404).
const express = require('express');
const { applySecurity } = require('./middleware/security');
const { apiTotalLimiter, apiFailLimiter, v1FailLimiter } = require('./middleware/rate-limits');
const { sendError } = require('./lib/http');

const routes = [
  require('./routes/health'),
  // body parsing is installed between health and the rest, see below
];
const apiRoutes = [
  require('./routes/auth'),
  require('./routes/users'),
  require('./routes/admin'),
  require('./routes/vaults'),
  require('./routes/notes'),
  require('./routes/v1/tokens'),
  require('./routes/v1/vaults'),
  require('./routes/v1/notes'),
  require('./routes/v1/links'),
  require('./routes/v1/bulk')
];

function createApp() {
  const app = express();
  applySecurity(app);

  routes.forEach((register) => register(app)); // health: open, before limits and parsers

  app.use('/api', apiTotalLimiter, apiFailLimiter);
  app.use('/api/v1', v1FailLimiter);

  // 1 MB JSON everywhere, except vault import which brings its own larger parser (after authentication).
  const smallJson = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path === '/api/groups/import' ? next() : smallJson(req, res, next)));

  apiRoutes.forEach((register) => register(app));

  app.use('/api', (req, res) => sendError(req, res, 404, 'NOT_FOUND', 'Not found'));
  return app;
}

module.exports = { createApp };
