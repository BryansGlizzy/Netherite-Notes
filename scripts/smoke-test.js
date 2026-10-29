#!/usr/bin/env node
// Smoke test for a running Netherite Notes server.
//
//   npm run health                      health check only (safe against production)
//   NT_TOKEN=nt_... NT_VAULT_ID=abc npm run smoke
//                                       health + REST API v1 checks using YOUR token
//
// Options / env:  --url=<base> | BASE_URL   (default http://localhost:20100)
//                 --full                    run the token-based checks (needs NT_TOKEN, NT_VAULT_ID)
// The token needs read, write and delete permissions. Only notes whose title starts
// with "smoke-test-" are created, and they are deleted at the end.

const args = process.argv.slice(2);
const argVal = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const BASE = (argVal('url') || process.env.BASE_URL || 'http://localhost:20100').replace(/\/$/, '');
const FULL = args.includes('--full');
const TOKEN = process.env.NT_TOKEN;
const VAULT = process.env.NT_VAULT_ID;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${!ok && detail ? `  -> ${detail}` : ''}`);
}

async function call(method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`Netherite Notes smoke test -> ${BASE}\n`);

  console.log('Health');
  let health;
  try {
    health = await call('GET', '/api/v1/health');
  } catch (err) {
    console.error(`  ❌ Cannot reach ${BASE} (${err.cause?.code || err.message}). Is the server running?`);
    process.exit(1);
  }
  check('GET /api/v1/health responds 200', health.status === 200, `status ${health.status}`);
  check('status is "ok"', health.json?.status === 'ok', JSON.stringify(health.json));
  check('database is "ok"', health.json?.db === 'ok');
  check('reports a version', typeof health.json?.version === 'string');
  check('no auth header needed (open endpoint)', true);
  const alias = await call('GET', '/healthz');
  check('GET /healthz alias responds 200', alias.status === 200);
  if (health.json?.version) console.log(`  server version ${health.json.version}, up ${health.json.uptimeSec}s`);

  if (!FULL) {
    console.log('\n(health only — pass --full with NT_TOKEN and NT_VAULT_ID for API v1 checks)');
    return summary();
  }
  if (!TOKEN || !VAULT) {
    console.error('\n--full needs NT_TOKEN (a read+write+delete API token) and NT_VAULT_ID in the environment.');
    process.exit(2);
  }

  console.log('\nAuth boundaries');
  const noAuth = await call('GET', `/api/v1/vaults/${VAULT}`);
  check('no Authorization header -> 401 UNAUTHORIZED', noAuth.status === 401 && noAuth.json?.error?.code === 'UNAUTHORIZED');
  const bad = await call('GET', `/api/v1/vaults/${VAULT}`, { token: 'nt_' + '0'.repeat(32) });
  check('unknown token -> 401 TOKEN_REVOKED', bad.status === 401 && bad.json?.error?.code === 'TOKEN_REVOKED');
  const other = await call('GET', '/api/v1/vaults/zzzzzzzzzzzz/notes', { token: TOKEN });
  check('token for another vault -> 403', other.status === 403 && other.json?.error?.code === 'INSUFFICIENT_PERMISSIONS');

  console.log('\nVault & notes');
  const created = [];
  const tag = `smoke-test-${Date.now()}`;
  try {
    const vault = await call('GET', `/api/v1/vaults/${VAULT}`, { token: TOKEN });
    check('GET vault', vault.status === 200 && vault.json?.vault?.id === VAULT, `status ${vault.status}`);
    const list = await call('GET', `/api/v1/vaults/${VAULT}/notes?limit=5`, { token: TOKEN });
    check('list notes (paginated)', list.status === 200 && Array.isArray(list.json?.notes) && !!list.json?.pagination);

    const a = await call('POST', '/api/v1/notes', { token: TOKEN, body: { title: `${tag}-a`, content: `# A\nlinks to [[${tag}-b]]` } });
    check('create note A', a.status === 201 && a.json?.note?.id, `status ${a.status}`);
    const b = await call('POST', '/api/v1/notes', { token: TOKEN, body: { title: `${tag}-b`, content: 'B' } });
    check('create note B', b.status === 201 && b.json?.note?.id);
    const aId = a.json?.note?.id;
    const bId = b.json?.note?.id;
    if (aId) created.push(aId);
    if (bId) created.push(bId);

    if (aId && bId) {
      const get = await call('GET', `/api/v1/notes/${aId}`, { token: TOKEN });
      check('get note', get.status === 200 && get.json?.note?.title === `${tag}-a`);
      const upd = await call('PUT', `/api/v1/notes/${aId}`, { token: TOKEN, body: { content: `# A updated\nlinks to [[${tag}-b]]` } });
      check('update note', upd.status === 200 && upd.json?.note?.content.includes('updated'));
      const search = await call('GET', `/api/v1/vaults/${VAULT}/notes?search=${encodeURIComponent(tag)}`, { token: TOKEN });
      check('search finds both notes', search.json?.notes?.length === 2, JSON.stringify(search.json?.pagination));

      const links = await call('GET', `/api/v1/notes/${aId}/links`, { token: TOKEN });
      check('outgoing link A -> B detected', links.status === 200 && links.json?.outgoingLinks?.some((l) => l.targetId === bId));
      const graph = await call('GET', `/api/v1/vaults/${VAULT}/links`, { token: TOKEN });
      check('vault graph returns nodes and links', graph.status === 200 && Array.isArray(graph.json?.nodes) && Array.isArray(graph.json?.links));
      const conn = await call('GET', `/api/v1/vaults/${VAULT}/notes/${bId}/connected?direction=incoming&depth=1`, { token: TOKEN });
      check('connected notes (incoming to B includes A)', conn.status === 200 && conn.json?.connectedNotes?.some((n) => n.id === aId));
      const dup = await call('POST', '/api/v1/links', { token: TOKEN, body: { sourceNoteId: aId, targetNoteId: bId, linkText: `${tag}-b` } });
      check('duplicate link -> 409', dup.status === 409 && dup.json?.error?.code === 'DUPLICATE_LINK');
    }

    const bulk = await call('POST', `/api/v1/vaults/${VAULT}/notes/bulk`, { token: TOKEN, body: { notes: [{ title: `${tag}-c`, content: 'c' }, { title: `${tag}-d` }, { content: 'no title' }] } });
    check('bulk create (2 ok, 1 rejected)', bulk.status === 201 && bulk.json?.created?.length === 2 && bulk.json?.errors?.length === 1);
    (bulk.json?.created || []).forEach((n) => created.push(n.id));
  } finally {
    console.log('\nCleanup');
    if (created.length) {
      const del = await call('DELETE', `/api/v1/vaults/${VAULT}/notes/bulk`, { token: TOKEN, body: { noteIds: created } });
      check(`bulk delete ${created.length} smoke-test notes`, del.status === 200 && del.json?.deleted?.length === created.length, JSON.stringify(del.json));
    }
  }
  return summary();
}

function summary() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
