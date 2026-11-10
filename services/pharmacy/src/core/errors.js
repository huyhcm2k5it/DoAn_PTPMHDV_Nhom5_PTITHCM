function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status =
    err.type === 'entity.parse.failed'
      ? 400
      : Number.isInteger(err.status)
        ? err.status
        : 500;
  res.status(status).json({
    error: {
      code:
        status === 500
          ? 'INTERNAL_ERROR'
          : err.type === 'entity.parse.failed'
            ? 'VALIDATION_ERROR'
            : err.code || 'REQUEST_ERROR',
      message: status === 500 ? 'Đã xảy ra lỗi nội bộ.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
    meta: { correlationId: req.correlationId },
  });
}
function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài nguyên.' },
    meta: { correlationId: req.correlationId },
  });
}
module.exports = { errorHandler, notFound };
