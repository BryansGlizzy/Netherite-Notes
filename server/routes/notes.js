const { authenticateJWT } = require('../lib/accounts');
const { HttpError, h } = require('../lib/http');
const { requireMembership, assertNoteQuota } = require('../lib/membership');
const { NOTE_ID_RE, isStr, validNoteFields } = require('../lib/validate');
const { run, get, all } = require('../db');

// Notes used by the web client (membership of the note's vault required)
function register(app) {
  const publicNote = (n) => ({
    id: n.id, groupId: n.groupId, title: n.title || '', content: n.content || '',
    createdAt: n.createdAt, updatedAt: n.updatedAt, isBookmarked: !!n.isBookmarked
  });

  async function noteForMember(req, noteId) {
    const note = await get('SELECT id, groupId FROM notes WHERE id = ?', [noteId]);
    if (!note) throw new HttpError(404, 'Note not found', 'NOT_FOUND');
    await requireMembership(req, note.groupId);
    return note;
  }

  app.get('/api/notes', authenticateJWT, h(async (req, res) => {
    const group = await requireMembership(req, req.query.groupId);
    const notes = await all(
      `SELECT id, groupId, COALESCE(title, '') as title, COALESCE(content, '') as content, createdAt, updatedAt, isBookmarked
       FROM notes WHERE groupId = ? ORDER BY updatedAt DESC`,
      [group.id]
    );
    res.json(notes.map((n) => ({ ...n, isBookmarked: !!n.isBookmarked })));
  }));

  app.post('/api/notes', authenticateJWT, h(async (req, res) => {
    const note = req.body || {};
    await requireMembership(req, note.groupId);
    if (!isStr(note.id) || !NOTE_ID_RE.test(note.id)) throw new HttpError(400, 'Invalid note id', 'VALIDATION_ERROR');
    validNoteFields(note);
    await assertNoteQuota(note.groupId);
    const now = Date.now();
    const createdAt = Number.isFinite(note.createdAt) ? note.createdAt : now;
    const updatedAt = Number.isFinite(note.updatedAt) ? note.updatedAt : now;
    try {
      await run('INSERT INTO notes (id, groupId, title, content, createdAt, updatedAt, isBookmarked) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        note.id, note.groupId, note.title || '', note.content || '', createdAt, updatedAt, note.isBookmarked ? 1 : 0
      ]);
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT') throw new HttpError(409, 'A note with this id already exists', 'CONFLICT');
      throw err;
    }
    res.json(publicNote({ ...note, title: note.title || '', content: note.content || '', createdAt, updatedAt }));
  }));

  app.put('/api/notes/:id', authenticateJWT, h(async (req, res) => {
    const note = await noteForMember(req, req.params.id);
    const { title, content, updatedAt, isBookmarked } = req.body || {};
    validNoteFields({ title, content });
    await run(
      'UPDATE notes SET title = COALESCE(?, title), content = COALESCE(?, content), updatedAt = ?, isBookmarked = COALESCE(?, isBookmarked) WHERE id = ?',
      [title !== undefined ? title : null, content !== undefined ? content : null, Number.isFinite(updatedAt) ? updatedAt : Date.now(), isBookmarked !== undefined ? (isBookmarked ? 1 : 0) : null, note.id]
    );
    res.json({ success: true });
  }));

  app.delete('/api/notes/:id', authenticateJWT, h(async (req, res) => {
    const note = await noteForMember(req, req.params.id);
    await run('DELETE FROM notes WHERE id = ?', [note.id]);
    res.json({ success: true });
  }));
}

module.exports = register;
