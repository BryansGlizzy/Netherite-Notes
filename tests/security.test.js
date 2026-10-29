// Regression suite for docs/security audit findings. Each describe maps to a finding ID.
// Boots real server processes (see helpers/harness.js); never touches the project's .env or DB.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const H = require('./helpers/harness');
const { http, register, startServer, startSmtpSink, openDb, legacyJwt, wsClient, sleep } = H;

let smtp;
let srv;
let base;
let alice; let bob; let mallory;

const note = (groupId, over = {}) => ({
  id: crypto.randomUUID(), groupId, title: 'T', content: 'C', createdAt: Date.now(), updatedAt: Date.now(), isBookmarked: false, ...over
});
// sends both the JWT (current design) and x-user-id (v1.0.0 design) so the same helper works before/after the fix
const mint = (user, perms = ['read', 'write', 'delete'], extra = {}) =>
  http(base, 'POST', `/api/v1/vaults/${user.vaultId}/tokens`, { token: user.token, headers: { 'x-user-id': user.id }, body: { name: 'test', permissions: perms, ...extra } });

before(async () => {
  smtp = await startSmtpSink();
  srv = await startServer({ smtp, env: { ADMIN_EMAILS: 'admin@example.com,admin2@example.com', MAX_TOKENS_PER_VAULT: '5', IMPORT_MAX_NOTES: '50' } });
  base = srv.base;
  alice = await register(base, 'alice');
  bob = await register(base, 'bob');
  mallory = await register(base, 'mallory');
});
after(async () => { await srv.stop(); await smtp.close(); });

