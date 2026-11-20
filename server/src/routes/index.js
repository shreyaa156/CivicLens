import { Router } from 'express';
import { upload, reportLimiter, contactLimiter, requireAdmin } from '../middleware/security.js';
import * as reports from '../controllers/reportController.js';
import * as admin from '../controllers/adminController.js';
import * as misc from '../controllers/miscController.js';

const router = Router();

// Public
router.get('/health', misc.health);
router.get('/config', misc.publicConfig);
router.get('/stats/public', misc.publicStats);
router.get('/reports', reports.listReports);
router.get('/reports/:id', reports.getReport);
router.post('/reports', reportLimiter, upload.single('image'), reports.createReport);
router.get('/duplicates', admin.listDuplicateGroups); // read-only view for the public map
router.get('/agents/runs/:id', misc.getAgentRun);
router.post('/contact', contactLimiter, misc.submitContact);

// Admin
const a = Router();
a.use(requireAdmin);
a.get('/verify', (req, res) => res.json({ ok: true }));
a.get('/stats', admin.getStats);
a.get('/agent-runs', misc.listAgentRuns);
a.get('/messages', misc.listMessages);
a.patch('/messages/:id', misc.updateMessage);
a.delete('/messages/:id', misc.removeMessage);
a.patch('/reports/:id/status', admin.updateStatus);
a.get('/reports/:id/notes', admin.getNotes);
a.post('/reports/:id/notes', admin.addNote);
a.post('/reports/:id/review', admin.flagReview);
a.post('/reports/:id/reanalyse', admin.reanalyse);
a.get('/duplicates', admin.listDuplicateGroups);
a.post('/duplicates/:reportId/review', admin.reviewDuplicateGroup);
router.use('/admin', a);

export default router;
