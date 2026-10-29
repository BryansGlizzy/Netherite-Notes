const { healthLimiter } = require('../middleware/rate-limits');
const { get } = require('../db');

// Open, unauthenticated, read-only health check; reveals nothing sensitive.
const APP_VERSION = require('../../package.json').version;
const START_TIME = Date.now();

function register(app) {
  // --- Health check (open, unauthenticated, read-only, reveals nothing sensitive) ---
  async function healthHandler(req, res) {
    res.set('Cache-Control', 'no-store');
    let dbOk = true;
    try {
      await get('SELECT 1 AS ok');
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptimeSec: Math.floor((Date.now() - START_TIME) / 1000),
      db: dbOk ? 'ok' : 'error'
    });
  }

  app.get('/api/v1/health', healthLimiter, healthHandler);
  app.get('/healthz', healthLimiter, healthHandler);
}

module.exports = register;