describe('health (Phase 0)', () => {
  it('GET /api/v1/health is open and minimal', async () => {
    const r = await http(base, 'GET', '/api/v1/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ['db', 'status', 'uptimeSec', 'version']);
    assert.equal(r.json.status, 'ok');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
  it('GET /healthz alias works', async () => assert.equal((await http(base, 'GET', '/healthz')).status, 200));
});

describe('C1 – core vault/note routes require authentication', () => {
  it('anonymous requests are rejected with 401', async () => {
    const n = note(alice.vaultId);
    const calls = [
      ['GET', `/api/notes?groupId=${alice.vaultId}`], ['POST', '/api/notes', n], ['PUT', `/api/notes/${n.id}`, { content: 'x', updatedAt: 1 }],
      ['DELETE', `/api/notes/${n.id}`], ['GET', `/api/groups/${alice.vaultId}`], ['PUT', `/api/groups/${alice.vaultId}`, { name: 'x' }],
      ['POST', '/api/groups/join', { groupId: alice.joinCode, userId: bob.id }], ['POST', '/api/groups/leave', { groupId: alice.vaultId, userId: alice.id }],
      ['DELETE', `/api/groups/${alice.vaultId}`, { userId: alice.id }], ['POST', '/api/groups', { name: 'x', ownerId: alice.id }]
    ];
    for (const [m, p, b] of calls) {
      const r = await http(base, m, p, { body: b });
      assert.equal(r.status, 401, `${m} ${p} should be 401, got ${r.status}`);
    }
  });
  it('a non-member cannot read, create, edit or delete notes in a vault', async () => {
    const n = note(alice.vaultId, { title: 'private' });
    assert.equal((await http(base, 'POST', '/api/notes', { token: alice.token, body: n })).status, 200);
    assert.equal((await http(base, 'GET', `/api/notes?groupId=${alice.vaultId}`, { token: mallory.token })).status, 403);
    assert.equal((await http(base, 'POST', '/api/notes', { token: mallory.token, body: note(alice.vaultId) })).status, 403);
    assert.equal((await http(base, 'PUT', `/api/notes/${n.id}`, { token: mallory.token, body: { content: 'pwned', updatedAt: Date.now() } })).status, 403);
    assert.equal((await http(base, 'DELETE', `/api/notes/${n.id}`, { token: mallory.token })).status, 403);
    const still = await http(base, 'GET', `/api/notes?groupId=${alice.vaultId}`, { token: alice.token });
    assert.equal(still.json.find((x) => x.id === n.id).content, 'C');
  });
  it('members can read and edit; only the owner can rename or delete a vault', async () => {
    const j = await http(base, 'POST', '/api/groups/join', { token: bob.token, body: { groupId: alice.joinCode } });
    assert.equal(j.status, 200);
    const list = await http(base, 'GET', `/api/notes?groupId=${alice.vaultId}`, { token: bob.token });
    assert.equal(list.status, 200);
    const n = list.json[0];
    assert.equal((await http(base, 'PUT', `/api/notes/${n.id}`, { token: bob.token, body: { content: 'edited by bob', updatedAt: Date.now() } })).status, 200);
    assert.equal((await http(base, 'PUT', `/api/groups/${alice.vaultId}`, { token: bob.token, body: { name: 'bob owns' } })).status, 403);
    assert.equal((await http(base, 'DELETE', `/api/groups/${alice.vaultId}`, { token: bob.token, body: { userId: alice.id } })).status, 403);
    assert.equal((await http(base, 'PUT', `/api/groups/${alice.vaultId}`, { token: alice.token, body: { name: 'Alice Vault' } })).status, 200);
    await http(base, 'POST', '/api/groups/leave', { token: bob.token, body: { groupId: alice.vaultId } });
  });
  it('join always adds the caller, never a userId from the body', async () => {
    const victim = await register(base, 'victim1');
    const r = await http(base, 'POST', '/api/groups/join', { token: mallory.token, body: { groupId: alice.joinCode, userId: victim.id } });
    assert.equal(r.status, 200);
    assert.equal((await http(base, 'GET', `/api/notes?groupId=${alice.vaultId}`, { token: victim.token })).status, 403, 'victim must not have been added');
    await http(base, 'POST', '/api/groups/leave', { token: mallory.token, body: { groupId: alice.vaultId } });
  });
  it('vault lookup does not reveal ownerId to non-members', async () => {
    const r = await http(base, 'GET', `/api/groups/${alice.vaultId}`, { token: mallory.token });
    assert.ok([403, 404].includes(r.status), `got ${r.status}`);
    assert.equal(JSON.stringify(r.json || {}).includes(alice.id), false);
  });
  it('the owner id in POST /api/groups comes from the JWT', async () => {
    const r = await http(base, 'POST', '/api/groups', { token: mallory.token, body: { name: 'mine', ownerId: alice.id } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ownerId, mallory.id);
  });
});

describe('C2 – admin rights cannot be claimed or kept via a stale email', () => {
  it('registering with an ADMIN_EMAILS address is refused', async () => {
    const r = await http(base, 'POST', '/api/register', { body: { username: 'evil1', password: H.PASSWORD, email: 'ADMIN2@example.com' } });
    assert.equal(r.status, 403);
  });
  it('a legacy account cannot set an admin address in settings', async () => {
    const db = openDb(srv.dbPath);
    const id = crypto.randomUUID();
    await db.run('INSERT INTO users (id, username, password) VALUES (?,?,?)', [id, 'legacy1', await require('bcrypt').hash(H.PASSWORD, 4)]);
    await db.close();
    const r = await http(base, 'PUT', `/api/user/${id}/settings`, { token: legacyJwt({ id, username: 'legacy1' }), body: { email: 'admin@example.com' } });
    assert.equal(r.status, 403);
  });
  let admin;
  it('admins created with the CLI can use the admin API; normal users cannot', () => {
    const out = execFileSync(process.execPath, ['scripts/admin-create.js', '--email', 'admin@example.com', '--username', 'rootadmin', '--password', H.PASSWORD], { cwd: H.ROOT, env: srv.env }).toString();
    assert.match(out, /admin/i);
  });
  it('admin API works for the admin and 403s for others', async () => {
    const l = await http(base, 'POST', '/api/login', { body: { username: 'rootadmin', password: H.PASSWORD } });
    assert.equal(l.status, 200);
    assert.equal(l.json.isAdmin, true);
    admin = l.json;
    assert.equal((await http(base, 'GET', '/api/admin/users', { token: admin.token })).status, 200);
    assert.equal((await http(base, 'GET', '/api/admin/users', { token: bob.token })).status, 403);
  });
  it('admin status is re-checked against the database on every call', async () => {
    const db = openDb(srv.dbPath);
    await db.run("UPDATE users SET email='someone-else@example.com' WHERE id=?", [admin.id]);
    assert.equal((await http(base, 'GET', '/api/admin/users', { token: admin.token })).status, 403);
    await db.run("UPDATE users SET email='admin@example.com' WHERE id=?", [admin.id]);
    await db.close();
    assert.equal((await http(base, 'GET', '/api/admin/users', { token: admin.token })).status, 200);
  });
  it('deleting a user kills their session; resetting their password kills it too', async () => {
    const doomed = await register(base, 'doomed1');
    const reset = await register(base, 'resetme1');
    assert.equal((await http(base, 'GET', `/api/user/${doomed.id}`, { token: doomed.token })).status, 200);
    assert.equal((await http(base, 'DELETE', `/api/admin/users/${doomed.id}`, { token: admin.token })).status, 200);
    assert.equal((await http(base, 'GET', `/api/user/${doomed.id}`, { token: doomed.token })).status, 401);
    assert.equal((await http(base, 'PUT', `/api/admin/users/${reset.id}`, { token: admin.token, body: { newPassword: 'Brand-new-pass-1' } })).status, 200);
    assert.equal((await http(base, 'GET', `/api/user/${reset.id}`, { token: reset.token })).status, 401);
    assert.equal((await http(base, 'POST', '/api/login', { body: { username: 'resetme1', password: 'Brand-new-pass-1' } })).status, 200);
  });
});

describe('C3 – API token management requires the owner\'s JWT', () => {
  it('x-user-id alone is not enough', async () => {
    const r = await http(base, 'POST', `/api/v1/vaults/${alice.vaultId}/tokens`, { headers: { 'x-user-id': alice.id }, body: { permissions: ['read'] } });
    assert.equal(r.status, 401);
    assert.equal((await http(base, 'GET', `/api/v1/vaults/${alice.vaultId}/tokens`, { headers: { 'x-user-id': alice.id } })).status, 401);
  });
  it('a different user\'s JWT cannot manage the vault, even claiming the owner id', async () => {
    const r = await http(base, 'POST', `/api/v1/vaults/${alice.vaultId}/tokens`, { token: mallory.token, headers: { 'x-user-id': alice.id }, body: { permissions: ['read'] } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'INSUFFICIENT_PERMISSIONS');
  });
  it('the owner can create, list and revoke; the raw token is shown once', async () => {
    const c = await mint(alice, ['read']);
    assert.equal(c.status, 201);
    assert.match(c.json.token.token, /^nt_[0-9a-f]{32}$/);
    const list = await http(base, 'GET', `/api/v1/vaults/${alice.vaultId}/tokens`, { token: alice.token });
    assert.equal(list.status, 200);
    assert.equal(JSON.stringify(list.json).includes(c.json.token.token), false);
    assert.equal((await http(base, 'DELETE', `/api/v1/vaults/${alice.vaultId}/tokens/${c.json.token.id}`, { token: alice.token })).status, 200);
    assert.equal((await http(base, 'GET', `/api/v1/vaults/${alice.vaultId}`, { token: c.json.token.token })).status, 401);
  });
});

describe('C4 – production is the default mode', () => {
  it('without NODE_ENV the server does not serve its own source or package.json', async () => {
    const s = await startServer({ unsetNodeEnv: true });
    try {
      await sleep(3000); // Vite's dev middleware attaches asynchronously after the server starts listening
      assert.match(s.log(), /production mode/, 'server must default to production mode');
      for (const f of ['/server.js', '/package.json', '/obsidian.db']) {
        const r = await http(s.base, 'GET', f, { raw: true });
        assert.equal(r.text.includes('JWT_SECRET'), false, `${f} leaked source`);
        assert.equal(r.text.includes('"netherite-notes"'), false, `${f} leaked package.json`);
        assert.equal(r.text.startsWith('SQLite format 3'), false, `${f} leaked the database`);
      }
    } finally { await s.stop(); }
  });
});

describe('H1 – WebSocket is authenticated and bounded', () => {
  it('JOIN without a valid JWT is rejected and the socket closed', async () => {
    const c = wsClient(base); await c.opened;
    c.send({ type: 'JOIN', groupId: alice.vaultId, userId: alice.id, username: 'alice' });
    const info = await Promise.race([c.closed, sleep(3000).then(() => null)]);
    assert.ok(info && info.code === 4401, `expected close 4401, got ${JSON.stringify(info)}`);
  });
  it('a non-member cannot join a vault room', async () => {
    const c = wsClient(base); await c.opened;
    c.send({ type: 'JOIN', groupId: alice.vaultId, token: mallory.token });
    const info = await Promise.race([c.closed, sleep(3000).then(() => null)]);
    assert.ok(info && info.code === 4401, `expected close 4401, got ${JSON.stringify(info)}`);
  });
  it('members get ROOM_STATE, presence uses token identity, relayed edits reach other members only', async () => {
    const a = wsClient(base); const b = wsClient(base); const evil = wsClient(base);
    await Promise.all([a.opened, b.opened, evil.opened]);
    a.send({ type: 'JOIN', groupId: alice.vaultId, token: alice.token, username: 'spoofed-name' });
    assert.ok(await a.waitFor((m) => m.type === 'ROOM_STATE'), 'alice should get ROOM_STATE');
    await http(base, 'POST', '/api/groups/join', { token: bob.token, body: { groupId: alice.joinCode } });
    b.send({ type: 'JOIN', groupId: alice.vaultId, token: bob.token, userId: 'forged-id', username: 'forged-name' });
    assert.ok(await b.waitFor((m) => m.type === 'ROOM_STATE'));
    const pres = await a.waitFor((m) => m.type === 'PRESENCE_UPDATE' && m.user?.userId === bob.id);
    assert.ok(pres, 'presence must carry the JWT user id');
    assert.equal(pres.user.username, 'bob', 'username must come from the JWT, not the message');
    // unauthenticated attacker tries to inject
    evil.send({ type: 'UPDATE', note: { id: 'x', groupId: alice.vaultId, title: 'injected', content: 'evil' } });
    evil.send({ type: 'JOIN', groupId: alice.vaultId, token: 'garbage' });
    await sleep(400);
    assert.equal(a.messages.some((m) => m.type === 'UPDATE'), false, 'forged UPDATE must not be delivered');
    // legitimate member edit is relayed
    b.send({ type: 'UPDATE', note: { id: 'n1', groupId: alice.vaultId, title: 'real', content: 'hi', createdAt: 1, updatedAt: 2 } });
    assert.ok(await a.waitFor((m) => m.type === 'UPDATE' && m.note?.title === 'real'), 'member UPDATE should be relayed');
    assert.equal(b.messages.some((m) => m.type === 'UPDATE'), false, 'sender must not get its own echo');
    [a, b, evil].forEach((c) => c.close());
    await http(base, 'POST', '/api/groups/leave', { token: bob.token, body: { groupId: alice.vaultId } });
  });
  it('an oversize message closes the socket', async () => {
    const c = wsClient(base); await c.opened;
    c.send({ type: 'JOIN', groupId: alice.vaultId, token: alice.token });
    await c.waitFor((m) => m.type === 'ROOM_STATE');
    c.send(JSON.stringify({ type: 'UPDATE', note: { content: 'x'.repeat(2 * 1024 * 1024) } }));
    const info = await Promise.race([c.closed, sleep(4000).then(() => null)]);
    assert.ok(info && info.code === 1009, `expected close 1009, got ${JSON.stringify(info)}`);
  });
});

describe('H2/H3 – rate limiting', () => {
  let s; let rl; let rlToken;
  before(async () => {
    s = await startServer({ env: {
      RATE_LIMIT_LOGIN_MAX: '5', RATE_LIMIT_REGISTER_MAX: '3', RATE_LIMIT_FORGOT_MAX: '3',
      RATE_LIMIT_V1_FAIL_MAX: '10', RATE_LIMIT_V1_TOKEN_MAX: '15'
    } });
    rl = await register(s.base, 'ratey1');
    const t = await http(s.base, 'POST', `/api/v1/vaults/${rl.vaultId}/tokens`, { token: rl.token, headers: { 'x-user-id': rl.id }, body: { permissions: ['read'] } });
    assert.equal(t.status, 201);
    rlToken = t.json.token.token;
  });
  after(async () => s.stop());
  it('repeated failed logins get 429, even with a spoofed X-Forwarded-For', async () => {
    const codes = [];
    for (let i = 0; i < 9; i++) codes.push((await http(s.base, 'POST', '/api/login', { body: { username: 'ratey1', password: 'wrong-' + i }, headers: { 'x-forwarded-for': `10.0.0.${i}` } })).status);
    assert.ok(codes.includes(429), `no 429 in ${codes}`);
  });
  it('registration is throttled per IP', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await http(s.base, 'POST', '/api/register', { body: { username: 'spam' + i, password: H.PASSWORD } })).status);
    assert.ok(codes.includes(429), `no 429 in ${codes}`);
  });
  it('forgot-password is throttled', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await http(s.base, 'POST', '/api/auth/forgot-password', { body: { email: 'x@example.com' } })).status);
    assert.ok(codes.includes(429), `no 429 in ${codes}`);
  });
  it('a valid v1 token is limited per token', async () => {
    const codes = [];
    for (let i = 0; i < 25; i++) codes.push((await http(s.base, 'GET', `/api/v1/vaults/${rl.vaultId}`, { token: rlToken })).status);
    assert.ok(codes.includes(429) && codes.includes(200), `unexpected ${codes}`);
  });
  it('invalid v1 tokens are throttled even when the token text rotates', async () => {
    const codes = [];
    for (let i = 0; i < 25; i++) codes.push((await http(s.base, 'GET', '/api/v1/vaults/x', { token: 'nt_' + String(i).padStart(10, '0') + 'abcdefghij' })).status);
    assert.ok(codes.includes(429), `no 429 in ${codes}`);
  });
  it('health stays reachable even from a throttled IP', async () => assert.equal((await http(s.base, 'GET', '/api/v1/health')).status, 200));
});

