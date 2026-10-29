const config = require('../../config');
const { HttpError, h } = require('../../lib/http');
const { isStr } = require('../../lib/validate');
const { apiAuth, requirePermission, requireVaultScope, tokenNote } = require('../../middleware/api-token');
const { run, get, all } = require('../../db');

// API v1: wiki-links, graph and connected notes
function register(app) {
  const WIKILINK = /\[\[(.*?)\]\]/g;

  app.get('/api/v1/notes/:id/links', ...apiAuth, requirePermission('read'), h(async (req, res) => {
    const note = await tokenNote(req, 'id, groupId, content');
    const allNotes = await all("SELECT id, COALESCE(title,'') as title, COALESCE(content,'') as content FROM notes WHERE groupId = ?", [req.groupId]);
    const titleToId = new Map(allNotes.map((n) => [n.title.toLowerCase(), n.id]));
    const idToTitle = new Map(allNotes.map((n) => [n.id, n.title]));

    const outgoingLinks = [];
    for (const match of (note.content || '').matchAll(WIKILINK)) {
      const linkedTitle = match[1].trim();
      const targetId = titleToId.get(linkedTitle.toLowerCase());
      if (targetId && targetId !== note.id) outgoingLinks.push({ targetId, targetTitle: idToTitle.get(targetId), linkText: linkedTitle });
    }

    const incomingLinks = [];
    const ownTitle = idToTitle.get(note.id);
    if (ownTitle) {
      const needle = `[[${ownTitle.toLowerCase()}]]`;
      for (const n of allNotes) {
        if (n.id !== note.id && n.content.toLowerCase().includes(needle)) incomingLinks.push({ sourceId: n.id, sourceTitle: n.title });
      }
    }
    res.json({ noteId: note.id, outgoingLinks, incomingLinks });
  }));

  app.get('/api/v1/vaults/:id/links', ...apiAuth, requireVaultScope, requirePermission('read'), h(async (req, res) => {
    const notes = await all("SELECT id, COALESCE(title,'') as title, COALESCE(content,'') as content FROM notes WHERE groupId = ?", [req.params.id]);
    const titleToId = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
    const idToTitle = new Map(notes.map((n) => [n.id, n.title]));
    const seen = new Set();
    const links = [];
    for (const note of notes) {
      for (const match of note.content.matchAll(WIKILINK)) {
        const targetId = titleToId.get(match[1].trim().toLowerCase());
        const key = `${note.id}:${targetId}`;
        if (targetId && targetId !== note.id && !seen.has(key)) {
          seen.add(key);
          links.push({ sourceId: note.id, sourceTitle: note.title, targetId, targetTitle: idToTitle.get(targetId) });
        }
      }
    }
    const linkCount = new Map();
    links.forEach((l) => {
      linkCount.set(l.sourceId, (linkCount.get(l.sourceId) || 0) + 1);
      linkCount.set(l.targetId, (linkCount.get(l.targetId) || 0) + 1);
    });
    res.json({ links, nodes: notes.map((n) => ({ id: n.id, title: n.title, linkCount: linkCount.get(n.id) || 0 })) });
  }));

  app.get('/api/v1/vaults/:id/notes/:noteId/connected', ...apiAuth, requireVaultScope, requirePermission('read'), h(async (req, res) => {
    const { direction = 'both', depth = 1 } = req.query;
    const maxDepth = Math.min(parseInt(depth) || 1, 3);
    const centerNote = await get('SELECT id, title FROM notes WHERE id = ? AND groupId = ?', [req.params.noteId, req.params.id]);
    if (!centerNote) throw new HttpError(404, 'Note not found in this vault', 'NOT_FOUND');

    const notes = await all("SELECT id, COALESCE(title,'') as title, COALESCE(content,'') as content FROM notes WHERE groupId = ?", [req.params.id]);
    const titleToId = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]));
    const outEdges = new Map();
    const inEdges = new Map();
    for (const note of notes) {
      for (const match of note.content.matchAll(WIKILINK)) {
        const targetId = titleToId.get(match[1].trim().toLowerCase());
        if (targetId && targetId !== note.id) {
          if (!outEdges.has(note.id)) outEdges.set(note.id, new Set());
          if (!inEdges.has(targetId)) inEdges.set(targetId, new Set());
          outEdges.get(note.id).add(targetId);
          inEdges.get(targetId).add(note.id);
        }
      }
    }

    const idToTitle = new Map(notes.map((n) => [n.id, n.title]));
    const visited = new Set([centerNote.id]);
    const connectedNotes = [];
    let frontier = [centerNote.id];
    for (let d = 1; d <= maxDepth; d++) {
      const next = [];
      for (const nodeId of frontier) {
        const neighbors = [];
        if (direction !== 'incoming') for (const id of outEdges.get(nodeId) || []) neighbors.push({ id, type: 'outgoing' });
        if (direction !== 'outgoing') for (const id of inEdges.get(nodeId) || []) neighbors.push({ id, type: 'incoming' });
        for (const { id, type } of neighbors) {
          if (!visited.has(id)) {
            visited.add(id);
            next.push(id);
            connectedNotes.push({ id, title: idToTitle.get(id), connectionType: type, distance: d });
          }
        }
      }
      frontier = next;
    }
    res.json({ centerNote: { id: centerNote.id, title: centerNote.title }, connectedNotes });
  }));

  app.post('/api/v1/links', ...apiAuth, requirePermission('write'), h(async (req, res) => {
    const { sourceNoteId, targetNoteId, linkText } = req.body || {};
    if (!isStr(sourceNoteId) || !isStr(targetNoteId)) throw new HttpError(400, 'sourceNoteId and targetNoteId are required', 'VALIDATION_ERROR');
    if (linkText !== undefined && (!isStr(linkText) || linkText.length > 500)) throw new HttpError(400, 'linkText must be a string of at most 500 characters', 'VALIDATION_ERROR');

    const source = await get('SELECT id, groupId, title, content FROM notes WHERE id = ?', [sourceNoteId]);
    const target = await get('SELECT id, groupId, title FROM notes WHERE id = ?', [targetNoteId]);
    if (!source || !target) throw new HttpError(404, 'One or both notes not found', 'NOT_FOUND');
    if (source.groupId !== req.groupId || target.groupId !== req.groupId) throw new HttpError(403, "Both notes must be in your token's vault", 'INSUFFICIENT_PERMISSIONS');

    const text = linkText || target.title;
    const wikiLink = `[[${text}]]`;
    if ((source.content || '').includes(wikiLink)) throw new HttpError(409, 'Link already exists in source note', 'DUPLICATE_LINK');
    const updatedContent = (source.content || '') + '\n' + wikiLink;
    if (updatedContent.length > config.maxNoteChars) throw new HttpError(400, 'Resulting note would be too large', 'VALIDATION_ERROR');

    const now = Date.now();
    await run('UPDATE notes SET content = ?, updatedAt = ? WHERE id = ?', [updatedContent, now, sourceNoteId]);
    res.status(201).json({
      link: { sourceId: sourceNoteId, targetId: targetNoteId, linkText: text, createdAt: now },
      updatedNote: { id: sourceNoteId, title: source.title, content: updatedContent }
    });
  }));

  app.delete('/api/v1/links', ...apiAuth, requirePermission('write'), h(async (req, res) => {
    const { sourceNoteId, targetNoteId } = req.body || {};
    if (!isStr(sourceNoteId) || !isStr(targetNoteId)) throw new HttpError(400, 'sourceNoteId and targetNoteId are required', 'VALIDATION_ERROR');
    const source = await get('SELECT id, groupId, content FROM notes WHERE id = ?', [sourceNoteId]);
    const target = await get('SELECT id, title FROM notes WHERE id = ?', [targetNoteId]);
    if (!source || !target) throw new HttpError(404, 'One or both notes not found', 'NOT_FOUND');
    if (source.groupId !== req.groupId) throw new HttpError(403, 'Token not scoped to this vault', 'INSUFFICIENT_PERMISSIONS');

    const wikiLink = `[[${target.title}]]`;
    const updatedContent = (source.content || '').split('\n').filter((line) => line.trim() !== wikiLink).join('\n');
    await run('UPDATE notes SET content = ?, updatedAt = ? WHERE id = ?', [updatedContent, Date.now(), sourceNoteId]);
    res.json({ success: true, updatedNote: { id: sourceNoteId, content: updatedContent } });
  }));
}

module.exports = register;
