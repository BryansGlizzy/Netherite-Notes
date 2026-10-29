// Append-only record of security-relevant events. Never store passwords, tokens or note content here.
const config = require('../config');
const { run } = require('../db');

// Fire-and-forget: a logging failure must never fail the request.
function audit(req, action, { actor, target, detail } = {}) {
  const actorId = actor !== undefined ? actor : (req && req.jwtUser ? req.jwtUser.userId : null);
  run('INSERT INTO audit_log (ts, actor_id, action, target, ip, detail) VALUES (?, ?, ?, ?, ?, ?)', [
    Date.now(), actorId || null, action, target ? String(target).slice(0, 200) : null, req && req.ip ? req.ip : null,
    detail ? JSON.stringify(detail).slice(0, 500) : null
  ]).catch((err) => console.error('audit log write failed:', err.message));
}

async function pruneAudit() {
  if (!config.auditRetentionDays) return;
  await run('DELETE FROM audit_log WHERE ts < ?', [Date.now() - config.auditRetentionDays * 86400000]);
}

module.exports = { audit, pruneAudit };
