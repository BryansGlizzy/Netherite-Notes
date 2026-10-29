// Process entry point: config -> database + migrations -> HTTP + WebSocket -> static/Vite.
require('dotenv').config({ path: process.env.ENV_FILE || '.env', quiet: true });
const http = require('http');
const ViteExpress = require('vite-express');
const config = require('./config'); // must load before vite-express decides its mode (sets the NODE_ENV default)
const db = require('./db');
const { migrate } = require('./db/migrate');
const { createApp } = require('./app');
const { attachWebSocket, closeWebSocket } = require('./ws');
const { errorHandler } = require('./lib/http');
const { pruneAudit } = require('./lib/audit');

ViteExpress.config({ mode: config.isProd ? 'production' : 'development' });

let server;

async function preflight() {
  for (const email of config.adminEmails) {
    if (!(await db.get('SELECT 1 AS x FROM users WHERE lower(email) = ?', [email]))) {
      console.warn(`[preflight] ADMIN_EMAILS lists ${email}, which has no account. It cannot be claimed by sign-up; create it with: npm run admin:create -- --email ${email} --username <name>`);
    }
  }
  const noRead = await db.all("SELECT id, name, group_id FROM api_tokens WHERE is_active = 1 AND permissions NOT LIKE '%\"read\"%'");
  if (noRead.length) {
    console.warn(`[preflight] ${noRead.length} active API token(s) lack the 'read' permission and can no longer list notes or read vault details: ${noRead.map((t) => `#${t.id} "${t.name || ''}" (vault ${t.group_id})`).join(', ')}`);
  }
}

async function main() {
  config.checkSecrets().forEach((w) => console.warn(`[config] ${w}`));
  if (!config.isProd) console.warn('[config] Running in DEVELOPMENT mode: the Vite dev server serves project files. Never expose this publicly.');

  await db.init(config.dbPath);
  console.log('Connected to the SQLite database.');
  await migrate(db, { backupDir: config.backupDir });
  await preflight();
  await pruneAudit();

  const app = createApp();
  server = http.createServer(app);
  attachWebSocket(server);
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  ViteExpress.bind(app, server);
  console.log(`Server is running on http://localhost:${config.port}`);

  // Keep last: turns body-parser / unexpected errors into generic JSON responses.
  app.use(errorHandler);
}

async function shutdown() {
  try {
    closeWebSocket();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

main().catch((err) => {
  console.error('FATAL: failed to start:', err);
  process.exit(1);
});
