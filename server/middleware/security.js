const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const config = require('../config');

// Request id, security headers, PWA headers and CORS. Applied first, before any route.
function applySecurity(app) {
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // Enforced in production. In development Vite injects inline scripts for hot reload, so it only reports there.
  // connect-src is wide open (http/https/ws) because users point the AI panel at any endpoint they choose,
  // including local ones; script-src stays 'self' only, which is what blocks injected scripts.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        reportOnly: !config.isProd,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.appUrlIsHttps ? { maxAge: 15552000 } : false
    })
  );

  // PWA explicit MIME and cache management
  app.use((req, res, next) => {
    if (req.url.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    if (req.url.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    next();
  });

  // Browsers on other origins get no access unless listed in CORS_ORIGINS (the web app is same-origin).
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins }));
}

module.exports = { applySecurity };
