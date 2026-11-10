const { integer, failure } = require('../services/common');
const { receiveStock, listStock } = require('../services/stock.service');
const {
  listPrescriptions,
  prescriptionDetail,
} = require('../services/prescriptions.service');
const {
  createMedicationHold,
  releaseMedicationHold,
} = require('../services/medication-holds.service');
const { reconcileMedicationHold } = require('../services/settlement.service');
const { dispenseMedication } = require('../services/dispenses.service');
function body(req, allowed) {
  const value = req.body || {};
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw failure(400, 'VALIDATION_ERROR', 'Unexpected request fields.');
  return value;
}
function queryNumber(value, fallback, name) {
  if (value == null) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))
    throw failure(400, 'VALIDATION_ERROR', name + ' must be an integer.');
  return integer(Number(value), name);
}
function createPharmacyController({ connection, now = () => new Date() }) {
  const args = (req) => ({
    connection,
    principalId: req.authContext.userId,
    tokenVersion: req.authContext.tokenVersion,
    now: now(),
    idempotencyKey: req.get('idempotency-key'),
  });
  const send = (req, res, data, status = 200) => {
    res.set('Cache-Control', 'no-store');
    if (status === 202) res.set('Location', data.statusUrl);
    res
      .status(status)
      .json({ data, meta: { correlationId: req.correlationId } });
  };
  const paged = (req) => ({
    page: queryNumber(req.query.page, 1, 'page'),
    limit: queryNumber(req.query.limit, 20, 'limit'),
  });
  return {
    stock: async (req, res) => {
      if (
        (req.query.name && typeof req.query.name !== 'string') ||
        (req.query.code && typeof req.query.code !== 'string')
      )
        throw failure(400, 'VALIDATION_ERROR', 'Invalid stock filter.');
      send(
        req,
        res,
        await listStock({
          connection,
          ...paged(req),
          code: req.query.code,
          name: req.query.name,
        }),
      );
    },
    receive: async (req, res) =>
      send(
        req,
        res,
        await receiveStock({
          ...args(req),
          ...body(req, ['medicineId', 'quantity', 'batchRef']),
        }),
        201,
      ),
    queue: async (req, res) =>
      send(req, res, await listPrescriptions({ connection, ...paged(req) })),
    detail: async (req, res) =>
      send(
        req,
        res,
        await prescriptionDetail({
          connection,
          prescriptionId: req.params.prescriptionId,
          revision: queryNumber(req.query.revision, undefined, 'revision'),
          holdId: req.query.holdId,
          authContext: req.authContext,
        }),
      ),
    hold: async (req, res) =>
      send(
        req,
        res,
        await createMedicationHold({
          ...args(req),
          prescriptionId: req.params.prescriptionId,
          ...body(req, ['prescriptionRevision']),
        }),
        202,
      ),
    release: async (req, res) =>
      send(
        req,
        res,
        await releaseMedicationHold({
          ...args(req),
          holdId: req.params.holdId,
          expectedVersion: queryNumber(
            req.query.expectedVersion,
            undefined,
            'expectedVersion',
          ),
        }),
      ),
    reconcile: async (req, res) =>
      send(
        req,
        res,
        await reconcileMedicationHold({
          ...args(req),
          holdId: req.params.holdId,
          ...body(req, ['expectedAttemptNo']),
        }),
        202,
      ),
    dispense: async (req, res) =>
      send(
        req,
        res,
        await dispenseMedication({
          ...args(req),
          holdId: req.params.holdId,
          ...body(req, ['expectedVersion']),
        }),
      ),
  };
}
module.exports = { createPharmacyController };
