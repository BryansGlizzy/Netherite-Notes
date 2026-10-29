// Central, validated configuration. Loaded before anything that reads NODE_ENV.
const path = require('path');

// Secure default: anything that is not explicitly "development" runs as production.
// (Previously an unset NODE_ENV silently started the Vite dev server, which serves project files.)
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const env = process.env;
const isProd = env.NODE_ENV !== 'development';

const int = (name, def) => {
  const v = parseInt(env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
};
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const bool = (name, def) => {
  const v = (env[name] || '').toLowerCase();
  if (['1', 'true', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  return def;
};

function parseTrustProxy(v) {
  if (!v || v === 'false' || v === '0') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (v === 'true') return false; // "trust everything" would let anyone spoof their IP; refuse
  return v; // e.g. "loopback" or a CIDR list, passed through to Express
}

const dbPath = env.DB_PATH || './obsidian.db';
const appUrl = env.APP_URL || 'http://localhost:20100';

const config = {
  nodeEnv: env.NODE_ENV,
  isProd,
  port: int('PORT', 20100),
  host: env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
  dbPath,
  backupDir: env.BACKUP_DIR || path.join(path.dirname(path.resolve(dbPath)), 'backups'),

  jwtSecret: env.JWT_SECRET || env.TOKEN_SECRET,
  tokenSecret: env.TOKEN_SECRET || env.JWT_SECRET,
  jwtExpiresIn: '7d',

  appUrl,
  appUrlIsHttps: appUrl.startsWith('https://'),
  adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
  corsOrigins: list(env.CORS_ORIGINS),
  trustProxy: parseTrustProxy(env.TRUST_PROXY),

  smtp: {
    host: env.SMTP_HOST || 'mail.smtp2go.com',
    port: int('SMTP_PORT', 2525),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    // sender address: SMTP_FROM, else the SMTP login when it is an address, else a harmless placeholder
    from: env.SMTP_FROM || (env.SMTP_USER && env.SMTP_USER.includes('@') ? env.SMTP_USER : 'noreply@localhost'),
    requireTls: bool('SMTP_REQUIRE_TLS', true)
  },

  limits: {
    loginMax: int('RATE_LIMIT_LOGIN_MAX', 10), // failed attempts / 15 min / IP and / username
    registerMax: int('RATE_LIMIT_REGISTER_MAX', 10), // / hour / IP
    forgotMax: int('RATE_LIMIT_FORGOT_MAX', 3), // / hour / IP and / address
    apiMax: int('RATE_LIMIT_API_MAX', 3000), // all /api requests / minute / IP
    apiFailMax: int('RATE_LIMIT_API_FAIL_MAX', 120), // failed (>=400) /api requests / minute / IP
    v1TokenMax: int('RATE_LIMIT_V1_TOKEN_MAX', 120), // / minute / API token
    v1FailMax: int('RATE_LIMIT_V1_FAIL_MAX', 60) // failed v1 requests / minute / IP
  },

  registration: ['open', 'invite', 'closed'].includes((env.REGISTRATION || '').toLowerCase()) ? env.REGISTRATION.toLowerCase() : 'open',
  auditRetentionDays: int('AUDIT_RETENTION_DAYS', 180),
  maxNotesPerVault: int('MAX_NOTES_PER_VAULT', 50000),
  maxTokensPerVault: int('MAX_TOKENS_PER_VAULT', 50),
  importMaxNotes: int('IMPORT_MAX_NOTES', 10000),
  maxNoteChars: 1000000,
  bulkMax: 500
};

// Fails fast on a missing secret; returns advisory warnings for weak/reused ones.
config.checkSecrets = function checkSecrets() {
  if (!config.jwtSecret) {
    console.error('FATAL: JWT_SECRET or TOKEN_SECRET is not set in environment. Refusing to start.');
    process.exit(1);
  }
  const warnings = [];
  if (config.jwtSecret.length < 32) warnings.push('JWT_SECRET is shorter than 32 characters; generate one with: openssl rand -hex 32');
  if (config.tokenSecret.length < 32) warnings.push('TOKEN_SECRET is shorter than 32 characters; generate one with: openssl rand -hex 32');
  if (!env.JWT_SECRET || !env.TOKEN_SECRET) warnings.push('Only one of JWT_SECRET / TOKEN_SECRET is set, so it is used for both. Set both to different values.');
  else if (env.JWT_SECRET === env.TOKEN_SECRET) warnings.push('JWT_SECRET and TOKEN_SECRET are identical; use two different values.');
  return warnings;
};

module.exports = config;
