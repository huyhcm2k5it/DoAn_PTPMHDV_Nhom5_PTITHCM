function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi nội bộ.' }, correlationId: req.correlationId });
}
function notFound(req, res) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy tài nguyên.' }, correlationId: req.correlationId }); }
module.exports = { errorHandler, notFound };