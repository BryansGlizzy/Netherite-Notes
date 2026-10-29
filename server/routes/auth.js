const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { get, all, run } = db;
const { HttpError, h } = require('../lib/http');
const {
  isStr, validUsername, validPassword, USERNAME_MSG, PASSWORD_MSG, normalizeEmail, HEX64_RE
} = require('../lib/validate');
const { isAdminEmail, authResponse, authenticateJWT } = require('../lib/accounts');
const { createVault } = require('../lib/membership');
const { uuidv4 } = require('../lib/ids');
const { sha256 } = require('../lib/secret-box');
const { audit } = require('../lib/audit');
const { sendPasswordReset } = require('../services/mailer');
const { startEmailVerification } = require('../services/verification');
const { registerLimiter, loginIpLimiter, loginUserLimiter, forgotIpLimiter, forgotEmailLimiter } = require('../middleware/rate-limits');

// Compared against when the user doesn't exist, so response time doesn't reveal which names exist.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);
const HOUR = 3600000;

function register(app) {
  // Public, minimal: lets the sign-up form know whether an invite code is needed.
  app.get('/api/auth/config', (req, res) => res.json({ registration: config.registration }));

  app.post('/api/register', registerLimiter, h(async (req, res) => {
    if (config.registration === 'closed') throw new HttpError(403, 'Registration is closed on this server', 'REGISTRATION_CLOSED');
    const { username, password, email, inviteCode } = req.body || {};
    if (!isStr(username) || !isStr(password)) throw new HttpError(400, 'Missing fields', 'VALIDATION_ERROR');
    if (!validUsername(username)) throw new HttpError(400, USERNAME_MSG, 'VALIDATION_ERROR');
    if (!validPassword(password)) throw new HttpError(400, PASSWORD_MSG, 'VALIDATION_ERROR');

    let emailNorm = null;
    if (email !== undefined && email !== null && email !== '') {
      emailNorm = normalizeEmail(email);
      if (isAdminEmail(emailNorm)) throw new HttpError(403, 'This email address is reserved', 'FORBIDDEN');
    }
    let inviteHash = null;
    if (config.registration === 'invite') {
      if (!isStr(inviteCode) || !inviteCode.trim()) throw new HttpError(403, 'An invite code is required to sign up', 'INVITE_REQUIRED');
      inviteHash = sha256(inviteCode.trim());
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    let groupId;
    try {
      await db.transaction(async (tx) => {
        if (inviteHash) {
          const inv = await tx.get('SELECT id FROM invites WHERE code_hash = ? AND used_at IS NULL AND (expires_at IS NULL OR expires_at > ?)', [inviteHash, Date.now()]);
          if (!inv) throw new HttpError(403, 'Invalid, expired or already used invite code', 'INVITE_INVALID');
          await tx.run('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?', [userId, Date.now(), inv.id]);
        }
        const taken = await tx.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR lower(email) = ?', [username, username.toLowerCase()]);
        if (taken) throw new HttpError(400, 'User already exists', 'CONFLICT');
        if (emailNorm && (await tx.get('SELECT id FROM users WHERE lower(email) = ?', [emailNorm]))) throw new HttpError(400, 'Email already in use', 'CONFLICT');

        await tx.run('INSERT INTO users (id, username, password, email) VALUES (?, ?, ?, ?)', [userId, username, passwordHash, emailNorm]);
        groupId = (await createVault(tx, {
          name: 'My Vault', ownerId: userId,
          welcome: { title: 'Welcome', content: '# Welcome to Netherite Notes\n\nThis is your first note. Try creating links like [[Ideas]].' }
        })).id;
      });
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT') throw new HttpError(400, 'User already exists', 'CONFLICT');
      throw err;
    }

    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (emailNorm) startEmailVerification(user); // async; the account works before the address is verified
    audit(req, 'register', { actor: userId, target: username });
    res.json(authResponse(user, [groupId]));
  }));

  app.post('/api/login', loginIpLimiter, loginUserLimiter, h(async (req, res) => {
    const { username, password } = req.body || {};
    if (!isStr(username) || !isStr(password) || !username || username.length > 254 || password.length > 1024) {
      throw new HttpError(400, 'Username and password are required', 'VALIDATION_ERROR');
    }
    const ident = username.trim();
    // Exact-case match wins. A case-insensitive match is used only when it is unambiguous, because
    // databases created before usernames were case-insensitively unique can hold e.g. "Sam" and "sam".
    const byName = async () => {
      const exact = await get('SELECT * FROM users WHERE username = ?', [ident]);
      if (exact) return exact;
      const loose = await all('SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 2', [ident]);
      return loose.length === 1 ? loose[0] : null;
    };
    const byEmail = () => get('SELECT * FROM users WHERE lower(email) = ?', [ident.toLowerCase()]);
    const user = ident.includes('@') ? (await byEmail()) || (await byName()) : (await byName()) || (await byEmail());

    const valid = await bcrypt.compare(password, user ? user.password || DUMMY_HASH : DUMMY_HASH);
    if (!user || !valid) {
      audit(req, 'login_failed', { actor: user ? user.id : null, target: ident.slice(0, 64) });
      throw new HttpError(401, 'Invalid credentials', 'INVALID_CREDENTIALS');
    }

    const groups = await all('SELECT groupId FROM user_groups WHERE userId = ?', [user.id]);
    audit(req, 'login', { actor: user.id });
    res.json(authResponse(user, groups.map((g) => g.groupId)));
  }));

  // --- Email verification ---
  app.post('/api/auth/verify-email', loginIpLimiter, h(async (req, res) => {
    const token = req.body && req.body.token;
    if (!isStr(token) || !HEX64_RE.test(token)) throw new HttpError(400, 'Invalid or expired verification link', 'INVALID_TOKEN');
    const user = await get('SELECT id FROM users WHERE verify_token_hash = ? AND verify_expires > ?', [sha256(token), Date.now()]);
    if (!user) throw new HttpError(400, 'Invalid or expired verification link', 'INVALID_TOKEN');
    await run('UPDATE users SET email_verified = 1, verify_token_hash = NULL, verify_expires = NULL WHERE id = ?', [user.id]);
    audit(req, 'email_verified', { actor: user.id });
    res.json({ success: true });
  }));

  app.post('/api/auth/resend-verification', authenticateJWT, forgotIpLimiter, h(async (req, res) => {
    const user = await get('SELECT id, username, email, email_verified FROM users WHERE id = ?', [req.jwtUser.userId]);
    if (!user.email || user.email_verified) throw new HttpError(400, 'There is no unverified email on this account', 'VALIDATION_ERROR');
    startEmailVerification(user);
    res.json({ success: true });
  }));

  // --- Password reset ---
  app.post('/api/auth/forgot-password', forgotIpLimiter, forgotEmailLimiter, h(async (req, res) => {
    const raw = req.body && req.body.email;
    if (!isStr(raw) || !raw.trim()) throw new HttpError(400, 'Email is required', 'VALIDATION_ERROR');
    const email = raw.trim().toLowerCase();

    // Respond immediately and do the work afterwards: same answer and timing whether or not the address exists.
    res.json({ success: true });

    setImmediate(async () => {
      try {
        const user = await get('SELECT id, username, email FROM users WHERE lower(email) = ?', [email]);
        if (!user) return;
        const token = crypto.randomBytes(32).toString('hex');
        // only the hash is stored: a database leak does not yield usable reset links
        await run('UPDATE users SET reset_token_hash = ?, reset_expires = ? WHERE id = ?', [sha256(token), Date.now() + HOUR, user.id]);
        await sendPasswordReset(user, token);
        audit(req, 'password_reset_requested', { actor: user.id });
      } catch (err) {
        console.error('Forgot password error:', err.message);
      }
    });
  }));

  app.post('/api/auth/reset-password', loginIpLimiter, h(async (req, res) => {
    const { token, newPassword } = req.body || {};
    if (!isStr(token) || !isStr(newPassword)) throw new HttpError(400, 'Token and new password are required', 'VALIDATION_ERROR');
    if (!validPassword(newPassword)) throw new HttpError(400, PASSWORD_MSG, 'VALIDATION_ERROR');
    if (!HEX64_RE.test(token)) throw new HttpError(400, 'Invalid or expired reset token', 'INVALID_TOKEN');

    const user = await get('SELECT id FROM users WHERE reset_token_hash = ? AND reset_expires > ?', [sha256(token), Date.now()]);
    if (!user) throw new HttpError(400, 'Invalid or expired reset token', 'INVALID_TOKEN');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    // bumping token_version signs out every existing session
    await run('UPDATE users SET password = ?, reset_token_hash = NULL, reset_expires = NULL, token_version = token_version + 1 WHERE id = ?', [passwordHash, user.id]);
    audit(req, 'password_reset', { actor: user.id });
    res.json({ success: true });
  }));
}

module.exports = register;
