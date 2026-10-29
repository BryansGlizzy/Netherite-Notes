// Email verification + hashed reset tokens.
//  - users get email_verified / verify_token_hash / verify_expires / reset_token_hash
//  - addresses already listed in ADMIN_EMAILS count as verified (the operator vouched for them)
//  - any in-flight plaintext reset token is converted to its hash and the plaintext column cleared
//    (such links live for at most one hour, so this is invisible to users)
const crypto = require('crypto');
const config = require('../../config');

module.exports = {
  version: 5,
  name: 'email_verification',
  async up(tx, ctx) {
    await ctx.addColumnIfMissing('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
    await ctx.addColumnIfMissing('users', 'verify_token_hash', 'TEXT');
    await ctx.addColumnIfMissing('users', 'verify_expires', 'INTEGER');
    await ctx.addColumnIfMissing('users', 'reset_token_hash', 'TEXT');

    for (const email of config.adminEmails) {
      const r = await tx.run('UPDATE users SET email_verified = 1 WHERE lower(email) = ?', [email]);
      if (r.changes) ctx.log(`[migrate] ${email} marked as verified (listed in ADMIN_EMAILS)`);
    }

    const pending = await tx.all('SELECT id, reset_token FROM users WHERE reset_token IS NOT NULL');
    for (const u of pending) {
      await tx.run('UPDATE users SET reset_token_hash = ?, reset_token = NULL WHERE id = ?', [crypto.createHash('sha256').update(u.reset_token).digest('hex'), u.id]);
    }
  }
};
