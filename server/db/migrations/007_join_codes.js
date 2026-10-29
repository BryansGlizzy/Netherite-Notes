// Vault share codes become separate from vault ids, and can be rotated or switched off by the owner.
// Every existing vault keeps working: its current id is copied into join_code.
module.exports = {
  version: 7,
  name: 'join_codes',
  async up(tx, ctx) {
    await ctx.addColumnIfMissing('groups', 'join_code', 'TEXT');
    await ctx.addColumnIfMissing('groups', 'join_enabled', 'INTEGER NOT NULL DEFAULT 1');
    await tx.run("UPDATE groups SET join_code = id WHERE join_code IS NULL OR join_code = ''");
    await tx.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_join_code ON groups(join_code)');
  }
};
