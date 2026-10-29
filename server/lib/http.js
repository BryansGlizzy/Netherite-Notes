class HttpError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// v1 routes answer { error: { code, message } }; the older core routes answer { error: "message" }.
function sendError(req, res, status, code, message, extra = {}) {
  if (req.originalUrl.startsWith('/api/v1')) return res.status(status).json({ error: { code, message, ...extra } });
  return res.status(status).json({ error: message, code, ...extra });
}

function serverError(req, res, err) {
  console.error(`[${req.id}] ${req.method} ${req.originalUrl}`, err);
  return sendError(req, res, 500, 'INTERNAL_ERROR', 'Internal server error', { requestId: req.id });
}

// Wraps async handlers/middleware so thrown HttpErrors become responses and anything else becomes a generic 500.
const h = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    if (res.headersSent) return next(err);
    if (err instanceof HttpError) return sendError(req, res, err.status, err.code, err.message);
    return serverError(req, res, err);
  });

// Final Express error handler: body-parser failures and anything unexpected become generic JSON responses.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') return sendError(req, res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return sendError(req, res, 400, 'BAD_REQUEST', 'Malformed JSON body');
  return serverError(req, res, err);
}

module.exports = { HttpError, sendError, serverError, h, errorHandler };
