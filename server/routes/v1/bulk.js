const config = require('../../config');
const { HttpError, h } = require('../../lib/http');
const { uuidv4 } = require('../../lib/ids');
const { isStr, validNoteFields } = require('../../lib/validate');
const { assertNoteQuota } = require('../../lib/membership');
const { apiAuth, requirePermission, requireVaultScope } = require('../../middleware/api-token');
const { run, get } = require('../../db');

// API v1: bulk operations
function register(app) {
  app.post('/api/v1/vaults/:id/notes/bulk', ...apiAuth, requireVaultScope, requirePermission('write'), h(async (req, res) => {
    const notes = req.body && req.body.notes;
    if (!Array.isArray(notes) || notes.length === 0) throw new HttpError(400, 'notes must be a non-empty array', 'VALIDATION_ERROR');
    if (notes.length > config.bulkMax) throw new HttpError(400, `At most ${config.bulkMax} notes per request`, 'VALIDATION_ERROR');

    await assertNoteQuota(req.params.id, notes.length);
    const created = [];
    const errors = [];
    const now = Date.now();
    for (const [i, n] of notes.entries()) {
      try {
        if (!n || typeof n !== 'object') throw new HttpError(400, 'note must be an object');
        validNoteFields(n, { requireTitle: true });
        const id = uuidv4();
        await run('INSERT INTO notes (id, groupId, title, content, createdAt, updatedAt, isBookmarked) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.params.id, n.title.trim(), n.content || '', now, now, 0]);
        created.push({ id, title: n.title.trim(), createdAt: now });
      } catch (err) {
        errors.push({ index: i, error: err instanceof HttpError ? err.message : 'Could not create note' });
      }
    }
    res.status(errors.length === notes.length ? 400 : 201).json({ created, errors });
  }));

  app.delete('/api/v1/vaults/:id/notes/bulk', ...apiAuth, requireVaultScope, requirePermission('delete'), h(async (req, res) => {
    const noteIds = req.body && req.body.noteIds;
    if (!Array.isArray(noteIds) || noteIds.length === 0) throw new HttpError(400, 'noteIds must be a non-empty array', 'VALIDATION_ERROR');
    if (noteIds.length > config.bulkMax) throw new HttpError(400, `At most ${config.bulkMax} ids per request`, 'VALIDATION_ERROR');

    const deleted = [];
    const errors = [];
    for (const noteId of noteIds) {
      if (!isStr(noteId)) { errors.push({ noteId, error: 'Invalid id' }); continue; }
      const note = await get('SELECT id, groupId FROM notes WHERE id = ?', [noteId]);
      if (!note || note.groupId !== req.params.id) { errors.push({ noteId, error: 'Not found or not in this vault' }); continue; }
      await run('DELETE FROM notes WHERE id = ?', [noteId]);
      deleted.push(noteId);
    }
    res.json({ deleted, errors });
  }));
}

module.exports = register;
