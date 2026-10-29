// Contract tests for REST API v1 (docs: API_REFERENCE.md). These must pass before AND after every refactor.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/harness');
const { http, register, startServer, openDb } = H;

let srv; let base; let u; let T; let other;
const api = (m, p, body, token = T) => http(base, m, p, { body, token });

before(async () => {
  srv = await startServer();
  base = srv.base;
  u = await register(base, 'apiuser');
  other = await register(base, 'apiother');
  const t = await http(base, 'POST', `/api/v1/vaults/${u.vaultId}/tokens`, { token: u.token, headers: { 'x-user-id': u.id }, body: { name: 'contract', permissions: ['read', 'write', 'delete'] } });
  assert.equal(t.status, 201);
  T = t.json.token.token;
});
after(async () => srv.stop());

describe('v1 auth', () => {
  it('missing header -> 401 UNAUTHORIZED', async () => {
    const r = await http(base, 'GET', `/api/v1/vaults/${u.vaultId}`);
    assert.equal(r.status, 401); assert.equal(r.json.error.code, 'UNAUTHORIZED');
  });
  it('non nt_ token -> 401', async () => assert.equal((await api('GET', `/api/v1/vaults/${u.vaultId}`, undefined, 'abc')).status, 401));
  it('unknown token -> 401 TOKEN_REVOKED', async () => {
    const r = await api('GET', `/api/v1/vaults/${u.vaultId}`, undefined, 'nt_' + '1'.repeat(32));
    assert.equal(r.status, 401); assert.equal(r.json.error.code, 'TOKEN_REVOKED');
  });
  it('expired token -> 401 TOKEN_EXPIRED', async () => {
    const db = openDb(srv.dbPath);
    await db.run('UPDATE api_tokens SET expires_at = ? WHERE 1=1 AND name = ?', [Date.now() - 1000, 'contract']);
    const r = await api('GET', `/api/v1/vaults/${u.vaultId}`);
    await db.run('UPDATE api_tokens SET expires_at = NULL WHERE name = ?', ['contract']);
    await db.close();
    assert.equal(r.status, 401); assert.equal(r.json.error.code, 'TOKEN_EXPIRED');
  });
  it('token is scoped to its vault', async () => {
    const r = await api('GET', `/api/v1/vaults/${other.vaultId}/notes`);
    assert.equal(r.status, 403); assert.equal(r.json.error.code, 'INSUFFICIENT_PERMISSIONS');
  });
});

