const { randomUUID } = require("node:crypto");
function requestContext(req, res, next) {
  const supplied = req.get("x-correlation-id");
  req.correlationId =
    supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
      ? supplied
      : randomUUID();
  res.setHeader("x-correlation-id", req.correlationId);
  next();
}
module.exports = { requestContext };
