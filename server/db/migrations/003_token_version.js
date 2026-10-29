// Session revocation: JWTs carry the user's token_version; bumping it invalidates older tokens.
// Existing 7-day JWTs (issued without a version) are treated as version 0, so nobody is logged out.
module.exports = {
  version: 3,
  name: 'token_version',
  async up(tx, ctx) {
    await ctx.addColumnIfMissing('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
  }
};
