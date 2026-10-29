// Phase 3 hardening: verification, encrypted AI keys, join codes, registration modes, audit log, quotas, upgrade path.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcrypt');
const H = require('./helpers/harness');
const { http, register, startServer, startSmtpSink, openDb, sleep } = H;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mailTo = async (smtp, addr, pattern, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const m of [...smtp.mails].reverse()) {
      if (m.to.includes(addr) && (!pattern || pattern.test(H.decodeQp(m.data)))) return H.decodeQp(m.data);
    }
    await sleep(50);
  }
  return null;
};
const note = (groupId, over = {}) => ({ id: crypto.randomUUID(), groupId, title: 'T', content: 'C', createdAt: 1, updatedAt: 1, isBookmarked: false, ...over });

describe('email verification and hashed reset tokens', () => {
  let smtp; let srv; let base;
  before(async () => {
    smtp = await startSmtpSink();
    srv = await startServer({ smtp, env: { ADMIN_EMAILS: 'admin@example.com,admin2@example.com' } });
    base = srv.base;
  });
  after(async () => { await srv.stop(); await smtp.close(); });

  it('registering with an email sends a verification link (fragment) and the account starts unverified', async () => {
    const u = await register(base, 'verifyme');
    assert.equal(u.emailVerified, false);
    const body = await mailTo(smtp, u.email, /verify=/);
    assert.ok(body, 'verification mail should arrive');
    assert.match(body, /#verify=[0-9a-f]{64}/);
  });

  it('the link verifies once; garbage and reuse are rejected; the token is stored hashed', async () => {
    const u = await register(base, 'verifyme2');
    const body = await mailTo(smtp, u.email, /verify=/);
    const token = body.match(/verify=([0-9a-f]{64})/)[1];
    const db = openDb(srv.dbPath);
    const row = await db.get('SELECT verify_token_hash FROM users WHERE id = ?', [u.id]);
    await db.close();
    assert.equal(row.verify_token_hash, sha256(token));
    assert.equal((await http(base, 'POST', '/api/auth/verify-email', { body: { token: 'z'.repeat(64) } })).status, 400);
    assert.equal((await http(base, 'POST', '/api/auth/verify-email', { body: { token } })).status, 200);
    assert.equal((await http(base, 'POST', '/api/auth/verify-email', { body: { token } })).status, 400);
    const me = await http(base, 'GET', `/api/user/${u.id}`, { token: u.token });
    assert.equal(me.json.emailVerified, true);
  });

  it('resend works for unverified accounts only', async () => {
    const u = await register(base, 'resender');
    const before = smtp.mails.length;
    assert.equal((await http(base, 'POST', '/api/auth/resend-verification', { token: u.token, body: {} })).status, 200);
    await sleep(500);
    assert.ok(smtp.mails.length > before);
    const noEmail = await http(base, 'POST', '/api/register', { body: { username: 'noemail1', password: H.PASSWORD } });
    assert.equal((await http(base, 'POST', '/api/auth/resend-verification', { token: noEmail.json.token, body: {} })).status, 400);
  });

  it('an ADMIN_EMAILS address does not grant admin until it is verified', async () => {
    const db = openDb(srv.dbPath);
    const id = crypto.randomUUID();
    await db.run('INSERT INTO users (id, username, password, email, email_verified) VALUES (?,?,?,?,0)', [id, 'unverifiedadm', await bcrypt.hash(H.PASSWORD, 4), 'admin2@example.com']);
    const l1 = await http(base, 'POST', '/api/login', { body: { username: 'unverifiedadm', password: H.PASSWORD } });
    assert.equal(l1.json.isAdmin, false);
    assert.equal((await http(base, 'GET', '/api/admin/users', { token: l1.json.token })).status, 403);
    await db.run('UPDATE users SET email_verified = 1 WHERE id = ?', [id]);
    await db.close();
    assert.equal((await http(base, 'GET', '/api/admin/users', { token: l1.json.token })).status, 200);
  });

  it('password reset tokens are stored only as hashes', async () => {
    const u = await register(base, 'hashreset');
    await http(base, 'POST', '/api/auth/forgot-password', { body: { email: u.email } });
    const body = await mailTo(smtp, u.email, /reset=/);
    const token = body.match(/reset=([0-9a-f]{64})/)[1];
    const db = openDb(srv.dbPath);
    const row = await db.get('SELECT reset_token, reset_token_hash FROM users WHERE id = ?', [u.id]);
    await db.close();
    assert.equal(row.reset_token, null);
    assert.equal(row.reset_token_hash, sha256(token));
  });
});

describe('AI API keys are encrypted and not shipped with the profile', () => {
  let srv; let base; let u; let other;
  before(async () => { srv = await startServer(); base = srv.base; u = await register(base, 'aiuser'); other = await register(base, 'aiother'); });
  after(async () => srv.stop());

  it('saving a key stores ciphertext, and no response contains it', async () => {
    const secret = 'sk-test-' + 'A1b2C3d4'.repeat(4);
    const r = await http(base, 'PUT', `/api/user/${u.id}/settings`, { token: u.token, body: { aiEndpoint: 'https://llm.example.com', aiApiKey: secret, aiModel: 'm1' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.hasAiApiKey, true);
    assert.equal(JSON.stringify(r.json).includes(secret), false);
    const login = await http(base, 'POST', '/api/login', { body: { username: u.username, password: u.password } });
    assert.equal(JSON.stringify(login.json).includes(secret), false);
    assert.equal(login.json.hasAiApiKey, true);
    const me = await http(base, 'GET', `/api/user/${u.id}`, { token: u.token });
    assert.equal(JSON.stringify(me.json).includes(secret), false);
    const db = openDb(srv.dbPath);
    const row = await db.get('SELECT ai_api_key, ai_api_key_enc FROM users WHERE id = ?', [u.id]);
    await db.close();
    assert.equal(row.ai_api_key, null);
    assert.match(row.ai_api_key_enc, /^v1:/);
    assert.equal(row.ai_api_key_enc.includes(secret), false);
  });

  it('only the owner can read the decrypted key, and it is not cacheable', async () => {
    const mine = await http(base, 'GET', `/api/user/${u.id}/ai-config`, { token: u.token });
    assert.equal(mine.status, 200);
    assert.match(mine.json.aiApiKey, /^sk-test-/);
    assert.equal(mine.json.aiEndpoint, 'https://llm.example.com');
    assert.equal(mine.headers.get('cache-control'), 'no-store');
    assert.equal((await http(base, 'GET', `/api/user/${u.id}/ai-config`, { token: other.token })).status, 403);
    assert.equal((await http(base, 'GET', `/api/user/${u.id}/ai-config`)).status, 401);
  });

  it('an empty string clears the key; invalid endpoints are refused', async () => {
    assert.equal((await http(base, 'PUT', `/api/user/${u.id}/settings`, { token: u.token, body: { aiEndpoint: 'javascript:alert(1)' } })).status, 400);
    const r = await http(base, 'PUT', `/api/user/${u.id}/settings`, { token: u.token, body: { aiApiKey: '' } });
    assert.equal(r.json.hasAiApiKey, false);
    assert.equal((await http(base, 'GET', `/api/user/${u.id}/ai-config`, { token: u.token })).json.aiApiKey, '');
  });

  it('secret-box detects tampering', () => {
    process.env.JWT_SECRET = H.JWT_SECRET; // this test runs in-process, outside any server
    const box = require('../server/lib/secret-box');
    const blob = box.encrypt('hello');
    assert.equal(box.decrypt(blob), 'hello');
    const parts = blob.split(':');
    parts[3] = Buffer.from('tampered!!').toString('base64');
    assert.equal(box.decrypt(parts.join(':')), null);
    assert.equal(box.decrypt('v1:bad'), null);
  });
});

describe('upgrading a database created by v1.0.0', () => {
  let dir; let dbFile; let srv; let legacyToken; const LEGACY_PASS = 'old-legacy-password-1';
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-legacy-'));
    dbFile = path.join(dir, 'legacy.db');
    const db = openDb(dbFile);
    // exact v1.0.0 schema (no schema_migrations, no new columns)
    await db.run('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, email TEXT, reset_token TEXT, reset_expires INTEGER, ai_endpoint TEXT, ai_api_key TEXT, ai_model TEXT, keybind_split_block TEXT DEFAULT \'Enter\', keybind_new_line TEXT DEFAULT \'Shift+Enter\')');
    await db.run('CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT, ownerId TEXT)');
    await db.run('CREATE TABLE user_groups (userId TEXT, groupId TEXT, PRIMARY KEY (userId, groupId))');
    await db.run('CREATE TABLE notes (id TEXT PRIMARY KEY, groupId TEXT, title TEXT, content TEXT, createdAt INTEGER, updatedAt INTEGER, isBookmarked INTEGER)');
    await db.run("CREATE TABLE api_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL, name TEXT, permissions TEXT NOT NULL DEFAULT '[\"read\"]', created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER, is_active INTEGER DEFAULT 1, FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE)");
    await db.run('INSERT INTO users (id, username, password, email, ai_endpoint, ai_api_key, ai_model, reset_token, reset_expires) VALUES (?,?,?,?,?,?,?,?,?)',
      ['u-legacy', 'legacyuser', await bcrypt.hash(LEGACY_PASS, 4), 'legacy@example.com', 'https://llm.example.com', 'sk-legacy-plaintext-key', 'gpt-x', 'a'.repeat(64), Date.now() + 3600000]);
    await db.run('INSERT INTO users (id, username, password) VALUES (?,?,?)', ['u-plain', 'plainuser', 'plaintext-password-123']); // un-hashed legacy password
    await db.run("INSERT INTO groups (id, name, ownerId) VALUES ('oldvlt7','Old Vault','u-legacy')");
    await db.run("INSERT INTO groups (id, name, ownerId) VALUES ('ownerless','No Owner',NULL)");
    await db.run("INSERT INTO user_groups VALUES ('u-legacy','oldvlt7'), ('u-plain','ownerless')");
    await db.run("INSERT INTO notes VALUES ('n-old','oldvlt7','Old note','body [[Other]]',1,2,0)");
    legacyToken = 'nt_' + 'c'.repeat(32);
    const tokenHash = crypto.createHmac('sha256', H.TOKEN_SECRET).update(legacyToken).digest('hex');
    await db.run("INSERT INTO api_tokens (group_id, token_hash, token_prefix, name, permissions, created_at) VALUES ('oldvlt7',?,?,?,?,?)", [tokenHash, legacyToken.slice(0, 11), 'legacy', '["read","write"]', Date.now()]);
    await db.close();
    srv = await startServer({ env: { DB_PATH: dbFile } });
  });
  after(async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('migrations run, a pre-migration backup is written, and data is intact', async () => {
    const db = openDb(dbFile);
    const versions = (await db.all('SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version);
    assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal((await db.get('SELECT COUNT(*) c FROM notes')).c, 1);
    await db.close();
    const backups = fs.readdirSync(path.join(dir, 'backups'));
    assert.ok(backups.some((f) => f.startsWith('pre-migrate-v7-')), `no pre-migration backup in ${backups}`);
  });

  it('existing logins, vault share codes and API tokens keep working', async () => {
    const login = await http(srv.base, 'POST', '/api/login', { body: { username: 'legacyuser', password: LEGACY_PASS } });
    assert.equal(login.status, 200);
    const join = await http(srv.base, 'POST', '/api/groups/join', { token: (await register(srv.base, 'joiner')).token, body: { groupId: 'oldvlt7' } });
    assert.equal(join.status, 200, 'the old vault id must still work as a share code');
    const v1 = await http(srv.base, 'GET', '/api/v1/vaults/oldvlt7/notes', { token: legacyToken });
    assert.equal(v1.status, 200);
    assert.equal(v1.json.notes[0].title, 'Old note');
  });

  it('the plaintext AI key and reset token were converted', async () => {
    const db = openDb(dbFile);
    const u = await db.get("SELECT ai_api_key, ai_api_key_enc, reset_token, reset_token_hash FROM users WHERE id = 'u-legacy'");
    await db.close();
    assert.equal(u.ai_api_key, null);
    assert.match(u.ai_api_key_enc, /^v1:/);
    assert.equal(u.reset_token, null);
    assert.equal(u.reset_token_hash, sha256('a'.repeat(64)));
    const login = await http(srv.base, 'POST', '/api/login', { body: { username: 'legacyuser', password: LEGACY_PASS } });
    const cfg = await http(srv.base, 'GET', '/api/user/u-legacy/ai-config', { token: login.json.token });
    assert.equal(cfg.json.aiApiKey, 'sk-legacy-plaintext-key');
  });

  it('legacy plaintext passwords were hashed and ownerless vaults got an owner', async () => {
    const login = await http(srv.base, 'POST', '/api/login', { body: { username: 'plainuser', password: 'plaintext-password-123' } });
    assert.equal(login.status, 200);
    const db = openDb(dbFile);
    assert.equal((await db.get("SELECT ownerId FROM groups WHERE id = 'ownerless'")).ownerId, 'u-plain');
    assert.equal((await db.get("SELECT join_code FROM groups WHERE id = 'oldvlt7'")).join_code, 'oldvlt7');
    await db.close();
  });
});

describe('vault share codes', () => {
  let srv; let base; let owner; let member; let outsider;
  before(async () => {
    srv = await startServer(); base = srv.base;
    owner = await register(base, 'codeowner'); member = await register(base, 'codemember'); outsider = await register(base, 'codeout');
  });
  after(async () => srv.stop());
  const join = (u, code) => http(base, 'POST', '/api/groups/join', { token: u.token, body: { groupId: code } });

  it('new vault ids are 12 random characters and the share code is a different value', () => {
    assert.match(owner.vaultId, /^[a-z0-9]{12}$/);
    assert.match(owner.joinCode, /^[a-z0-9]{12}$/);
    assert.notEqual(owner.vaultId, owner.joinCode);
  });
  it('the vault id is not a share code; the code is', async () => {
    assert.equal((await join(member, owner.vaultId)).status, 404);
    assert.equal((await join(member, owner.joinCode)).status, 200);
  });
  it('only the owner sees the code', async () => {
    const asMember = await http(base, 'GET', `/api/groups/${owner.vaultId}`, { token: member.token });
    assert.equal(asMember.status, 200);
    assert.equal(asMember.json.joinCode, undefined);
    const asOwner = await http(base, 'GET', `/api/groups/${owner.vaultId}`, { token: owner.token });
    assert.equal(asOwner.json.joinCode, owner.joinCode);
    assert.equal(asOwner.json.memberCount, 2);
  });
  it('rotating replaces the code but keeps members; non-owners cannot manage sharing', async () => {
    assert.equal((await http(base, 'PUT', `/api/groups/${owner.vaultId}/sharing`, { token: member.token, body: { rotate: true } })).status, 403);
    const r = await http(base, 'PUT', `/api/groups/${owner.vaultId}/sharing`, { token: owner.token, body: { rotate: true } });
    assert.equal(r.status, 200);
    assert.notEqual(r.json.joinCode, owner.joinCode);
    assert.equal((await join(outsider, owner.joinCode)).status, 404, 'old code must stop working');
    assert.equal((await http(base, 'GET', `/api/notes?groupId=${owner.vaultId}`, { token: member.token })).status, 200, 'members keep access');
    owner.joinCode = r.json.joinCode;
  });
  it('disabling stops joins without revealing why; re-enabling restores them', async () => {
    assert.equal((await http(base, 'PUT', `/api/groups/${owner.vaultId}/sharing`, { token: owner.token, body: { enabled: false } })).json.joinEnabled, false);
    assert.equal((await join(outsider, owner.joinCode)).status, 404);
    await http(base, 'PUT', `/api/groups/${owner.vaultId}/sharing`, { token: owner.token, body: { enabled: true } });
    assert.equal((await join(outsider, owner.joinCode)).status, 200);
  });
  it('rejects non-boolean sharing input', async () => {
    assert.equal((await http(base, 'PUT', `/api/groups/${owner.vaultId}/sharing`, { token: owner.token, body: { enabled: 'yes' } })).status, 400);
  });
});

describe('registration modes', () => {
  it('closed: sign-up is refused and advertised as closed', async () => {
    const s = await startServer({ env: { REGISTRATION: 'closed' } });
    try {
      assert.equal((await http(s.base, 'GET', '/api/auth/config')).json.registration, 'closed');
      assert.equal((await http(s.base, 'POST', '/api/register', { body: { username: 'someone1', password: H.PASSWORD } })).status, 403);
    } finally { await s.stop(); }
  });
  it('invite: needs a valid single-use code; failures do not burn the code', async () => {
    const s = await startServer({ env: { REGISTRATION: 'invite', ADMIN_EMAILS: 'admin@example.com' } });
    try {
      assert.equal((await http(s.base, 'GET', '/api/auth/config')).json.registration, 'invite');
      execFileSync(process.execPath, ['scripts/admin-create.js', '--email', 'admin@example.com', '--username', 'inviteadmin', '--password', H.PASSWORD], { cwd: H.ROOT, env: s.env });
      const admin = (await http(s.base, 'POST', '/api/login', { body: { username: 'inviteadmin', password: H.PASSWORD } })).json;
      const reg = (code, name) => http(s.base, 'POST', '/api/register', { body: { username: name, password: H.PASSWORD, inviteCode: code } });
      assert.equal((await reg(undefined, 'noinvite')).status, 403);
      assert.equal((await reg('nti_bogus', 'badinvite')).status, 403);
      const inv = await http(s.base, 'POST', '/api/admin/invites', { token: admin.token, body: { expiresInDays: 7 } });
      assert.equal(inv.status, 201);
      assert.match(inv.json.code, /^nti_/);
      assert.equal((await reg(inv.json.code, 'inviteadmin')).status, 400, 'taken username');
      const invited = await reg(inv.json.code, 'inviteduser');
      assert.equal(invited.status, 200, 'code must survive the failed attempt');
      assert.equal((await http(s.base, 'POST', '/api/admin/invites', { token: invited.json.token, body: {} })).status, 403, 'only admins create invites');
      assert.equal((await reg(inv.json.code, 'second-user')).status, 403, 'single use');
      const list = await http(s.base, 'GET', '/api/admin/invites', { token: admin.token });
      assert.equal(list.json.invites[0].usedByName, 'inviteduser');
      assert.equal(JSON.stringify(list.json).includes(inv.json.code), false, 'full code is never listed again');
      const spare = await http(s.base, 'POST', '/api/admin/invites', { token: admin.token, body: {} });
      assert.equal((await http(s.base, 'DELETE', `/api/admin/invites/${spare.json.id}`, { token: admin.token })).status, 200);
      assert.equal((await reg(spare.json.code, 'afterrevoke')).status, 403);
    } finally { await s.stop(); }
  });
});

describe('audit log', () => {
  let srv; let base; let admin;
  before(async () => {
    srv = await startServer({ env: { ADMIN_EMAILS: 'admin@example.com' } }); base = srv.base;
    execFileSync(process.execPath, ['scripts/admin-create.js', '--email', 'admin@example.com', '--username', 'auditadmin', '--password', H.PASSWORD], { cwd: H.ROOT, env: srv.env });
    admin = (await http(base, 'POST', '/api/login', { body: { username: 'auditadmin', password: H.PASSWORD } })).json;
  });
  after(async () => srv.stop());

  it('records failed logins, password changes and token creation — without secrets', async () => {
    const u = await register(base, 'audited1');
    await http(base, 'POST', '/api/login', { body: { username: 'audited1', password: 'definitely-wrong-1' } });
    await http(base, 'PUT', `/api/user/${u.id}/settings`, { token: u.token, body: { currentPassword: H.PASSWORD, newPassword: 'Another-strong-pass-9' } });
    await http(base, 'POST', `/api/v1/vaults/${u.vaultId}/tokens`, { token: (await http(base, 'POST', '/api/login', { body: { username: 'audited1', password: 'Another-strong-pass-9' } })).json.token, body: { permissions: ['read'] } });
    await sleep(300);
    const r = await http(base, 'GET', '/api/admin/audit?limit=200', { token: admin.token });
    assert.equal(r.status, 200);
    const actions = r.json.events.map((e) => e.action);
    for (const a of ['register', 'login_failed', 'password_changed', 'api_token_created', 'login']) assert.ok(actions.includes(a), `missing ${a} in ${actions}`);
    const blob = JSON.stringify(r.json);
    assert.equal(blob.includes('definitely-wrong-1') || blob.includes('Another-strong-pass-9') || blob.includes(H.PASSWORD), false, 'no passwords in the log');
    assert.equal(/nt_[0-9a-f]{32}/.test(blob), false, 'no raw tokens in the log');
  });
  it('is admin-only', async () => {
    const u = await register(base, 'notadmin1');
    assert.equal((await http(base, 'GET', '/api/admin/audit', { token: u.token })).status, 403);
    assert.equal((await http(base, 'GET', '/api/admin/audit')).status, 401);
  });
});

describe('quotas, database settings and transport security', () => {
  it('per-vault note quota applies to every way of creating notes', async () => {
    const s = await startServer({ env: { MAX_NOTES_PER_VAULT: '3' } });
    try {
      const u = await register(s.base); // welcome note = 1
      const tok = (await http(s.base, 'POST', `/api/v1/vaults/${u.vaultId}/tokens`, { token: u.token, body: { permissions: ['read', 'write'] } })).json.token.token;
      assert.equal((await http(s.base, 'POST', '/api/notes', { token: u.token, body: note(u.vaultId) })).status, 200);
      assert.equal((await http(s.base, 'POST', '/api/v1/notes', { token: tok, body: { title: 'two' } })).status, 201);
      assert.equal((await http(s.base, 'POST', '/api/notes', { token: u.token, body: note(u.vaultId) })).status, 413);
      assert.equal((await http(s.base, 'POST', '/api/v1/notes', { token: tok, body: { title: 'x' } })).status, 413);
      assert.equal((await http(s.base, 'POST', `/api/v1/vaults/${u.vaultId}/notes/bulk`, { token: tok, body: { notes: [{ title: 'a' }] } })).status, 413);
      const imp = await http(s.base, 'POST', '/api/groups/import', { token: u.token, body: { __netherite_export_version: 1, vault: { name: 'v' }, notes: [1, 2, 3, 4].map((i) => ({ title: 't' + i })) } });
      assert.equal(imp.status, 413);
    } finally { await s.stop(); }
  });

  it('the database uses WAL and has the query indexes', async () => {
    const s = await startServer();
    try {
      await register(s.base);
      const db = openDb(s.dbPath);
      assert.equal((await db.get('PRAGMA journal_mode')).journal_mode, 'wal');
      const idx = (await db.all("SELECT name FROM sqlite_master WHERE type='index'")).map((i) => i.name);
      for (const n of ['idx_notes_group_updated', 'idx_user_groups_group', 'idx_user_groups_user', 'idx_api_tokens_group', 'idx_groups_join_code', 'idx_users_username_nocase']) assert.ok(idx.includes(n), `missing index ${n}`);
      await db.close();
    } finally { await s.stop(); }
  });

  it('production sends an enforced CSP with script-src limited to self', async () => {
    const s = await startServer();
    try {
      const r = await http(s.base, 'GET', '/api/v1/health');
      const csp = r.headers.get('content-security-policy');
      assert.ok(csp, 'enforced CSP header expected');
      assert.equal(r.headers.get('content-security-policy-report-only'), null);
      const script = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
      assert.equal(script, "script-src 'self'");
      assert.equal(csp.includes('cdn.tailwindcss.com'), false);
      assert.match(csp, /frame-ancestors 'none'/);
    } finally { await s.stop(); }
  });

  it('the built client has no inline scripts or third-party script origins', { skip: !fs.existsSync(path.join(H.ROOT, 'dist/index.html')) }, () => {
    const html = fs.readFileSync(path.join(H.ROOT, 'dist/index.html'), 'utf8');
    for (const m of html.matchAll(/<script\b([^>]*)>/g)) assert.match(m[1], /src="\//, `inline or external script tag: ${m[0]}`);
    assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(html), false, 'no external origins in index.html');
  });
});

describe('backup script', () => {
  it('produces a consistent copy of a live WAL database', async () => {
    const s = await startServer();
    try {
      await register(s.base, 'backupuser');
      const out = path.join(s.dir, 'bk');
      execFileSync(process.execPath, ['scripts/db-backup.js'], { cwd: H.ROOT, env: { ...process.env, ENV_FILE: '/nonexistent', DB_PATH: s.dbPath, BACKUP_DIR: out } });
      const file = fs.readdirSync(out)[0];
      assert.ok(file && file.endsWith('.db'));
      assert.equal(fs.statSync(path.join(out, file)).mode & 0o077, 0, 'backup must be owner-only');
      const db = openDb(path.join(out, file));
      assert.equal((await db.get("SELECT COUNT(*) c FROM users WHERE username = 'backupuser'")).c, 1);
      await db.close();
    } finally { await s.stop(); }
  });
});