describe('H4/M1 – password and identity rules', () => {
  const reg = (b) => http(base, 'POST', '/api/register', { body: b });
  it('rejects short, empty and >72-byte passwords', async () => {
    assert.equal((await reg({ username: 'pwtest1', password: 'a' })).status, 400);
    assert.equal((await reg({ username: 'pwtest2', password: 'short-9ch' })).status, 400);
    assert.equal((await reg({ username: 'pwtest3', password: 'x'.repeat(73) })).status, 400);
    assert.equal((await reg({ username: 'pwtest4' })).status, 400);
  });
  it('rejects bad usernames', async () => {
    for (const u of ['ab', 'a'.repeat(33), 'has space', '<a href="x">y</a>', 'me@example.com', 'semi;colon']) {
      assert.equal((await reg({ username: u, password: H.PASSWORD })).status, 400, `username ${JSON.stringify(u)}`);
    }
  });
  it('usernames are case-insensitively unique', async () => {
    assert.equal((await reg({ username: 'CaseUser', password: H.PASSWORD })).status, 200);
    assert.equal((await reg({ username: 'caseuser', password: H.PASSWORD })).status, 400);
  });
  it('rejects malformed emails and non-string input', async () => {
    assert.equal((await reg({ username: 'emailbad', password: H.PASSWORD, email: 'not-an-email' })).status, 400);
    assert.equal((await reg({ username: { $ne: 1 }, password: H.PASSWORD })).status, 400);
  });
  it('login works by username (any case) or email', async () => {
    const u = await register(base, 'LoginCase');
    assert.equal((await http(base, 'POST', '/api/login', { body: { username: 'logincase', password: H.PASSWORD } })).status, 200);
    assert.equal((await http(base, 'POST', '/api/login', { body: { username: u.email, password: H.PASSWORD } })).status, 200);
    assert.equal((await http(base, 'POST', '/api/login', { body: { username: 'logincase', password: 'wrong-password-1' } })).status, 401);
  });
});

