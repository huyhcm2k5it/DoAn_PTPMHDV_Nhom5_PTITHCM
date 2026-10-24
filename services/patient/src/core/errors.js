class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  const body = { error: { code: err.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'), message: status === 500 ? 'Đã xảy ra lỗi nội bộ.' : err.message }, correlationId: req.correlationId };
  if (err.details !== undefined && status < 500) body.error.details = err.details;
  res.status(status).json(body);
}
function notFound(req, res) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài nguyên.' }, correlationId: req.correlationId }); }
module.exports = { ApiError, errorHandler, notFound };