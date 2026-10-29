// AES-256-GCM encryption for small secrets stored in the database (e.g. users' AI API keys).
// Key: DATA_ENCRYPTION_KEY (32 bytes, base64 or 64 hex chars) when set; otherwise derived with HKDF from
// JWT_SECRET under a distinct label, so encryption is on by default without extra setup.
// Rotating whichever secret feeds the key makes existing ciphertexts unreadable (users re-enter their AI key).
const crypto = require('crypto');
const config = require('../config');

let keyCache;
function key() {
  if (keyCache) return keyCache;
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (buf.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex characters)');
    keyCache = buf;
  } else {
    if (!config.jwtSecret) throw new Error('No secret available to derive an encryption key');
    keyCache = Buffer.from(crypto.hkdfSync('sha256', config.jwtSecret, 'netherite-notes', 'netherite:data-encryption:v1', 32));
  }
  return keyCache;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

// Returns the plaintext, or null if the value is missing/unreadable (e.g. the key changed).
function decrypt(blob) {
  if (!blob) return null;
  try {
    const [v, iv, tag, data] = String(blob).split(':');
    if (v !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { encrypt, decrypt, sha256 };
