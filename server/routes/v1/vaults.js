const { HttpError, h } = require('../../lib/http');
const { isStr, likePattern } = require('../../lib/validate');
const { apiAuth, requirePermission, requireVaultScope } = require('../../middleware/api-token');
const { get, all } = require('../../db');

// API v1: vault details and note listing
function register(app) {
  app.get('/api/v1/vaults/:id', ...apiAuth, requireVaultScope, requirePermission('read'), h(async (req, res) => {
    const vault = await get('SELECT id, name, ownerId FROM groups WHERE id = ?', [req.params.id]);
    if (!vault) throw new HttpError(404, 'Vault not found', 'NOT_FOUND');
    const stats = await get('SELECT COUNT(*) as noteCount FROM notes WHERE groupId = ?', [req.params.id]);
    res.json({ vault: { id: vault.id, name: vault.name, ownerId: vault.ownerId }, stats: { noteCount: stats.noteCount } });
  }));

  app.get('/api/v1/vaults/:id/notes', ...apiAuth, requireVaultScope, requirePermission('read'), h(async (req, res) => {
    let { limit = 50, offset = 0, sortBy = 'updatedAt', sortOrder = 'desc', search } = req.query;
    limit = Math.min(parseInt(limit) || 50, 200);
    offset = Math.max(parseInt(offset) || 0, 0);
    if (!['createdAt', 'updatedAt', 'title'].includes(sortBy)) sortBy = 'updatedAt';
    if (!['asc', 'desc'].includes(sortOrder)) sortOrder = 'desc';

    const cols = "id, groupId, COALESCE(title,'') as title, COALESCE(content,'') as content, createdAt, updatedAt, isBookmarked";
    const searching = isStr(search) && search;
    const where = searching ? "groupId = ? AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')" : 'groupId = ?';
    const filter = searching ? [req.params.id, likePattern(search), likePattern(search)] : [req.params.id];

    const notes = await all(`SELECT ${cols} FROM notes WHERE ${where} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`, [...filter, limit, offset]);
    const count = await get(`SELECT COUNT(*) as total FROM notes WHERE ${where}`, filter);
    res.json({
      notes: notes.map((n) => ({ ...n, isBookmarked: !!n.isBookmarked })),
      pagination: { total: count.total, limit, offset, hasMore: offset + notes.length < count.total }
    });
  }));
}

module.exports = register;
