const config = require('../config');
const { HttpError } = require('../lib/http');

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

const isStr = (v) => typeof v === 'string';

function validUsername(u) {
  return isStr(u) && USERNAME_RE.test(u);
}
function validPassword(p) {
  return isStr(p) && p.length >= 10 && Buffer.byteLength(p, 'utf8') <= 72; // bcrypt ignores bytes past 72
}
const USERNAME_MSG = 'Username must be 3-32 characters: letters, digits, dot, underscore or hyphen';
const PASSWORD_MSG = 'Password must be 10 to 72 characters long';

function normalizeEmail(email) {
  if (!isStr(email) || email.length > 254 || !EMAIL_RE.test(email.trim())) throw new HttpError(400, 'Invalid email address', 'VALIDATION_ERROR');
  return email.trim().toLowerCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function likePattern(s) {
  return `%${String(s).slice(0, 200).replace(/[\\%_]/g, '\\$&')}%`;
}


function validNoteFields({ title, content }, { requireTitle = false } = {}) {
  if (title !== undefined && (!isStr(title) || title.length > 500)) throw new HttpError(400, 'title must be a string of at most 500 characters', 'VALIDATION_ERROR');
  if (content !== undefined && (!isStr(content) || content.length > config.maxNoteChars)) throw new HttpError(400, `content must be a string of at most ${config.maxNoteChars} characters`, 'VALIDATION_ERROR');
  if (requireTitle && (!isStr(title) || title.trim() === '')) throw new HttpError(400, 'title is required', 'VALIDATION_ERROR');
}

module.exports = {
  USERNAME_RE, EMAIL_RE, NOTE_ID_RE, HEX64_RE, isStr, validUsername, validPassword,
  USERNAME_MSG, PASSWORD_MSG, normalizeEmail, escapeHtml, likePattern, validNoteFields
};
