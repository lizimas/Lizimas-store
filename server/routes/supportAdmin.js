'use strict';

/**
 * Matches how your other sub-routers are wired (chat.js, admin.js): a plain
 * router, required directly, no arguments. Add ONE line inside admin.js,
 * AFTER `router.use(requireAuth, requireAdmin);` (line 209) so this inherits
 * that gate automatically — same as everything else below that line:
 *
 *   router.use("/support", require("./supportAdmin"));
 *
 * No separate auth wiring needed here.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/supportAdminController');

const wrapAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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
// No reassign/force-close routes here on purpose — the Live Monitor tab's
// admin panel calls the existing PATCH /api/chat/conversations/:id
// directly for those. See the comment in supportAdminController.js.

// Reporting & audit
router.get('/performance', wrapAsync(controller.getPerformanceReport));
router.get('/analytics', wrapAsync(controller.getAnalytics));
router.get('/audit-log', wrapAsync(controller.listAuditLog));

module.exports = router;