describe('upgrade safety – databases created before case-insensitive usernames', () => {
  it('exact-case login still reaches the right account when two names differ only by case', async () => {
    const bcrypt = require('bcrypt');
    const db = openDb(srv.dbPath);
    await db.run('DROP INDEX IF EXISTS idx_users_username_nocase'); // simulate a DB where the migration had to skip the index
    const a = crypto.randomUUID(); const b = crypto.randomUUID();
    await db.run('INSERT INTO users (id, username, password) VALUES (?,?,?)', [a, 'Sam.Legacy', await bcrypt.hash('first-password-1', 4)]);
    await db.run('INSERT INTO users (id, username, password) VALUES (?,?,?)', [b, 'sam.legacy', await bcrypt.hash('second-password-2', 4)]);
    await db.close();
    const l1 = await http(base, 'POST', '/api/login', { body: { username: 'Sam.Legacy', password: 'first-password-1' } });
    const l2 = await http(base, 'POST', '/api/login', { body: { username: 'sam.legacy', password: 'second-password-2' } });
    assert.equal(l1.status, 200); assert.equal(l1.json.id, a);
    assert.equal(l2.status, 200); assert.equal(l2.json.id, b);
    const amb = await http(base, 'POST', '/api/login', { body: { username: 'SAM.LEGACY', password: 'first-password-1' } });
    assert.equal(amb.status, 401, 'an ambiguous case-insensitive match must not guess');
    const db2 = openDb(srv.dbPath);
    await db2.run('DELETE FROM users WHERE id IN (?,?)', [a, b]);
    await db2.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_nocase ON users(username COLLATE NOCASE)');
    await db2.close();
  });
});

