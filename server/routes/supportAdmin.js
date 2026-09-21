'use strict';

const express = require('express');

/**
 * Mount in server.js the same way you mount your other admin routers:
 *   const db = require('./db');
 *   const supportAdminRouter = require('./routes/supportAdmin')(db, requireAdmin);
 *   app.use('/api/admin/support', supportAdminRouter);
 *
 * `requireAdmin` is whatever auth middleware already gates the rest of
 * /api/admin. No agent-status-override route here on purpose — see the
 * comment at the top of supportAdminController.js for why.
 */
module.exports = function buildSupportAdminRouter(db, requireAdmin) {
  const router = express.Router();
  const controller = require('../controllers/supportAdminController')(db);

  const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const guard = requireAdmin || ((req, res, next) => next());

  router.use(guard);

  // Agents
  router.get('/agents', wrapAsync(controller.listAgents));
  router.post('/agents', wrapAsync(controller.createAgent));
  router.patch('/agents/:id', wrapAsync(controller.updateAgent));
  router.patch('/agents/:id/active', wrapAsync(controller.setAgentActive));

  // Shifts
  router.get('/agents/:agentId/shifts', wrapAsync(controller.listShifts));
  router.put('/agents/:agentId/shifts', wrapAsync(controller.setShifts));

  // Queue / routing rules
  router.get('/queue-rules', wrapAsync(controller.listQueueRules));
  router.put('/queue-rules/:department', wrapAsync(controller.updateQueueRules));
  router.get('/queue-rules/:department/preview-routing', wrapAsync(controller.previewRouting));

  // Canned responses
  router.get('/canned-responses', wrapAsync(controller.listCannedResponses));
  router.post('/canned-responses', wrapAsync(controller.createCannedResponse));
  router.patch('/canned-responses/:id', wrapAsync(controller.updateCannedResponse));
  router.delete('/canned-responses/:id', wrapAsync(controller.deleteCannedResponse));

  // SLA policies
  router.get('/sla-policies', wrapAsync(controller.listSlaPolicies));
  router.put('/sla-policies/:department', wrapAsync(controller.updateSlaPolicy));

  // Live monitoring & escalations
  router.get('/live-overview', wrapAsync(controller.getLiveOverview));
  router.get('/escalations', wrapAsync(controller.listEscalations));
  router.patch('/chats/:chatId/reassign', wrapAsync(controller.reassignChat));
  router.patch('/chats/:chatId/force-close', wrapAsync(controller.forceCloseChat));

  // Reporting & audit
  router.get('/performance', wrapAsync(controller.getPerformanceReport));
  router.get('/audit-log', wrapAsync(controller.listAuditLog));

  return router;
};
