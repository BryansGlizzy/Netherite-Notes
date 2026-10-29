const config = require('../../config');
const { authenticateJWT } = require('../../lib/accounts');
const { HttpError, h } = require('../../lib/http');
const { isStr } = require('../../lib/validate');
const { audit } = require('../../lib/audit');
const { generateApiToken, requireVaultOwner } = require('../../middleware/api-token');
const { run, get, all } = require('../../db');

// API v1: token management (vault owner, JWT)
function register(app) {
  app.post('/api/v1/vaults/:id/tokens', authenticateJWT, requireVaultOwner, h(async (req, res) => {
    const { name, permissions = ['read'], expiresAt } = req.body || {};
    if (name !== undefined && name !== null && (!isStr(name) || name.length > 100)) throw new HttpError(400, 'name must be a string of at most 100 characters', 'VALIDATION_ERROR');
    if (expiresAt !== undefined && expiresAt !== null && (!Number.isInteger(expiresAt) || expiresAt <= Date.now())) {
      throw new HttpError(400, 'expiresAt must be a future unix timestamp in milliseconds', 'VALIDATION_ERROR');
    }
    const valid = ['read', 'write', 'delete', 'admin'];
    const sanitized = (Array.isArray(permissions) ? permissions : ['read']).filter((p) => valid.includes(p));
    if (sanitized.length === 0) throw new HttpError(400, 'At least one valid permission required', 'VALIDATION_ERROR');

    const active = await get('SELECT COUNT(*) as c FROM api_tokens WHERE group_id = ? AND is_active = 1', [req.params.id]);
    if (active.c >= config.maxTokensPerVault) throw new HttpError(400, `A vault can have at most ${config.maxTokensPerVault} active tokens; revoke one first`, 'LIMIT_REACHED');

    const created = await generateApiToken(req.params.id, name, sanitized, expiresAt || null);
    audit(req, 'api_token_created', { target: req.params.id, detail: { id: created.id, permissions: sanitized } });
    res.status(201).json({ token: created });
  }));

  app.get('/api/v1/vaults/:id/tokens', authenticateJWT, requireVaultOwner, h(async (req, res) => {
    const tokens = await all('SELECT id, token_prefix, name, permissions, created_at, last_used_at, expires_at, is_active FROM api_tokens WHERE group_id = ?', [req.params.id]);
    res.json({
      tokens: tokens.map((t) => ({
        id: t.id, tokenPrefix: t.token_prefix, name: t.name, permissions: JSON.parse(t.permissions),
        createdAt: t.created_at, lastUsedAt: t.last_used_at, expiresAt: t.expires_at, isActive: !!t.is_active
      }))
    });
  }));

  app.delete('/api/v1/vaults/:id/tokens/:tokenId', authenticateJWT, requireVaultOwner, h(async (req, res) => {
    const token = await get('SELECT id FROM api_tokens WHERE id = ? AND group_id = ?', [req.params.tokenId, req.params.id]);
    if (!token) throw new HttpError(404, 'Token not found', 'NOT_FOUND');
    await run('UPDATE api_tokens SET is_active = 0 WHERE id = ?', [req.params.tokenId]);
    audit(req, 'api_token_revoked', { target: req.params.id, detail: { id: token.id } });
    res.json({ success: true });
  }));
}

module.exports = register;
