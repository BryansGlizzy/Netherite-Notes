const { WebSocketServer } = require('ws');
const config = require('../config');
const { get } = require('../db');
const { isStr } = require('../lib/validate');
const { sessionUser, verifyJwt } = require('../lib/accounts');

// WebSocket: presence + change relay, members only.
// Every socket must JOIN with a valid JWT for a vault it belongs to; identity always comes from the token.
let wss;

function attachWebSocket(httpServer) {
  wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    } else if (config.isProd) {
      socket.destroy(); // dev mode leaves other upgrades to Vite's HMR socket
    }
  });

  const rooms = () => Array.from(wss.clients).filter((c) => c.readyState === 1 && c.groupId);
  const sendTo = (clients, payload) => clients.forEach((c) => c.send(JSON.stringify(payload)));
  const others = (ws) => rooms().filter((c) => c !== ws && c.groupId === ws.groupId);
  const presence = (ws) => ({ type: 'PRESENCE_UPDATE', user: { userId: ws.userId, username: ws.username, noteId: ws.noteId } });

  function leaveRoom(ws) {
    if (ws.groupId && ws.userId) sendTo(others(ws), { type: 'PRESENCE_UPDATE', user: { userId: ws.userId, offline: true } });
    ws.groupId = null;
  }

  const pickNote = (n) => ({
    id: String(n.id), groupId: n.groupId, title: isStr(n.title) ? n.title : '', content: isStr(n.content) ? n.content : '',
    createdAt: n.createdAt, updatedAt: n.updatedAt, isBookmarked: !!n.isBookmarked
  });

  async function handle(ws, data) {
    if (data.type === 'JOIN') {
      const user = await sessionUser(isStr(data.token) ? verifyJwt(data.token) : null);
      const member = user && isStr(data.groupId) && (await get('SELECT 1 AS x FROM user_groups WHERE userId = ? AND groupId = ?', [user.id, data.groupId]));
      if (!member) return ws.close(4401, 'unauthorized');
      if (ws.groupId) leaveRoom(ws);
      ws.groupId = data.groupId;
      ws.userId = user.id; // identity comes from the token, never from the message
      ws.username = user.username;
      ws.noteId = null;
      clearTimeout(ws.joinTimer);
      sendTo([ws], {
        type: 'ROOM_STATE',
        users: others(ws).filter((c) => c.userId).map((c) => ({ userId: c.userId, username: c.username, noteId: c.noteId }))
      });
      return sendTo(others(ws), presence(ws));
    }

    if (!ws.groupId) return; // everything else requires a successful JOIN

    if (data.type === 'VIEWING') {
      ws.noteId = isStr(data.noteId) ? data.noteId : null;
      return sendTo(others(ws), presence(ws));
    }
    if ((data.type === 'UPDATE' || data.type === 'CREATE') && data.note && typeof data.note === 'object' && data.note.groupId === ws.groupId) {
      return sendTo(others(ws), { type: data.type, note: pickNote(data.note) });
    }
    if (data.type === 'DELETE' && isStr(data.id)) {
      return sendTo(others(ws), { type: 'DELETE', id: data.id });
    }
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.msgTimes = [];
    ws.queue = Promise.resolve();
    ws.joinTimer = setTimeout(() => { if (!ws.groupId) ws.close(4401, 'unauthorized'); }, 10000);
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});

    ws.on('message', (message) => {
      const now = Date.now();
      ws.msgTimes = ws.msgTimes.filter((t) => now - t < 1000);
      ws.msgTimes.push(now);
      if (ws.msgTimes.length > 40) return ws.close(4429, 'rate limited');
      ws.queue = ws.queue.then(async () => {
        let data;
        try { data = JSON.parse(message); } catch { return; }
        if (data && typeof data === 'object') await handle(ws, data);
      }).catch((err) => console.error('WS message error:', err.message));
    });

    ws.on('close', () => {
      clearTimeout(ws.joinTimer);
      leaveRoom(ws);
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));
}

function closeWebSocket() {
  if (wss) wss.clients.forEach((c) => c.terminate());
}

module.exports = { attachWebSocket, closeWebSocket };