describe('v1 vaults & notes', () => {
  let n1;
  it('GET vault returns vault + stats', async () => {
    const r = await api('GET', `/api/v1/vaults/${u.vaultId}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.vault.id, u.vaultId);
    assert.equal(typeof r.json.stats.noteCount, 'number');
  });
  it('POST note validates title and returns 201 {note}', async () => {
    assert.equal((await api('POST', '/api/v1/notes', { content: 'no title' })).status, 400);
    const r = await api('POST', '/api/v1/notes', { title: '  Alpha  ', content: 'A body' });
    assert.equal(r.status, 201);
    assert.equal(r.json.note.title, 'Alpha');
    assert.equal(r.json.note.groupId, u.vaultId);
    n1 = r.json.note;
  });
  it('GET note, PUT partial update, search and pagination shape', async () => {
    assert.equal((await api('GET', `/api/v1/notes/${n1.id}`)).json.note.content, 'A body');
    const up = await api('PUT', `/api/v1/notes/${n1.id}`, { isBookmarked: true });
    assert.equal(up.status, 200); assert.equal(up.json.note.isBookmarked, true); assert.equal(up.json.note.content, 'A body');
    const list = await api('GET', `/api/v1/vaults/${u.vaultId}/notes?search=Alpha&limit=5&sortBy=title&sortOrder=asc`);
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.json.pagination).sort(), ['hasMore', 'limit', 'offset', 'total']);
    assert.equal(list.json.notes.length, 1);
  });
  it('cross-vault note access is refused', async () => {
    const o = await http(base, 'POST', `/api/v1/vaults/${other.vaultId}/tokens`, { token: other.token, headers: { 'x-user-id': other.id }, body: { permissions: ['read', 'write', 'delete'] } });
    const ot = o.json.token.token;
    const on = await api('POST', '/api/v1/notes', { title: 'theirs' }, ot);
    assert.equal((await api('GET', `/api/v1/notes/${on.json.note.id}`)).status, 403);
    assert.equal((await api('PUT', `/api/v1/notes/${on.json.note.id}`, { title: 'x' })).status, 403);
    assert.equal((await api('DELETE', `/api/v1/notes/${on.json.note.id}`)).status, 403);
  });
  it('permissions are independent: read-only cannot write, write-only cannot delete', async () => {
    const ro = (await http(base, 'POST', `/api/v1/vaults/${u.vaultId}/tokens`, { token: u.token, headers: { 'x-user-id': u.id }, body: { permissions: ['read'] } })).json.token.token;
    const wo = (await http(base, 'POST', `/api/v1/vaults/${u.vaultId}/tokens`, { token: u.token, headers: { 'x-user-id': u.id }, body: { permissions: ['write'] } })).json.token.token;
    assert.equal((await api('POST', '/api/v1/notes', { title: 'x' }, ro)).status, 403);
    assert.equal((await api('GET', `/api/v1/notes/${n1.id}`, undefined, ro)).status, 200);
    assert.equal((await api('DELETE', `/api/v1/notes/${n1.id}`, undefined, wo)).status, 403);
  });
  it('DELETE note', async () => {
    const r = await api('DELETE', `/api/v1/notes/${n1.id}`);
    assert.equal(r.status, 200); assert.equal(r.json.deletedId, n1.id);
    assert.equal((await api('GET', `/api/v1/notes/${n1.id}`)).status, 404);
  });
});

describe('v1 links, graph, bulk', () => {
  let a; let b;
  it('create linked notes; links, graph and connected traversal agree', async () => {
    b = (await api('POST', '/api/v1/notes', { title: 'Beta', content: 'b' })).json.note;
    a = (await api('POST', '/api/v1/notes', { title: 'Gamma', content: 'see [[beta]]' })).json.note;
    const l = await api('GET', `/api/v1/notes/${a.id}/links`);
    assert.equal(l.json.outgoingLinks[0].targetId, b.id);
    const bl = await api('GET', `/api/v1/notes/${b.id}/links`);
    assert.equal(bl.json.incomingLinks[0].sourceId, a.id);
    const g = await api('GET', `/api/v1/vaults/${u.vaultId}/links`);
    assert.ok(g.json.links.some((x) => x.sourceId === a.id && x.targetId === b.id));
    const c = await api('GET', `/api/v1/vaults/${u.vaultId}/notes/${b.id}/connected?direction=incoming&depth=2`);
    assert.ok(c.json.connectedNotes.some((x) => x.id === a.id && x.distance === 1));
  });
  it('POST /links appends and rejects duplicates; DELETE /links removes whole-line links', async () => {
    const c = await api('POST', '/api/v1/links', { sourceNoteId: b.id, targetNoteId: a.id });
    assert.equal(c.status, 201);
    assert.equal((await api('POST', '/api/v1/links', { sourceNoteId: b.id, targetNoteId: a.id })).status, 409);
    const d = await api('DELETE', '/api/v1/links', { sourceNoteId: b.id, targetNoteId: a.id });
    assert.equal(d.status, 200);
    assert.equal(d.json.updatedNote.content.includes('[[Gamma]]'), false);
  });
  it('bulk create reports per-item errors; bulk delete is vault-scoped', async () => {
    const r = await api('POST', `/api/v1/vaults/${u.vaultId}/notes/bulk`, { notes: [{ title: 'B1' }, { content: 'bad' }, { title: 'B2' }] });
    assert.equal(r.status, 201); assert.equal(r.json.created.length, 2); assert.equal(r.json.errors[0].index, 1);
    const ids = r.json.created.map((x) => x.id).concat(['not-in-vault']);
    const d = await api('DELETE', `/api/v1/vaults/${u.vaultId}/notes/bulk`, { noteIds: ids });
    assert.equal(d.status, 200); assert.equal(d.json.deleted.length, 2); assert.equal(d.json.errors.length, 1);
    assert.equal((await api('POST', `/api/v1/vaults/${u.vaultId}/notes/bulk`, { notes: [] })).status, 400);
  });
});

describe('web client contract (core routes with a JWT)', () => {
  it('register -> login -> user -> create/update/delete note keeps working', async () => {
    const w = await register(base);
    const login = await http(base, 'POST', '/api/login', { body: { username: w.username, password: w.password } });
    assert.equal(login.status, 200);
    assert.ok(login.json.token && Array.isArray(login.json.groupIds));
    const me = await http(base, 'GET', `/api/user/${w.id}`, { token: login.json.token });
    assert.equal(me.json.username, w.username);
    const id = require('crypto').randomUUID();
    const mk = await http(base, 'POST', '/api/notes', { token: w.token, body: { id, groupId: w.vaultId, title: 'N', content: 'c', createdAt: 1, updatedAt: 1, isBookmarked: false } });
    assert.equal(mk.status, 200);
    assert.equal((await http(base, 'PUT', `/api/notes/${id}`, { token: w.token, body: { title: 'N2', updatedAt: 5, isBookmarked: true } })).status, 200);
    const list = await http(base, 'GET', `/api/notes?groupId=${w.vaultId}`, { token: w.token });
    const mine = list.json.find((n) => n.id === id);
    assert.equal(mine.title, 'N2'); assert.equal(mine.isBookmarked, true); assert.equal(mine.content, 'c');
    assert.equal((await http(base, 'DELETE', `/api/notes/${id}`, { token: w.token })).status, 200);
  });
  it('vault create / rename / delete by the owner; export has the documented shape', async () => {
    const w = await register(base);
    const g = await http(base, 'POST', '/api/groups', { token: w.token, body: { name: 'Second', ownerId: w.id } });
    assert.equal(g.status, 200);
    assert.equal((await http(base, 'PUT', `/api/groups/${g.json.id}`, { token: w.token, body: { name: 'Renamed' } })).status, 200);
    const ex = await http(base, 'GET', `/api/groups/${g.json.id}/export`, { token: w.token });
    assert.equal(ex.json.__netherite_export_version, 1); assert.equal(ex.json.vault.name, 'Renamed'); assert.equal(ex.json.notes.length, 1);
    assert.equal((await http(base, 'DELETE', `/api/groups/${g.json.id}`, { token: w.token, body: { userId: w.id } })).status, 200);
  });
});