describe('H7 – sessions are revocable; legacy tokens still work', () => {
  it('a v1.0.0-style JWT (no token version) is accepted', async () => {
    const u = await register(base, 'legacytok');
    const r = await http(base, 'GET', `/api/user/${u.id}`, { token: legacyJwt(u) });
    assert.equal(r.status, 200);
  });
  it('changing the password invalidates old tokens but returns a working new one', async () => {
    const u = await register(base, 'pwchange1');
    const r = await http(base, 'PUT', `/api/user/${u.id}/settings`, { token: u.token, body: { currentPassword: H.PASSWORD, newPassword: 'Another-strong-1' } });
    assert.equal(r.status, 200);
    assert.equal((await http(base, 'GET', `/api/user/${u.id}`, { token: u.token })).status, 401);
    assert.equal((await http(base, 'GET', `/api/user/${u.id}`, { token: r.json.token })).status, 200);
  });
  it('settings reject weak new passwords and bad usernames', async () => {
    const u = await register(base, 'pwchange2');
    assert.equal((await http(base, 'PUT', `/api/user/${u.id}/settings`, { token: u.token, body: { currentPassword: H.PASSWORD, newPassword: 'short' } })).status, 400);
    assert.equal((await http(base, 'PUT', `/api/user/${u.id}/settings`, { token: u.token, body: { username: '<b>x</b>' } })).status, 400);
  });
});

