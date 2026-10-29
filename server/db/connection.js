// SQLite access: a main connection for ordinary queries plus a dedicated, mutex-guarded
// connection for transactions (one sqlite3 connection can't safely interleave BEGIN/COMMIT
// from concurrent requests).
const sqlite3 = require('sqlite3');

function openRaw(file) {
  return new Promise((resolve, reject) => {
    const raw = new sqlite3.Database(file, (err) => (err ? reject(err) : resolve(raw)));
  });
}

// Per-connection settings. WAL lets readers and the single writer proceed concurrently and makes
// online backups cheap; foreign keys make declared ON DELETE CASCADE rules actually apply.
async function tune(conn) {
  await conn.run('PRAGMA busy_timeout = 5000');
  await conn.get('PRAGMA journal_mode = WAL');
  await conn.run('PRAGMA foreign_keys = ON');
}

function wrap(raw) {
  return {
    raw,
    run: (sql, params = []) => new Promise((resolve, reject) => raw.run(sql, params, function onRun(err) { err ? reject(err) : resolve(this); })),
    get: (sql, params = []) => new Promise((resolve, reject) => raw.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))),
    all: (sql, params = []) => new Promise((resolve, reject) => raw.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))),
    close: () => new Promise((resolve) => raw.close(() => resolve()))
  };
}

async function createDb(file) {
  const main = wrap(await openRaw(file));
  await tune(main);

  let txConn = null;
  let chain = Promise.resolve();

  // fn receives {run,get,all} bound to the transaction connection; throw to roll back.
  function transaction(fn) {
    const result = chain.then(async () => {
      if (!txConn) {
        txConn = wrap(await openRaw(file));
        await tune(txConn);
      }
      await txConn.run('BEGIN IMMEDIATE');
      try {
        const out = await fn(txConn);
        await txConn.run('COMMIT');
        return out;
      } catch (err) {
        try { await txConn.run('ROLLBACK'); } catch { /* connection already rolled back */ }
        throw err;
      }
    });
    chain = result.catch(() => {});
    return result;
  }

  return {
    file,
    run: main.run,
    get: main.get,
    all: main.all,
    transaction,
    close: async () => {
      await chain;
      if (txConn) await txConn.close();
      await main.close();
    }
  };
}

module.exports = { createDb };
