// Query indexes, the audit log, and invite codes. Purely additive.
module.exports = {
  version: 4,
  name: 'indexes_audit_invites',
  async up(tx, ctx) {
    await tx.run('CREATE INDEX IF NOT EXISTS idx_notes_group_updated ON notes(groupId, updatedAt)');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_user_groups_group ON user_groups(groupId)');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups(userId)');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_api_tokens_group ON api_tokens(group_id)');
    await tx.run('CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email))');

    await tx.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      ip TEXT,
      detail TEXT
    )`);
    await tx.run('CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts)');

    await tx.run(`CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL UNIQUE,
      code_prefix TEXT NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      used_by TEXT,
      used_at INTEGER
    )`);
  }
};
