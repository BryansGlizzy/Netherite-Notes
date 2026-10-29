const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const { get, all } = db;
const { HttpError, h } = require('../lib/http');
const { validUsername, validPassword, USERNAME_MSG, PASSWORD_MSG, normalizeEmail } = require('../lib/validate');
const { isAdminUser, authenticateJWT, requireAdmin } = require('../lib/accounts');
const { deleteGroupRows } = require('../lib/membership');
const { sha256 } = require('../lib/secret-box');
const { audit } = require('../lib/audit');

// Admin panel (JWT + ADMIN_EMAILS + verified email)
function register(app) {
  app.get('/api/admin/users', authenticateJWT, requireAdmin, h(async (req, res) => {
    const users = await all('SELECT id, username, email, email_verified FROM users ORDER BY username COLLATE NOCASE ASC');
    const result = [];
    for (const u of users) {
      const groups = await all('SELECT g.id, g.name, g.ownerId FROM groups g JOIN user_groups ug ON g.id = ug.groupId WHERE ug.userId = ?', [u.id]);
      const noteCount = await get('SELECT COUNT(*) as count FROM notes n JOIN user_groups ug ON n.groupId = ug.groupId WHERE ug.userId = ?', [u.id]);
      result.push({ id: u.id, username: u.username, email: u.email, emailVerified: !!u.email_verified, isAdmin: isAdminUser(u), groups, noteCount: noteCount ? noteCount.count : 0 });
    }
    res.json({ users: result });
  }));

  app.put('/api/admin/users/:id', authenticateJWT, requireAdmin, h(async (req, res) => {
    const { username, email, newPassword } = req.body || {};
    const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');

    if (username !== undefined && username !== user.username) {
      if (!validUsername(username)) throw new HttpError(400, USERNAME_MSG, 'VALIDATION_ERROR');
      if (await get('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?', [username, user.id])) throw new HttpError(400, 'Username already taken', 'CONFLICT');
    }
    let emailNorm;
    if (email !== undefined && email !== null && email !== '') {
      emailNorm = normalizeEmail(email);
      if (await get('SELECT id FROM users WHERE lower(email) = ? AND id != ?', [emailNorm, user.id])) throw new HttpError(400, 'Email already in use', 'CONFLICT');
    }
    if (newPassword !== undefined && newPassword !== '' && !validPassword(newPassword)) throw new HttpError(400, PASSWORD_MSG, 'VALIDATION_ERROR');

    const hash = newPassword ? await bcrypt.hash(newPassword, 12) : null;
    await db.transaction(async (tx) => {
      if (username !== undefined && username !== user.username) await tx.run('UPDATE users SET username = ? WHERE id = ?', [username, user.id]);
      // an address set by an administrator is vouched for by them, so it counts as verified
      if (emailNorm) await tx.run('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?', [emailNorm, user.id]);
      else if (email === null || email === '') await tx.run('UPDATE users SET email = NULL, email_verified = 0 WHERE id = ?', [user.id]);
      if (hash) await tx.run('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?', [hash, user.id]);
    });
    audit(req, 'admin_update_user', { target: user.id, detail: { username: username !== undefined && username !== user.username, email: email !== undefined, password: !!hash } });

    const updated = await get('SELECT id, username, email, email_verified FROM users WHERE id = ?', [user.id]);
    res.json({ user: { id: updated.id, username: updated.username, email: updated.email, isAdmin: isAdminUser(updated) } });
  }));

  app.delete('/api/admin/users/:id', authenticateJWT, requireAdmin, h(async (req, res) => {
    const user = await get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
    if (req.jwtUser.userId === user.id) throw new HttpError(400, 'Cannot delete your own account', 'VALIDATION_ERROR');

    await db.transaction(async (tx) => {
      const owned = await tx.all('SELECT id FROM groups WHERE ownerId = ?', [user.id]);
      for (const g of owned) await deleteGroupRows(tx, g.id);
      await tx.run('DELETE FROM user_groups WHERE userId = ?', [user.id]);
      await tx.run('DELETE FROM users WHERE id = ?', [user.id]);
    });
    audit(req, 'admin_delete_user', { target: user.id, detail: { username: user.username } });
    res.json({ success: true, deletedUserId: user.id });
  }));

  // --- Audit log ---
  app.get('/api/admin/audit', authenticateJWT, requireAdmin, h(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
    const rows = await all(
      `SELECT a.id, a.ts, a.action, a.target, a.ip, a.detail, a.actor_id AS actorId, u.username AS actorName
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT ?`,
      [limit]
    );
    res.json({ events: rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) });
  }));

  // --- Invite codes (used when REGISTRATION=invite) ---
  app.post('/api/admin/invites', authenticateJWT, requireAdmin, h(async (req, res) => {
    const days = req.body && req.body.expiresInDays;
    if (days !== undefined && days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new HttpError(400, 'expiresInDays must be an integer between 1 and 365', 'VALIDATION_ERROR');
    const code = 'nti_' + crypto.randomBytes(12).toString('base64url');
    const expiresAt = days ? Date.now() + days * 86400000 : null;
    const r = await db.run('INSERT INTO invites (code_hash, code_prefix, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [sha256(code), code.slice(0, 8), req.jwtUser.userId, Date.now(), expiresAt]);
    audit(req, 'invite_created', { target: code.slice(0, 8) });
    res.status(201).json({ id: r.lastID, code, codePrefix: code.slice(0, 8), expiresAt }); // the code is shown only now
  }));

  app.get('/api/admin/invites', authenticateJWT, requireAdmin, h(async (req, res) => {
    const rows = await all(
      `SELECT i.id, i.code_prefix AS codePrefix, i.created_at AS createdAt, i.expires_at AS expiresAt, i.used_at AS usedAt, u.username AS usedByName
       FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.id DESC LIMIT 200`
    );
    res.json({ invites: rows });
  }));

  app.delete('/api/admin/invites/:id', authenticateJWT, requireAdmin, h(async (req, res) => {
    const r = await db.run('DELETE FROM invites WHERE id = ? AND used_at IS NULL', [req.params.id]);
    if (!r.changes) throw new HttpError(404, 'Invite not found or already used', 'NOT_FOUND');
    audit(req, 'invite_revoked', { target: req.params.id });
    res.json({ success: true });
  }));
}

module.exports = register;
