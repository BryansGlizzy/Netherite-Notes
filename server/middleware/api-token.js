const { limiter, MIN } = require('./rate-limits');
const crypto = require('crypto');
const config = require('../config');
const { HttpError, h, sendError } = require('../lib/http');
const { run, get } = require('../db');

const hashToken = (rawToken) => crypto.createHmac('sha256', config.tokenSecret).update(rawToken).digest('hex');

async function generateApiToken(groupId, name, permissions, expiresAt) {
  const rawToken = 'nt_' + crypto.randomBytes(16).toString('hex');
  const tokenPrefix = rawToken.substring(0, 11); // "nt_" + first 8 chars
  const now = Date.now();
  const result = await run(
    'INSERT INTO api_tokens (group_id, token_hash, token_prefix, name, permissions, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [groupId, hashToken(rawToken), tokenPrefix, name || null, JSON.stringify(permissions), now, expiresAt || null]
  );
  return { id: result.lastID, token: rawToken, tokenPrefix, name: name || null, permissions, createdAt: now, expiresAt: expiresAt || null };
}

const authenticateApiToken = h(async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new HttpError(401, 'Missing or malformed Authorization header', 'UNAUTHORIZED');
  const rawToken = auth.slice(7).trim();
  if (!rawToken.startsWith('nt_')) throw new HttpError(401, 'Invalid token format', 'UNAUTHORIZED');

  const apiToken = await get('SELECT * FROM api_tokens WHERE token_hash = ? AND is_active = 1', [hashToken(rawToken)]);
  if (!apiToken) throw new HttpError(401, 'Token is invalid or has been revoked', 'TOKEN_REVOKED');
  if (apiToken.expires_at && apiToken.expires_at < Date.now()) throw new HttpError(401, 'Token has expired', 'TOKEN_EXPIRED');

  req.apiTokenId = apiToken.id;
  req.groupId = apiToken.group_id;
  req.permissions = JSON.parse(apiToken.permissions);

  // Fire-and-forget last_used_at update (throttled to 5 min)
  if (!apiToken.last_used_at || Date.now() - apiToken.last_used_at > 300_000) {
    run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', [Date.now(), apiToken.id]).catch((err) => console.error('last_used_at update failed:', err));
  }
  next();
});

const requirePermission = (permission) => (req, res, next) => {
  if (!req.permissions || !req.permissions.includes(permission)) {
    return sendError(req, res, 403, 'INSUFFICIENT_PERMISSIONS', `This token requires the '${permission}' permission`);
  }
  next();
};

function requireVaultScope(req, res, next) {
  if (req.groupId !== req.params.id) return sendError(req, res, 403, 'INSUFFICIENT_PERMISSIONS', 'Token is not scoped to this vault');
  next();
}

// Token management is for a signed-in vault owner (JWT), never for a bare user id.
const requireVaultOwner = h(async (req, res, next) => {
  const group = await get('SELECT * FROM groups WHERE id = ?', [req.params.id]);
  if (!group || group.ownerId !== req.jwtUser.userId) throw new HttpError(403, 'Only the vault owner can manage tokens', 'INSUFFICIENT_PERMISSIONS');
  req.group = group;
  next();
});

async function tokenNote(req, columns) {
  const note = await get(`SELECT ${columns} FROM notes WHERE id = ?`, [req.params.id]);
  if (!note) throw new HttpError(404, 'Note not found', 'NOT_FOUND');
  if (note.groupId !== req.groupId) throw new HttpError(403, "Token not scoped to this note's vault", 'INSUFFICIENT_PERMISSIONS');
  return note;
}

// Authenticate the token, then apply the per-token request budget.
const apiAuth = [authenticateApiToken, limiter({ windowMs: MIN, limit: config.limits.v1TokenMax, key: (req) => `token:${req.apiTokenId}` })];

module.exports = { generateApiToken, authenticateApiToken, requirePermission, requireVaultScope, requireVaultOwner, apiAuth, tokenNote };
