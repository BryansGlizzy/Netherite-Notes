const bcrypt = require('bcrypt');
const db = require('../db');
const { get, all } = db;
const { HttpError, h } = require('../lib/http');
const { isStr, validUsername, validPassword, USERNAME_MSG, PASSWORD_MSG, normalizeEmail } = require('../lib/validate');
const { isAdminEmail, authResponse, authenticateJWT } = require('../lib/accounts');
const { encrypt, decrypt } = require('../lib/secret-box');
const { audit } = require('../lib/audit');
const { startEmailVerification } = require('../services/verification');

// Current-user profile and settings
function register(app) {
  app.get('/api/user/:id', authenticateJWT, h(async (req, res) => {
    if (req.params.id !== req.jwtUser.userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
    const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
    const groups = await all('SELECT groupId FROM user_groups WHERE userId = ?', [user.id]);
    const { token, ...rest } = authResponse(user, groups.map((g) => g.groupId));
    res.json(rest);
  }));

  // The AI key is fetched on demand (when the AI panel opens) instead of travelling with every login/profile response.
  app.get('/api/user/:id/ai-config', authenticateJWT, h(async (req, res) => {
    if (req.params.id !== req.jwtUser.userId) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
    const user = await get('SELECT ai_endpoint, ai_api_key_enc, ai_model FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
    res.set('Cache-Control', 'no-store');
    res.json({ aiEndpoint: user.ai_endpoint || '', aiApiKey: decrypt(user.ai_api_key_enc) || '', aiModel: user.ai_model || '' });
  }));

  app.put('/api/user/:id/settings', authenticateJWT, h(async (req, res) => {
    if (req.jwtUser.userId !== req.params.id) throw new HttpError(403, 'You can only modify your own account', 'FORBIDDEN');
    const { username, currentPassword, newPassword, email, aiEndpoint, aiApiKey, aiModel, keybindSplitBlock, keybindNewLine } = req.body || {};

    const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');

    const short = (v, max, name) => {
      if (v !== undefined && v !== null && (!isStr(v) || v.length > max)) throw new HttpError(400, `${name} must be a string of at most ${max} characters`, 'VALIDATION_ERROR');
    };
    short(aiApiKey, 512, 'aiApiKey'); short(aiModel, 200, 'aiModel'); short(keybindSplitBlock, 40, 'keybindSplitBlock'); short(keybindNewLine, 40, 'keybindNewLine');
    if (aiEndpoint !== undefined && aiEndpoint !== null && aiEndpoint !== '' && (!isStr(aiEndpoint) || aiEndpoint.length > 2048 || !/^https?:\/\//i.test(aiEndpoint))) {
      throw new HttpError(400, 'aiEndpoint must be an http(s) URL', 'VALIDATION_ERROR');
    }

    let passwordHash = null;
    if (newPassword !== undefined && newPassword !== '') {
      if (!isStr(currentPassword) || !currentPassword) throw new HttpError(400, 'Current password is required to change password', 'VALIDATION_ERROR');
      if (!(await bcrypt.compare(currentPassword, user.password))) throw new HttpError(401, 'Current password is incorrect', 'INVALID_CREDENTIALS');
      if (!validPassword(newPassword)) throw new HttpError(400, PASSWORD_MSG, 'VALIDATION_ERROR');
      passwordHash = await bcrypt.hash(newPassword, 12);
    }

    if (username !== undefined && username !== user.username) {
      if (!validUsername(username)) throw new HttpError(400, USERNAME_MSG, 'VALIDATION_ERROR');
      if (await get('SELECT id FROM users WHERE (username = ? COLLATE NOCASE OR lower(email) = ?) AND id != ?', [username, username.toLowerCase(), user.id])) {
        throw new HttpError(400, 'Username already taken', 'CONFLICT');
      }
    }

    let emailNorm;
    if (email !== undefined) {
      if (user.email) throw new HttpError(400, 'Email is already set and cannot be changed', 'CONFLICT');
      emailNorm = normalizeEmail(email);
      if (isAdminEmail(emailNorm)) throw new HttpError(403, 'This email address is reserved', 'FORBIDDEN');
      if (await get('SELECT id FROM users WHERE lower(email) = ?', [emailNorm])) throw new HttpError(400, 'Email already in use', 'CONFLICT');
    }

    await db.transaction(async (tx) => {
      if (passwordHash) await tx.run('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?', [passwordHash, user.id]);
      if (username !== undefined && username !== user.username) await tx.run('UPDATE users SET username = ? WHERE id = ?', [username, user.id]);
      if (emailNorm) await tx.run('UPDATE users SET email = ?, email_verified = 0 WHERE id = ?', [emailNorm, user.id]);
      if (aiEndpoint !== undefined) await tx.run('UPDATE users SET ai_endpoint = ? WHERE id = ?', [aiEndpoint, user.id]);
      if (aiApiKey !== undefined) await tx.run('UPDATE users SET ai_api_key_enc = ? WHERE id = ?', [aiApiKey ? encrypt(aiApiKey) : null, user.id]);
      if (aiModel !== undefined) await tx.run('UPDATE users SET ai_model = ? WHERE id = ?', [aiModel, user.id]);
      if (keybindSplitBlock !== undefined) await tx.run('UPDATE users SET keybind_split_block = ? WHERE id = ?', [keybindSplitBlock, user.id]);
      if (keybindNewLine !== undefined) await tx.run('UPDATE users SET keybind_new_line = ? WHERE id = ?', [keybindNewLine, user.id]);
    });

    if (passwordHash) audit(req, 'password_changed');
    if (emailNorm) {
      audit(req, 'email_set', { detail: { verified: false } });
      startEmailVerification({ id: user.id, username: username || user.username, email: emailNorm });
    }

    const updated = await get('SELECT * FROM users WHERE id = ?', [user.id]);
    const { groupIds, ...rest } = authResponse(updated, []);
    res.json(rest); // fresh JWT carries the (possibly bumped) token version, so this session continues
  }));
}

module.exports = register;
