const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const { sendError } = require('../lib/http');

const limiter = ({ windowMs, limit, key, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: key || ((req) => ipKeyGenerator(req.ip)),
    handler: (req, res) => sendError(req, res, 429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again later.')
  });

const MIN = 60 * 1000;
const bodyKey = (prefix, field) => (req) => `${prefix}:${String((req.body && req.body[field]) || '').toLowerCase().slice(0, 254)}`;

const apiTotalLimiter = limiter({ windowMs: MIN, limit: config.limits.apiMax });
const apiFailLimiter = limiter({ windowMs: MIN, limit: config.limits.apiFailMax, skipSuccessfulRequests: true });
const v1FailLimiter = limiter({ windowMs: MIN, limit: config.limits.v1FailMax, skipSuccessfulRequests: true });
const loginIpLimiter = limiter({ windowMs: 15 * MIN, limit: config.limits.loginMax, skipSuccessfulRequests: true });
const loginUserLimiter = limiter({ windowMs: 15 * MIN, limit: config.limits.loginMax, skipSuccessfulRequests: true, key: bodyKey('login', 'username') });
const registerLimiter = limiter({ windowMs: 60 * MIN, limit: config.limits.registerMax });
const forgotIpLimiter = limiter({ windowMs: 60 * MIN, limit: config.limits.forgotMax });
const forgotEmailLimiter = limiter({ windowMs: 60 * MIN, limit: config.limits.forgotMax, key: bodyKey('forgot', 'email') });
const healthLimiter = limiter({ windowMs: MIN, limit: 60 });

module.exports = {
  limiter, MIN, apiTotalLimiter, apiFailLimiter, v1FailLimiter, loginIpLimiter, loginUserLimiter,
  registerLimiter, forgotIpLimiter, forgotEmailLimiter, healthLimiter
};
