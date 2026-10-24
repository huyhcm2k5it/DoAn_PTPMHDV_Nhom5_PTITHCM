const express = require('express');
const { createSlotsController } = require('../controllers/slots.controller.js');
function slotsRoutes(dependencies) { const router = express.Router(); const controller = createSlotsController(dependencies); router.get('/available', controller.listAvailable); return router; }
module.exports = { slotsRoutes };