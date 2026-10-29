const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError, h } = require('./http');
const { isStr } = require('./validate');
const { get } = require('../db');

const isAdminEmail = (email) => !!email && config.adminEmails.includes(String(email).toLowerCase());

// Admin = address listed in ADMIN_EMAILS AND proven to belong to the account (verified by email link,
// or granted by an operator with shell access via `npm run admin:create`).
const isAdminUser = (user) => !!user && isAdminEmail(user.email) && !!user.email_verified;

function signJwt(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, email: user.email || null, tv: user.token_version || 0 },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' }
  );
}

// Resolves a verified token payload to a live user, or null if the user is gone or the session was revoked.
// Tokens issued before token versions existed carry no `tv` and count as version 0.
async function sessionUser(decoded) {
  if (!decoded || !isStr(decoded.userId)) return null;
  const user = await get('SELECT id, username, email, email_verified, token_version FROM users WHERE id = ?', [decoded.userId]);
  if (!user || (decoded.tv || 0) !== (user.token_version || 0)) return null;
  return user;
}

function verifyJwt(token) {
  try {
    return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

const authenticateJWT = h(async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) throw new HttpError(401, 'Missing or invalid authorization header', 'UNAUTHORIZED');
  const user = await sessionUser(verifyJwt(auth.slice(7)));
  if (!user) throw new HttpError(401, 'Invalid or expired token', 'UNAUTHORIZED');
  // everything here comes from the database row, never from the token payload
  req.jwtUser = { userId: user.id, username: user.username, email: user.email, emailVerified: !!user.email_verified };
  next();
});

const requireAdmin = h(async (req, res, next) => {
  if (!isAdminUser({ email: req.jwtUser.email, email_verified: req.jwtUser.emailVerified })) throw new HttpError(403, 'Admin access required', 'FORBIDDEN');
  next();
});

// `user` is a full row from the users table. The AI API key is never included, only whether one is stored.
function authResponse(user, groupIds) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    emailVerified: !!user.email_verified,
    groupIds,
    token: signJwt(user),
    isAdmin: isAdminUser(user),
    aiEndpoint: user.ai_endpoint,
    hasAiApiKey: !!user.ai_api_key_enc,
    aiModel: user.ai_model,
    keybindSplitBlock: user.keybind_split_block,
    keybindNewLine: user.keybind_new_line
  };
}

module.exports = { isAdminEmail, isAdminUser, signJwt, sessionUser, verifyJwt, authenticateJWT, requireAdmin, authResponse };
