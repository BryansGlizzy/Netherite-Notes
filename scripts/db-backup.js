// Online backup of the SQLite database (safe while the server is running).
//   npm run db:backup                 -> ./backups/obsidian-YYYYMMDD-HHMMSS.db
//   DB_PATH=/path/x.db BACKUP_DIR=/mnt/b KEEP=30 npm run db:backup
require('dotenv').config({ path: process.env.ENV_FILE || '.env', quiet: true });
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB_PATH = process.env.DB_PATH || './obsidian.db';
const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const KEEP = parseInt(process.env.KEEP || '14', 10);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function backup(dbPath = DB_PATH, dir = BACKUP_DIR, prefix = 'obsidian') {
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.resolve(dir, `${prefix}-${stamp()}.db`);
  await new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      // VACUUM INTO produces a consistent, compacted copy without locking writers.
      db.run('VACUUM INTO ?', [dest], (err2) => db.close(() => (err2 ? reject(err2) : resolve())));
    });
  });
  fs.chmodSync(dest, 0o600); // contains password hashes and tokens
  return dest;
}

function prune(dir, prefix, keep) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix + '-') && f.endsWith('.db')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
}

module.exports = { backup, prune };

if (require.main === module) {
  backup()
    .then((dest) => {
      prune(BACKUP_DIR, 'obsidian', KEEP);
      console.log(`Backup written: ${dest}`);
    })
    .catch((err) => {
      console.error('Backup failed:', err.message);
      process.exit(1);
    });
}
