#!/usr/bin/env node
// Read-only database and configuration health report. Never writes.
//   npm run doctor
require('dotenv').config({ path: process.env.ENV_FILE || '.env', quiet: true });
const fs = require('fs');
const sqlite3 = require('sqlite3');
const config = require('../server/config');

const problems = [];
const note = (level, msg) => {
  console.log(`  ${level === 'ok' ? '✅' : level === 'warn' ? '⚠️ ' : '❌'} ${msg}`);
  if (level !== 'ok') problems.push(msg);
};

function open(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => (err ? reject(err) : resolve(db)));
  });
}
const all = (db, sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));

async function main() {
  console.log('Configuration');
  note(config.jwtSecret ? 'ok' : 'bad', config.jwtSecret ? 'JWT_SECRET / TOKEN_SECRET present' : 'JWT_SECRET and TOKEN_SECRET are both missing');
  if (config.jwtSecret) config.checkSecrets().forEach((w) => note('warn', w));
  note(config.isProd ? 'ok' : 'warn', `NODE_ENV=${config.nodeEnv}${config.isProd ? '' : ' (development: Vite dev server serves project files)'}`);
  note(config.appUrl.startsWith('https://') ? 'ok' : 'warn', `APP_URL=${config.appUrl}${config.appUrl.startsWith('https://') ? '' : ' (not https)'}`);
  note(config.adminEmails.length ? 'ok' : 'warn', `${config.adminEmails.length} admin email(s) configured`);
  note(config.smtp.user ? 'ok' : 'warn', config.smtp.user ? `SMTP configured (${config.smtp.host}:${config.smtp.port}, TLS ${config.smtp.requireTls ? 'required' : 'optional'})` : 'SMTP_USER not set: password-reset emails cannot be sent');

  console.log(`\nDatabase (${config.dbPath})`);
  if (!fs.existsSync(config.dbPath)) {
    note('warn', 'database file does not exist yet (it is created on first start)');
    return;
  }
  const db = await open(config.dbPath);
  try {
    const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map((t) => t.name);
    for (const t of ['users', 'groups', 'user_groups', 'notes', 'api_tokens', 'schema_migrations']) {
      note(tables.includes(t) ? 'ok' : 'warn', `table ${t} ${tables.includes(t) ? 'exists' : 'missing (run the server once to migrate)'}`);
    }
    if (tables.includes('schema_migrations')) {
      const v = await all(db, 'SELECT MAX(version) AS v FROM schema_migrations');
      console.log(`     schema version ${v[0].v}`);
    }
    const count = async (sql) => (await all(db, sql))[0].c;
    if (tables.includes('users')) {
      console.log(`     ${await count('SELECT COUNT(*) c FROM users')} users, ${await count('SELECT COUNT(*) c FROM groups')} vaults, ${await count('SELECT COUNT(*) c FROM notes')} notes, ${await count('SELECT COUNT(*) c FROM api_tokens WHERE is_active = 1')} active API tokens`);
      const plain = await count("SELECT COUNT(*) c FROM users WHERE password IS NOT NULL AND password NOT LIKE '$2%'");
      note(plain === 0 ? 'ok' : 'bad', plain === 0 ? 'all passwords are bcrypt-hashed' : `${plain} user(s) have a non-bcrypt password (start the server once to migrate them)`);
      const dups = await all(db, 'SELECT group_concat(username, \', \') AS names FROM users GROUP BY lower(username) HAVING count(*) > 1');
      note(dups.length === 0 ? 'ok' : 'warn', dups.length === 0 ? 'no case-variant duplicate usernames' : `case-variant usernames: ${dups.map((d) => d.names).join(' | ')}`);
      const noOwner = await count("SELECT COUNT(*) c FROM groups WHERE ownerId IS NULL OR ownerId = ''");
      note(noOwner === 0 ? 'ok' : 'warn', noOwner === 0 ? 'every vault has an owner' : `${noOwner} vault(s) without an owner`);
      const orphans = await count('SELECT COUNT(*) c FROM notes WHERE groupId NOT IN (SELECT id FROM groups)');
      note(orphans === 0 ? 'ok' : 'warn', orphans === 0 ? 'no orphaned notes' : `${orphans} note(s) belong to a vault that no longer exists`);
      const integrity = (await all(db, 'PRAGMA integrity_check'))[0].integrity_check;
      note(integrity === 'ok' ? 'ok' : 'bad', `integrity_check: ${integrity}`);
    }
  } finally {
    db.close();
  }
}

main()
  .then(() => {
    console.log(problems.length ? `\n${problems.length} issue(s) found.` : '\nAll checks passed.');
    process.exit(problems.length ? 1 : 0);
  })
  .catch((err) => {
    console.error('doctor failed:', err.message);
    process.exit(1);
  });
