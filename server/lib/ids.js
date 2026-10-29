const crypto = require('crypto');

function randomId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

const uuidv4 = () => crypto.randomUUID();

module.exports = { randomId, uuidv4 };
