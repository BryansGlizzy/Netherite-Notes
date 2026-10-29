// Test harness: boots a real server process on a random port with a throwaway DB,
// a fake SMTP sink, and small HTTP/WebSocket helpers. Never reads the project's .env.
const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const jwt = require('jsonwebtoken');

const ROOT = path.resolve(__dirname, '..', '..');
const JWT_SECRET = 'test-jwt-secret-' + 'j'.repeat(40);
const TOKEN_SECRET = 'test-token-secret-' + 't'.repeat(40);
const PASSWORD = 'Str0ng-test-pass';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Minimal SMTP server that records messages (plain text, no TLS).
async function startSmtpSink() {
  const mails = [];
  const server = net.createServer((sock) => {
    let buf = '';
    let inData = false;
    let cur = { to: [], data: '' };
    sock.write('220 sink ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          cur.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          mails.push(cur);
          cur = { to: [], data: '' };
          sock.write('250 queued\r\n');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const up = line.toUpperCase();
        if (up.startsWith('EHLO') || up.startsWith('HELO')) sock.write('250 sink\r\n');
        else if (up.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (up.startsWith('RCPT TO')) { cur.to.push(line.slice(8).replace(/[<>\s]/g, '')); sock.write('250 ok\r\n'); }
        else if (up === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return {
    port,
    mails,
    // Decode quoted-printable bodies so tests can inspect links / HTML.
    last: () => decodeQp(mails[mails.length - 1]?.data || ''),
    close: () => new Promise((r) => server.close(r))
  };
}

function decodeQp(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const BIG = '100000';
async function startServer({ env = {}, smtp, unsetNodeEnv = false } = {}) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netherite-test-'));
  const dbPath = path.join(dir, 'test.db');
  const childEnv = {
    ...process.env,
    ENV_FILE: path.join(dir, 'no-such.env'),
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_PATH: dbPath,
    NODE_ENV: 'production',
    JWT_SECRET,
    TOKEN_SECRET,
    ADMIN_EMAILS: 'admin@example.com',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtp ? smtp.port : 1),
    SMTP_REQUIRE_TLS: 'false',
    SMTP_FROM: 'notes@test.local',
    APP_URL: `http://127.0.0.1:${port}`,
    // generous limits by default; rate-limit tests override these
    RATE_LIMIT_LOGIN_MAX: BIG, RATE_LIMIT_REGISTER_MAX: BIG, RATE_LIMIT_FORGOT_MAX: BIG,
    RATE_LIMIT_API_MAX: BIG, RATE_LIMIT_API_FAIL_MAX: BIG, RATE_LIMIT_V1_TOKEN_MAX: BIG, RATE_LIMIT_V1_FAIL_MAX: BIG,
    ...env
  };
  if (unsetNodeEnv) delete childEnv.NODE_ENV;
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40000;
  for (;;) {
    if (exited) throw new Error('server exited early:\n' + log);
    try {
      const r = await fetch(base + '/api/v1/health');
      if (r.status === 200) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error('server did not become healthy:\n' + log); }
    await new Promise((r) => setTimeout(r, 150));
  }
  return {
    base, port, dir, dbPath, env: childEnv,
    log: () => log,
    stop: async () => {
      if (!exited) {
        child.kill('SIGTERM');
        await new Promise((r) => { child.on('exit', r); setTimeout(r, 3000); });
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

async function http(base, method, p, { body, token, headers = {}, raw = false } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers
    },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html/plain */ }
  return raw ? { status: res.status, headers: res.headers, text, json } : { status: res.status, headers: res.headers, json, text };
}

let counter = 0;
async function register(base, name, extra = {}) {
  const username = name || `user${Date.now()}${counter++}`;
  const r = await http(base, 'POST', '/api/register', {
    body: { username, password: PASSWORD, email: `${username.toLowerCase()}@example.com`, ...extra }
  });
  if (r.status !== 200) throw new Error(`register ${username} failed: ${r.status} ${r.text}`);
  const vaultId = r.json.groupIds[0];
  const g = await http(base, 'GET', `/api/groups/${vaultId}`, { token: r.json.token });
  return { ...r.json, username, password: PASSWORD, vaultId, joinCode: g.json && g.json.joinCode };
}

function openDb(file) {
  const db = new sqlite3.Database(file);
  const p = (m) => (sql, params = []) => new Promise((res, rej) => db[m](sql, params, function (e, r) { e ? rej(e) : res(m === 'run' ? this : r); }));
  return { run: p('run'), get: p('get'), all: p('all'), close: () => new Promise((r) => db.close(r)) };
}

function legacyJwt(user) {
  // JWT as issued by v1.0.0: no token-version claim.
  return jwt.sign({ userId: user.id, username: user.username, email: user.email || null }, JWT_SECRET, { expiresIn: '7d' });
}

// WebSocket client that records everything it receives.
function wsClient(base) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const messages = [];
  let closeInfo = null;
  const closed = new Promise((res) => { ws.onclose = (e) => { closeInfo = { code: e.code }; res(closeInfo); }; });
  ws.onmessage = (e) => { try { messages.push(JSON.parse(e.data)); } catch { /* ignore */ } };
  const opened = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = () => res(); });
  const client = {
    ws, messages, closed, opened,
    send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    waitFor: async (pred, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = messages.find(pred);
        if (m) return m;
        if (closeInfo) return null;
        await new Promise((r) => setTimeout(r, 30));
      }
      return null;
    },
    closeInfo: () => closeInfo,
    close: () => { try { ws.close(); } catch { /* ignore */ } }
  };
  return client;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { decodeQp, ROOT, JWT_SECRET, TOKEN_SECRET, PASSWORD, startServer, startSmtpSink, http, register, openDb, legacyJwt, wsClient, sleep, freePort };
