const { listPatients } = require('../services/list-patients.service.js');
const { getPatient } = require('../services/get-patient.service.js');
function createPatientsController(dependencies) {
  return {
    async list(req, res, next) {
      try {
        const result = await listPatients({ repository: dependencies.repository, authContext: req.authContext, page: req.query.page, limit: req.query.limit });
        res.status(200).json({ data: result, meta: { correlationId: req.correlationId } });
      } catch (error) { next(error); }
    },
    async getById(req, res, next) {
      try {
        const patient = await getPatient({ repository: dependencies.repository, authContext: req.authContext, patientId: req.params.patientId, authorizeScopedRead: dependencies.authorizeScopedRead });
        res.status(200).json({ data: { patient }, meta: { correlationId: req.correlationId } });
      } catch (error) { next(error); }
    },
  };
}
module.exports = { createPatientsController };