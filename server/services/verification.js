const crypto = require('crypto');
const { run } = require('../db');
const { sha256 } = require('../lib/secret-box');
const { sendVerification } = require('./mailer');

const DAY = 86400000;

// Issues a fresh email-verification token (24 h) for a user and mails it. Never throws.
async function startEmailVerification(user) {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    await run('UPDATE users SET verify_token_hash = ?, verify_expires = ?, email_verified = 0 WHERE id = ?', [sha256(token), Date.now() + DAY, user.id]);
    await sendVerification(user, token);
  } catch (err) {
    console.error('Verification email error:', err.message);
  }
}

module.exports = { startEmailVerification };