describe('M2/M3 – enumeration, timing and password reset', () => {
  // Newest mail to `addr` whose decoded body matches `pattern`; returns the decoded body.
  const mailTo = async (addr, pattern, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (const m of [...smtp.mails].reverse()) {
        if (!m.to.includes(addr)) continue;
        const body = H.decodeQp(m.data);
        if (!pattern || pattern.test(body)) return body;
      }
      await sleep(50);
    }
    return null;
  };
  it('login does the same bcrypt work for unknown users (no timing oracle)', async () => {
    const t0 = Date.now();
    await http(base, 'POST', '/api/login', { body: { username: 'no-such-user-xyz', password: 'whatever-pass' } });
    assert.ok(Date.now() - t0 > 60, `unknown-user login returned in ${Date.now() - t0}ms; bcrypt was skipped`);
  });
  it('forgot-password answers 200 immediately for known and unknown addresses even if SMTP is down', async () => {
    const down = await startServer({ env: { SMTP_PORT: '1' } });
    try {
      const u = await register(down.base, 'smtpdown');
      const a = await http(down.base, 'POST', '/api/auth/forgot-password', { body: { email: u.email } });
      const b = await http(down.base, 'POST', '/api/auth/forgot-password', { body: { email: 'nobody@example.com' } });
      assert.equal(a.status, 200); assert.equal(b.status, 200);
      assert.deepEqual(a.json, b.json);
    } finally { await down.stop(); }
  });
  it('reset flow: link emailed, weak password refused, token single-use, old sessions revoked', async () => {
    const u = await register(base, 'resetflow');
    assert.equal((await http(base, 'POST', '/api/auth/forgot-password', { body: { email: u.email } })).status, 200);
    const m = await mailTo(u.email, /reset=/);
    assert.ok(m, 'reset email should arrive');
    const token = (m.match(/reset=([0-9a-f]{64})/) || [])[1];
    assert.match(m, /#reset=/, 'token must travel in the URL fragment, not the query string');
    assert.ok(token, 'mail should contain a 64-hex reset token');
    assert.equal((await http(base, 'POST', '/api/auth/reset-password', { body: { token, newPassword: 'short' } })).status, 400);
    assert.equal((await http(base, 'POST', '/api/auth/reset-password', { body: { token, newPassword: 'Fresh-strong-pass-1' } })).status, 200);
    assert.equal((await http(base, 'POST', '/api/auth/reset-password', { body: { token, newPassword: 'Fresh-strong-pass-2' } })).status, 400);
    assert.equal((await http(base, 'GET', `/api/user/${u.id}`, { token: u.token })).status, 401);
    assert.equal((await http(base, 'POST', '/api/login', { body: { username: 'resetflow', password: 'Fresh-strong-pass-1' } })).status, 200);
  });
  it('legacy usernames are HTML-escaped in the reset email', async () => {
    const db = openDb(srv.dbPath);
    const id = crypto.randomUUID();
    await db.run('INSERT INTO users (id, username, password, email) VALUES (?,?,?,?)', [id, '<a href="https://evil.example">click</a>', 'x', 'html@example.com']);
    await db.close();
    await http(base, 'POST', '/api/auth/forgot-password', { body: { email: 'html@example.com' } });
    const body = await mailTo('html@example.com', /Password Reset/);
    assert.ok(body);
    assert.equal(body.includes('<a href="https://evil.example">'), false, 'raw HTML from username must not appear');
    assert.ok(body.includes('&lt;a'));
  });
});

