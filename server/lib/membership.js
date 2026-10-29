const { HttpError } = require('./http');
const crypto = require('crypto');
const { randomId } = require('./ids');
const { isStr } = require('./validate');
const config = require('../config');
const { get } = require('../db');

async function requireMembership(req, groupId, { owner = false } = {}) {
  if (!isStr(groupId) || !groupId) throw new HttpError(400, 'groupId is required', 'VALIDATION_ERROR');
  const row = await get(
    'SELECT g.id, g.name, g.ownerId FROM groups g JOIN user_groups ug ON ug.groupId = g.id WHERE g.id = ? AND ug.userId = ?',
    [groupId, req.jwtUser.userId]
  );
  if (!row) throw new HttpError(403, 'You are not a member of this vault', 'FORBIDDEN');
  if (owner && row.ownerId !== req.jwtUser.userId) throw new HttpError(403, 'Only the vault owner can do this', 'FORBIDDEN');
  return row;
}

// New vault ids and share codes are 12 random characters (CSPRNG). Older 7-character ids stay valid.
// A code never equals any existing id or share code, so a join can only ever match one vault.
async function uniqueCode(db, avoid = []) {
  for (;;) {
    const code = randomId(12);
    if (avoid.includes(code)) continue;
    if (!(await db.get('SELECT 1 AS x FROM groups WHERE id = ? OR join_code = ?', [code, code]))) return code;
  }
}

// Inserts a vault (+ owner membership, + optional first note) using the given transaction handle.
async function createVault(tx, { name, ownerId, welcome = null }) {
  const id = await uniqueCode(tx);
  const joinCode = await uniqueCode(tx, [id]);
  await tx.run('INSERT INTO groups (id, name, ownerId, join_code, join_enabled) VALUES (?, ?, ?, ?, 1)', [id, name, ownerId, joinCode]);
  await tx.run('INSERT INTO user_groups (userId, groupId) VALUES (?, ?)', [ownerId, id]);
  if (welcome) {
    const now = Date.now();
    await tx.run('INSERT INTO notes (id, groupId, title, content, createdAt, updatedAt, isBookmarked) VALUES (?, ?, ?, ?, ?, ?, 0)', [
      crypto.randomUUID(), id, welcome.title, welcome.content, now, now
    ]);
  }
  return { id, joinCode };
}

async function newJoinCode() {
  return uniqueCode({ get });
}

// Keeps one vault from consuming unbounded storage.
async function assertNoteQuota(groupId, adding = 1) {
  const { c } = await get('SELECT COUNT(*) AS c FROM notes WHERE groupId = ?', [groupId]);
  if (c + adding > config.maxNotesPerVault) throw new HttpError(413, `This vault is limited to ${config.maxNotesPerVault} notes`, 'QUOTA_EXCEEDED');
}

async function deleteGroupRows(tx, groupId) {
  await tx.run('DELETE FROM notes WHERE groupId = ?', [groupId]);
  await tx.run('DELETE FROM api_tokens WHERE group_id = ?', [groupId]);
  await tx.run('DELETE FROM user_groups WHERE groupId = ?', [groupId]);
  await tx.run('DELETE FROM groups WHERE id = ?', [groupId]);
}

module.exports = { requireMembership, createVault, newJoinCode, assertNoteQuota, deleteGroupRows };
