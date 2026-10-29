// Usernames become case-insensitively unique. Existing data is never modified: if two accounts
// already differ only by case, the index is skipped (code-level checks still block new duplicates)
// and the conflicting names are logged so the operator can resolve them.
module.exports = {
  version: 2,
  name: 'username_nocase',
  async up(tx, ctx) {
    const dups = await tx.all('SELECT group_concat(username, \', \') AS names FROM users GROUP BY lower(username) HAVING count(*) > 1');
    if (dups.length) {
      ctx.warn(`[migrate] case-insensitive username index SKIPPED; these accounts collide: ${dups.map((d) => d.names).join(' | ')}. Rename one of each pair, then run: CREATE UNIQUE INDEX idx_users_username_nocase ON users(username COLLATE NOCASE);`);
      return;
    }
    await tx.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)');
  }
};
