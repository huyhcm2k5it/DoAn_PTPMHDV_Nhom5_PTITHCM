const express = require('express');
const { createAuthContext, requirePharmacy, requireLease } = require('../auth/auth.middleware');
const { createPharmacyController } = require('../controllers/pharmacy.controller');
function pharmacyRoutes(dependencies) {
  const router = express.Router();
  const c = createPharmacyController(dependencies);
  const staff = requirePharmacy(dependencies.connection);
  router.use(createAuthContext(dependencies));
  router.get('/stock', staff, c.stock);
  router.post('/stock/receipts', staff, requireLease(dependencies, 'PH002'), c.receive);
  router.get('/prescriptions/queue', staff, requireLease(dependencies, 'PH003'), c.queue);
  router.get('/prescriptions/:prescriptionId', requireLease(dependencies, 'PH004'), c.detail);
  router.post(
    '/prescriptions/:prescriptionId/holds',
    staff,
    requireLease(dependencies, 'PH005'),
    c.hold,
  );
  router.delete('/holds/:holdId', staff, requireLease(dependencies, 'PH006'), c.release);
  router.post('/holds/:holdId/commit', staff, requireLease(dependencies, 'PH007'), c.reconcile);
  router.post('/holds/:holdId/dispense', staff, requireLease(dependencies, 'PH008'), c.dispense);
  return router;
}
module.exports = { pharmacyRoutes };
