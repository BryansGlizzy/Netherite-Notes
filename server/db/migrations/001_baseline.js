// Brings any historic database (fresh, pre-email, pre-AI, plaintext-password) to the v1.0.0 schema.
// Replaces the inline ALTER TABLEs in server.js and the one-off scripts
// fix-vault-owners.js and migrate-passwords.js. Idempotent.
const bcrypt = require('bcrypt');

module.exports = {
  version: 1,
  name: 'baseline',
  async up(tx, ctx) {
    await tx.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      email TEXT,
      reset_token TEXT,
      reset_expires INTEGER
    )`);
    for (const [col, ddl] of [
      ['email', 'TEXT'], ['reset_token', 'TEXT'], ['reset_expires', 'INTEGER'],
      ['ai_endpoint', 'TEXT'], ['ai_api_key', 'TEXT'], ['ai_model', 'TEXT'],
      ['keybind_split_block', "TEXT DEFAULT 'Enter'"], ['keybind_new_line', "TEXT DEFAULT 'Shift+Enter'"]
    ]) await ctx.addColumnIfMissing('users', col, ddl);

    await tx.run('CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, ownerId TEXT)');
    await ctx.addColumnIfMissing('groups', 'ownerId', 'TEXT');
    await tx.run('CREATE TABLE IF NOT EXISTS user_groups (userId TEXT, groupId TEXT, PRIMARY KEY (userId, groupId))');
    await tx.run(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, groupId TEXT, title TEXT, content TEXT,
      createdAt INTEGER, updatedAt INTEGER, isBookmarked INTEGER
    )`);
    await tx.run(`CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      name TEXT,
      permissions TEXT NOT NULL DEFAULT '["read"]',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      expires_at INTEGER,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )`);

    // (was fix-vault-owners.js) vaults without an owner get their first member as owner
    const ownerless = await tx.all("SELECT id, name FROM groups WHERE ownerId IS NULL OR ownerId = ''");
    for (const g of ownerless) {
      const m = await tx.get('SELECT userId FROM user_groups WHERE groupId = ? LIMIT 1', [g.id]);
      if (m) {
        await tx.run('UPDATE groups SET ownerId = ? WHERE id = ?', [m.userId, g.id]);
        ctx.log(`[migrate] vault "${g.name}" (${g.id}) assigned owner ${m.userId}`);
      } else {
        ctx.warn(`[migrate] vault "${g.name}" (${g.id}) has no members; owner left empty`);
      }
    }

    // (was migrate-passwords.js) hash any remaining plaintext passwords
    const rows = await tx.all("SELECT id, password FROM users WHERE password IS NOT NULL AND password NOT LIKE '$2%'");
    for (const r of rows) {
      await tx.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(r.password, 12), r.id]);
      ctx.log(`[migrate] hashed legacy plaintext password for user ${r.id}`);
    }
  }
};