describe('M5 – v1 permission model', () => {
  it('a write-only token cannot read vault details or list notes', async () => {
    const u = await register(base);
    const t = (await mint(u, ['write'])).json.token.token;
    assert.equal((await http(base, 'GET', `/api/v1/vaults/${u.vaultId}`, { token: t })).status, 403);
    assert.equal((await http(base, 'GET', `/api/v1/vaults/${u.vaultId}/notes`, { token: t })).status, 403);
    assert.equal((await http(base, 'POST', '/api/v1/notes', { token: t, body: { title: 'w' } })).status, 201);
  });
  it('expiresAt must be a future integer', async () => {
    const u = await register(base);
    for (const bad of ['soon', Date.now() - 1000, 1.5, {}]) assert.equal((await mint(u, ['read'], { expiresAt: bad })).status, 400, JSON.stringify(bad));
    assert.equal((await mint(u, ['read'], { expiresAt: Date.now() + 60000 })).status, 201);
  });
  it('the number of active tokens per vault is capped', async () => {
    const u = await register(base);
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await mint(u, ['read'])).status);
    assert.deepEqual(codes.slice(0, 5), [201, 201, 201, 201, 201]);
    assert.ok(codes.slice(5).every((c) => c === 400 || c === 409 || c === 429), `cap not enforced: ${codes}`);
  });
});

