const express = require('express');
const config = require('../config');
const { authenticateJWT } = require('../lib/accounts');
const { HttpError, h } = require('../lib/http');
const { deleteGroupRows, createVault, newJoinCode, requireMembership } = require('../lib/membership');
const { isStr, validNoteFields } = require('../lib/validate');
const { audit } = require('../lib/audit');
const db = require('../db');
const { run, get, all } = db;

// Vaults (groups): membership, share codes, export and import
function register(app) {
  const vaultName = (name) => {
    if (!isStr(name) || !name.trim() || name.length > 100) throw new HttpError(400, 'Vault name must be 1-100 characters', 'VALIDATION_ERROR');
    return name.trim();
  };

  const importJson = express.json({ limit: '25mb' });

  // Members see the vault; only the owner also sees (and can manage) its share code.
  app.get('/api/groups/:id', authenticateJWT, h(async (req, res) => {
    const group = await get(
      'SELECT g.id, g.name, g.ownerId, g.join_code, g.join_enabled FROM groups g JOIN user_groups ug ON ug.groupId = g.id WHERE g.id = ? AND ug.userId = ?',
      [req.params.id, req.jwtUser.userId]
    );
    if (!group) throw new HttpError(404, 'Group not found', 'NOT_FOUND');
    const count = await get('SELECT COUNT(*) as count FROM user_groups WHERE groupId = ?', [group.id]);
    const isOwner = group.ownerId === req.jwtUser.userId;
    res.json({
      id: group.id, name: group.name, ownerId: group.ownerId, memberCount: count.count,
      ...(isOwner ? { joinCode: group.join_code, joinEnabled: !!group.join_enabled } : {})
    });
  }));

  app.post('/api/groups', authenticateJWT, h(async (req, res) => {
    const name = vaultName(req.body && req.body.name);
    const vault = await db.transaction((tx) => createVault(tx, {
      name, ownerId: req.jwtUser.userId, welcome: { title: 'Vault Info', content: `# ${name}\n\nWelcome to your new vault!` }
    }));
    res.json({ id: vault.id, name, ownerId: req.jwtUser.userId, joinCode: vault.joinCode, joinEnabled: true });
  }));

  app.put('/api/groups/:id', authenticateJWT, h(async (req, res) => {
    await requireMembership(req, req.params.id, { owner: true });
    await run('UPDATE groups SET name = ? WHERE id = ?', [vaultName(req.body && req.body.name), req.params.id]);
    res.json({ success: true });
  }));

  // Owner controls: turn joining on/off, or replace the share code (the old one stops working immediately).
  app.put('/api/groups/:id/sharing', authenticateJWT, h(async (req, res) => {
    await requireMembership(req, req.params.id, { owner: true });
    const { enabled, rotate } = req.body || {};
    if ((enabled !== undefined && typeof enabled !== 'boolean') || (rotate !== undefined && typeof rotate !== 'boolean')) {
      throw new HttpError(400, 'enabled and rotate must be booleans', 'VALIDATION_ERROR');
    }
    if (rotate) await run('UPDATE groups SET join_code = ? WHERE id = ?', [await newJoinCode(), req.params.id]);
    if (enabled !== undefined) await run('UPDATE groups SET join_enabled = ? WHERE id = ?', [enabled ? 1 : 0, req.params.id]);
    const g = await get('SELECT join_code, join_enabled FROM groups WHERE id = ?', [req.params.id]);
    audit(req, 'vault_sharing_changed', { target: req.params.id, detail: { rotate: !!rotate, enabled } });
    res.json({ joinCode: g.join_code, joinEnabled: !!g.join_enabled });
  }));

  // Joining requires the vault's current share code (for vaults created before 1.2 that is still the vault id).
  // `groupId` is the field name the web client has always used for the code.
  app.post('/api/groups/join', authenticateJWT, h(async (req, res) => {
    const code = req.body && (req.body.joinCode || req.body.groupId);
    if (!isStr(code) || !code || code.length > 64) throw new HttpError(400, 'A share code is required', 'VALIDATION_ERROR');
    const group = await get('SELECT id, name, ownerId FROM groups WHERE join_code = ? AND join_enabled = 1', [code]);
    if (!group) throw new HttpError(404, 'Group not found', 'NOT_FOUND'); // wrong, rotated or disabled: indistinguishable
    await run('INSERT OR IGNORE INTO user_groups (userId, groupId) VALUES (?, ?)', [req.jwtUser.userId, group.id]);
    res.json(group);
  }));

  app.post('/api/groups/leave', authenticateJWT, h(async (req, res) => {
    const group = await requireMembership(req, req.body && req.body.groupId);
    if (group.ownerId === req.jwtUser.userId) throw new HttpError(400, 'Owner cannot leave vault, must delete it', 'VALIDATION_ERROR');
    await run('DELETE FROM user_groups WHERE userId = ? AND groupId = ?', [req.jwtUser.userId, group.id]);
    res.json({ success: true });
  }));

  app.delete('/api/groups/:id', authenticateJWT, h(async (req, res) => {
    await requireMembership(req, req.params.id, { owner: true });
    await db.transaction((tx) => deleteGroupRows(tx, req.params.id));
    audit(req, 'vault_deleted', { target: req.params.id });
    res.json({ success: true });
  }));

  // --- Vault export / import ---
  app.get('/api/groups/:id/export', authenticateJWT, h(async (req, res) => {
    const group = await requireMembership(req, req.params.id);
    const notes = await all('SELECT id, title, content, createdAt, updatedAt, isBookmarked FROM notes WHERE groupId = ? ORDER BY createdAt ASC', [group.id]);
    res.json({
      __netherite_export_version: 1,
      exportedAt: Date.now(),
      vault: { name: group.name },
      notes: notes.map((n) => ({
        id: n.id, title: n.title || '', content: n.content || '', createdAt: n.createdAt, updatedAt: n.updatedAt, isBookmarked: !!n.isBookmarked
      }))
    });
  }));

  // Large body allowed here only; authentication runs before the body is read.
  app.post('/api/groups/import', authenticateJWT, importJson, h(async (req, res) => {
    const data = req.body;
    if (!data || data.__netherite_export_version !== 1) throw new HttpError(400, 'Invalid or unsupported export file format', 'VALIDATION_ERROR');
    if (!data.vault || !isStr(data.vault.name)) throw new HttpError(400, 'Export file is missing vault metadata', 'VALIDATION_ERROR');
    if (!Array.isArray(data.notes)) throw new HttpError(400, 'Export file is missing notes array', 'VALIDATION_ERROR');
    if (data.notes.length > config.importMaxNotes || data.notes.length > config.maxNotesPerVault) {
      throw new HttpError(413, `Import is limited to ${Math.min(config.importMaxNotes, config.maxNotesPerVault)} notes`, 'PAYLOAD_TOO_LARGE');
    }

    const vaultTitle = `${data.vault.name.slice(0, 80)} (Imported)`;
    const now = Date.now();
    const cleaned = data.notes.map((n) => {
      if (!n || typeof n !== 'object') throw new HttpError(400, 'Export file contains an invalid note', 'VALIDATION_ERROR');
      const title = n.title === undefined || n.title === null ? '' : n.title;
      const content = n.content === undefined || n.content === null ? '' : n.content;
      validNoteFields({ title, content });
      const ts = (v) => (Number.isFinite(v) ? v : now);
      return { title, content, createdAt: ts(n.createdAt), updatedAt: ts(n.updatedAt), isBookmarked: n.isBookmarked ? 1 : 0 };
    });

    const vault = await db.transaction(async (tx) => {
      const created = await createVault(tx, { name: vaultTitle, ownerId: req.jwtUser.userId });
      for (const n of cleaned) {
        await tx.run('INSERT INTO notes (id, groupId, title, content, createdAt, updatedAt, isBookmarked) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          require('crypto').randomUUID(), created.id, n.title, n.content, n.createdAt, n.updatedAt, n.isBookmarked
        ]);
      }
      return created;
    });
    res.status(201).json({ id: vault.id, name: vaultTitle, ownerId: req.jwtUser.userId, noteCount: cleaned.length });
  }));
}

module.exports = register;
