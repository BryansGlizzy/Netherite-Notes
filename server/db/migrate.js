// Versioned, additive-only migrations.
//  - Each migration runs in its own transaction and is recorded in schema_migrations.
//  - Before the first pending migration on an existing database, an automatic backup is written.
//  - Migrations never drop or rewrite user data in the same release that introduces a replacement
//    (expand -> contract), so the previous app version keeps working on the upgraded database.
const migrations = require('./migrations');

async function columnNames(db, table) {
  return (await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name);
}
async function addColumnIfMissing(db, table, column, ddl) {
  if (!(await columnNames(db, table)).includes(column)) await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

async function migrate(db, { backupDir, backup = true, log = console.log, warn = console.warn } = {}) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set((await db.all('SELECT version FROM schema_migrations')).map((r) => r.version));
  const pending = migrations.filter((m) => !done.has(m.version)).sort((a, b) => a.version - b.version);
  if (!pending.length) return [];

  const existing = await db.get("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='users'");
  if (existing && backup) {
    const { backup: doBackup } = require('../../scripts/db-backup');
    const dest = await doBackup(db.file, backupDir, `pre-migrate-v${pending[pending.length - 1].version}`);
    log(`[migrate] pre-migration backup written: ${dest}`);
  }

  const ctx = { log, warn, columnNames: (t) => columnNames(db, t), addColumnIfMissing };
  const applied = [];
  for (const m of pending) {
    await db.transaction(async (tx) => {
      const txCtx = { ...ctx, columnNames: (t) => columnNames(tx, t), addColumnIfMissing: (t, c, d) => addColumnIfMissing(tx, t, c, d) };
      await m.up(tx, txCtx);
      await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, Date.now()]);
    });
    log(`[migrate] applied ${String(m.version).padStart(3, '0')}_${m.name}`);
    applied.push(m.version);
  }
  return applied;
}

module.exports = { migrate };
