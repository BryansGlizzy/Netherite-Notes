// AI API keys move from plaintext to AES-256-GCM ciphertext (ai_api_key_enc); the plaintext column is cleared.
// Rolling back to a release older than 1.2.0 therefore means users re-enter their AI key (or restore the
// automatic pre-migration backup). Nothing else is affected.
const { encrypt } = require('../../lib/secret-box');

module.exports = {
  version: 6,
  name: 'ai_key_encryption',
  async up(tx, ctx) {
    await ctx.addColumnIfMissing('users', 'ai_api_key_enc', 'TEXT');
    const rows = await tx.all("SELECT id, ai_api_key FROM users WHERE ai_api_key IS NOT NULL AND ai_api_key != ''");
    for (const r of rows) {
      await tx.run('UPDATE users SET ai_api_key_enc = ?, ai_api_key = NULL WHERE id = ?', [encrypt(r.ai_api_key), r.id]);
    }
    if (rows.length) ctx.log(`[migrate] encrypted ${rows.length} stored AI API key(s)`);
  }
};
