const express = require('express');
const { live, ready } = require('../controllers/health.controller.js');
function healthRoutes({ connection }) { const router = express.Router(); router.get('/live', live); router.get('/ready', ready(connection)); return router; }
module.exports = { healthRoutes };