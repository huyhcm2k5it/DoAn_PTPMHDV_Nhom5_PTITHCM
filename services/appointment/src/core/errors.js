class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  res
    .status(status)
    .json({
      error: {
        code: err.code || (status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
        message: status === 500 ? "Đã xảy ra lỗi nội bộ." : err.message,
      },
      correlationId: req.correlationId,
    });
}
function notFound(req, res) {
  res
    .status(404)
    .json({
      error: { code: "NOT_FOUND", message: "Không tìm thấy tài nguyên." },
      correlationId: req.correlationId,
    });
}
module.exports = { ApiError, errorHandler, notFound };