describe('M8 – errors do not leak internals', () => {
  it('login with an empty body is a 400, not a 500 with an exception message', async () => {
    const r = await http(base, 'POST', '/api/login', { body: {} });
    assert.equal(r.status, 400);
    assert.equal(/toLowerCase|undefined|TypeError/.test(r.text), false);
  });
  it('malformed JSON is a 400 without stack details', async () => {
    const r = await http(base, 'POST', '/api/login', { body: '{"username": ', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400);
    assert.equal(/SyntaxError|at JSON|node_modules/.test(r.text), false);
  });
  it('unknown /api routes are JSON 404s, not the SPA page', async () => {
    const r = await http(base, 'GET', '/api/does-not-exist');
    assert.equal(r.status, 404);
    assert.ok(r.json);
  });
});

describe('M9/L1 – headers and CORS', () => {
  it('sets security headers and hides the framework', async () => {
    const r = await http(base, 'GET', '/api/v1/health');
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(r.headers.get('content-security-policy') || r.headers.get('content-security-policy-report-only'));
  });
  it('does not grant cross-origin access by default', async () => {
    const r = await http(base, 'GET', '/api/v1/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
  it('can allow-list a browser origin', async () => {
    const s = await startServer({ env: { CORS_ORIGINS: 'https://app.example.com' } });
    try {
      const ok = await http(s.base, 'GET', '/api/v1/health', { headers: { Origin: 'https://app.example.com' } });
      const no = await http(s.base, 'GET', '/api/v1/health', { headers: { Origin: 'https://evil.example' } });
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
      assert.equal(no.headers.get('access-control-allow-origin'), null);
    } finally { await s.stop(); }
  });
});

describe('M7/M10 – export/import', () => {
  it('a vault with large notes round-trips (body limit is route-specific)', async () => {
    const u = await register(base);
    for (let i = 0; i < 3; i++) {
      const r = await http(base, 'POST', '/api/notes', { token: u.token, body: note(u.vaultId, { title: 'big' + i, content: 'x'.repeat(800 * 1024) }) });
      assert.equal(r.status, 200);
    }
    const exp = await http(base, 'GET', `/api/groups/${u.vaultId}/export`, { token: u.token });
    assert.equal(exp.status, 200);
    const imp = await http(base, 'POST', '/api/groups/import', { token: u.token, body: exp.json });
    assert.equal(imp.status, 201);
    assert.equal(imp.json.noteCount, 4);
  });
  it('rejects imports over the note-count cap and malformed notes', async () => {
    const u = await register(base);
    const notes = Array.from({ length: 51 }, (_, i) => ({ title: 't' + i, content: '' }));
    assert.ok([400, 413].includes((await http(base, 'POST', '/api/groups/import', { token: u.token, body: { __netherite_export_version: 1, vault: { name: 'v' }, notes } })).status));
    assert.equal((await http(base, 'POST', '/api/groups/import', { token: u.token, body: { __netherite_export_version: 1, vault: { name: 'v' }, notes: [{ title: { evil: true }, content: 5 }] } })).status, 400);
  });
  it('an oversize single note is rejected by the note routes', async () => {
    const u = await register(base);
    const r = await http(base, 'POST', '/api/notes', { token: u.token, body: note(u.vaultId, { content: 'x'.repeat(1.2 * 1024 * 1024) }) });
    assert.ok([400, 413].includes(r.status), `got ${r.status}`);
  });
});

describe('M11/L – misc', () => {
  it('lowercase email login and duplicate email protection', async () => {
    const u = await register(base, 'dupemail');
    const r = await http(base, 'POST', '/api/register', { body: { username: 'dupemail2', password: H.PASSWORD, email: u.email.toUpperCase() } });
    assert.equal(r.status, 400);
  });
});
