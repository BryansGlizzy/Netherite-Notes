const { h } = require('../../lib/http');
const { uuidv4 } = require('../../lib/ids');
const { validNoteFields } = require('../../lib/validate');
const { assertNoteQuota } = require('../../lib/membership');
const { apiAuth, requirePermission, tokenNote } = require('../../middleware/api-token');
const { run, get } = require('../../db');

// API v1: single-note CRUD
function register(app) {
  app.get('/api/v1/notes/:id', ...apiAuth, requirePermission('read'), h(async (req, res) => {
    const note = await tokenNote(req, "id, groupId, COALESCE(title,'') as title, COALESCE(content,'') as content, createdAt, updatedAt, isBookmarked");
    res.json({ note: { ...note, isBookmarked: !!note.isBookmarked } });
  }));

  app.post('/api/v1/notes', ...apiAuth, requirePermission('write'), h(async (req, res) => {
    const { title, content, isBookmarked = false } = req.body || {};
    validNoteFields({ title, content }, { requireTitle: true });
    await assertNoteQuota(req.groupId);
    const noteId = uuidv4();
    const now = Date.now();
    await run('INSERT INTO notes (id, groupId, title, content, createdAt, updatedAt, isBookmarked) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      noteId, req.groupId, title.trim(), content || '', now, now, isBookmarked ? 1 : 0
    ]);
    res.status(201).json({ note: { id: noteId, groupId: req.groupId, title: title.trim(), content: content || '', createdAt: now, updatedAt: now, isBookmarked: !!isBookmarked } });
  }));

  app.put('/api/v1/notes/:id', ...apiAuth, requirePermission('write'), h(async (req, res) => {
    const { title, content, isBookmarked } = req.body || {};
    validNoteFields({ title, content });
    const note = await tokenNote(req, 'id, groupId');
    await run(
      'UPDATE notes SET title = COALESCE(?, title), content = COALESCE(?, content), updatedAt = ?, isBookmarked = COALESCE(?, isBookmarked) WHERE id = ?',
      [title ?? null, content ?? null, Date.now(), isBookmarked !== undefined ? (isBookmarked ? 1 : 0) : null, note.id]
    );
    const updated = await get("SELECT id, groupId, COALESCE(title,'') as title, COALESCE(content,'') as content, createdAt, updatedAt, isBookmarked FROM notes WHERE id = ?", [note.id]);
    res.json({ note: { ...updated, isBookmarked: !!updated.isBookmarked } });
  }));

  app.delete('/api/v1/notes/:id', ...apiAuth, requirePermission('delete'), h(async (req, res) => {
    const note = await tokenNote(req, 'id, groupId');
    await run('DELETE FROM notes WHERE id = ?', [note.id]);
    res.json({ success: true, deletedId: note.id });
  }));
}

module.exports = register;
