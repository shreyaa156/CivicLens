import { z } from 'zod';
import { CATEGORIES, CATEGORY_LABELS, DEPARTMENT_NAMES, PRIORITIES, STATUSES, OPEN_STATUSES } from '../config/domain.js';
import { getDb } from '../db/index.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errors.js';
import { sanitiseText } from '../middleware/security.js';
import { describeAiMode } from '../ai/modelClient.js';
import { getRun, listRuns } from '../models/agentModel.js';
import * as Messages from '../models/contactModel.js';

export function health(req, res) {
  res.json({ status: 'ok', time: new Date().toISOString() });
}

export function publicConfig(req, res) {
  res.json({
    ai: describeAiMode(),
    adminTokenRequired: Boolean(config.adminToken) || config.isProduction,
    categories: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    priorities: PRIORITIES,
    statuses: STATUSES,
    departments: DEPARTMENT_NAMES,
    duplicateRadiusMeters: config.duplicates.defaultRadiusMeters,
    maxUploadMb: Math.round(config.maxUploadBytes / 1048576),
  });
}

/** Public, live figures for the citizen-facing site. Computed from genuine reports only. */
export function publicStats(req, res) {
  const db = getDb();
  const open = OPEN_STATUSES.map((s) => `'${s}'`).join(',');
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const totals = one(`SELECT COUNT(*) total,
      SUM(status IN (${open})) open,
      SUM(status = 'resolved') resolved,
      SUM(status IN (${open}) AND priority = 'Critical') critical_open,
      SUM(status IN (${open}) AND priority = 'High') high_open,
      SUM(created_at >= ?) last_7_days,
      COUNT(DISTINCT area) areas
    FROM reports WHERE is_demo = 0`, new Date(Date.now() - 7 * 86400000).toISOString());
  const duplicates = one(`SELECT COUNT(*) c FROM duplicate_links d JOIN reports r ON r.id = d.report_id WHERE r.is_demo = 0 AND d.status != 'rejected'`).c;
  const runs = one(`SELECT COUNT(*) c, AVG(a.duration_ms) avg_ms FROM agent_runs a JOIN reports r ON r.id = a.report_id WHERE r.is_demo = 0 AND a.status = 'completed'`);
  const topCategories = db
    .prepare(`SELECT category, COUNT(*) count FROM reports WHERE is_demo = 0 AND category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 3`)
    .all();
  const latest = one(`SELECT a.id run_id, a.model, a.ai_mode, a.completed_at, a.final_decision, r.id report_id, r.reference, r.category, r.area
    FROM agent_runs a JOIN reports r ON r.id = a.report_id WHERE r.is_demo = 0 AND a.status = 'completed' ORDER BY a.id DESC LIMIT 1`);
  let latestDecision = null;
  if (latest) {
    const fd = JSON.parse(latest.final_decision || '{}');
    latestDecision = {
      run_id: latest.run_id, report_id: latest.report_id, reference: latest.reference, category: latest.category, area: latest.area,
      priority: fd.priority ?? null, department: fd.department ?? null, severity: fd.severity ?? null, confidence: fd.confidence ?? null,
      ai_mode: latest.ai_mode, model: latest.model, completed_at: latest.completed_at,
    };
  }
  res.json({
    totals: {
      total: totals.total || 0, open: totals.open || 0, resolved: totals.resolved || 0, critical_open: totals.critical_open || 0,
      high_open: totals.high_open || 0, last_7_days: totals.last_7_days || 0, areas: totals.areas || 0, duplicates_detected: duplicates,
    },
    agentRuns: { completed: runs.c, avg_seconds: runs.avg_ms ? Math.round(runs.avg_ms / 100) / 10 : null },
    topCategories,
    latestDecision,
  });
}

export function listAgentRuns(req, res) {
  res.json({ runs: listRuns({ limit: req.query.limit }), ai: describeAiMode() });
}

export function getAgentRun(req, res) {
  const run = getRun(Number(req.params.id));
  if (!run) throw new AppError(404, 'NOT_FOUND', 'Agent run not found.');
  res.json({ run });
}

const contactSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name').max(100),
  email: z.email('Please enter a valid email address').max(200),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(150),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(5000),
  website: z.string().max(0, 'Invalid submission').optional(), // honeypot
});

export function submitContact(req, res) {
  const parsed = contactSchema.parse(req.body || {});
  const data = {
    name: sanitiseText(parsed.name, 100),
    email: parsed.email.trim(),
    subject: sanitiseText(parsed.subject, 150).replace(/[\r\n]+/g, ' '),
    message: sanitiseText(parsed.message, 5000),
  };
  // Stored for the admin portal's Messages inbox (no email is sent).
  const id = Messages.saveContactMessage(data);
  res.status(201).json({ id, received: true });
}

// ---------- Admin: Messages inbox ----------

export function listMessages(req, res) {
  const filter = ['all', 'unread', 'read'].includes(req.query.filter) ? req.query.filter : 'all';
  res.json({ messages: Messages.listMessages({ filter }), counts: Messages.messageCounts() });
}

function requireMessage(id) {
  const msg = Messages.getMessage(Number(id));
  if (!msg) throw new AppError(404, 'NOT_FOUND', 'Message not found.');
  return msg;
}

export function updateMessage(req, res) {
  const msg = requireMessage(req.params.id);
  const { read } = z.object({ read: z.boolean() }).parse(req.body || {});
  res.json({ message: Messages.setMessageRead(msg.id, read), counts: Messages.messageCounts() });
}

export function removeMessage(req, res) {
  const msg = requireMessage(req.params.id);
  Messages.deleteMessage(msg.id);
  res.json({ deleted: true, counts: Messages.messageCounts() });
}
