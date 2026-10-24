const { ApiError } = require('../core/errors.js');
async function listPatients({ repository, authContext, page, limit }) {
  if (authContext.actorType !== 'PATIENT') throw new ApiError(403, 'FORBIDDEN', 'Actor cannot list patient records.');
  const parsedPage = page === undefined ? 1 : Number(page);
  const parsedLimit = limit === undefined ? 20 : Number(limit);
  if (!Number.isInteger(parsedPage) || parsedPage < 1 || !Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) throw new ApiError(400, 'VALIDATION_ERROR', 'page/limit is invalid.');
  return repository.listOwned(authContext.userId, { skip: (parsedPage - 1) * parsedLimit, limit: parsedLimit });
}
module.exports = { listPatients };