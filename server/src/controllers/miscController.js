import { z } from 'zod';
import { CATEGORIES, CATEGORY_LABELS, DEPARTMENT_NAMES, PRIORITIES, STATUSES, OPEN_STATUSES } from '../config/domain.js';
import { all, get, dialect } from '../db/index.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errors.js';
import { sanitiseText } from '../middleware/security.js';
import { describeAiMode } from '../ai/modelClient.js';
import { getRun, listRuns } from '../models/agentModel.js';
import * as Messages from '../models/contactModel.js';

export async function health(req, res) {
  try {
    await get('SELECT 1 AS ok');
    res.json({ status: 'ok', database: dialect(), time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', database: dialect(), message: 'Database unavailable' });
  }
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
    map: config.map,
  });
}

/** Public, live figures for the citizen-facing site. Computed from genuine reports only. */
export async function publicStats(req, res) {
  const open = OPEN_STATUSES.map((s) => `'${s}'`).join(',');
  const n = (v) => Number(v) || 0;
  const totals = await get(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status IN (${open}) THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN status IN (${open}) AND priority = 'Critical' THEN 1 ELSE 0 END) AS critical_open,
      SUM(CASE WHEN status IN (${open}) AND priority = 'High' THEN 1 ELSE 0 END) AS high_open,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last_7_days,
      COUNT(DISTINCT area) AS areas
    FROM reports WHERE is_demo = 0`,
    [new Date(Date.now() - 7 * 86400000).toISOString()],
  );
  const duplicates = (await get(`SELECT COUNT(*) AS c FROM duplicate_links d JOIN reports r ON r.id = d.report_id WHERE r.is_demo = 0 AND d.status != 'rejected'`)).c;
  const runs = await get(`SELECT COUNT(*) AS c, AVG(a.duration_ms) AS avg_ms FROM agent_runs a JOIN reports r ON r.id = a.report_id WHERE r.is_demo = 0 AND a.status = 'completed'`);
  const topCategories = (
    await all(`SELECT category, COUNT(*) AS count FROM reports WHERE is_demo = 0 AND category IS NOT NULL GROUP BY category ORDER BY count DESC LIMIT 3`)
  ).map((r) => ({ ...r, count: n(r.count) }));
  const latest = await get(`SELECT a.id AS run_id, a.model, a.ai_mode, a.completed_at, a.final_decision, r.id AS report_id, r.reference, r.category, r.area
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
      total: n(totals.total), open: n(totals.open_count), resolved: n(totals.resolved), critical_open: n(totals.critical_open),
      high_open: n(totals.high_open), last_7_days: n(totals.last_7_days), areas: n(totals.areas), duplicates_detected: n(duplicates),
    },
    agentRuns: { completed: n(runs.c), avg_seconds: runs.avg_ms ? Math.round(runs.avg_ms / 100) / 10 : null },
    topCategories,
    latestDecision,
  });
}

export async function listAgentRuns(req, res) {
  res.json({ runs: await listRuns({ limit: req.query.limit }), ai: describeAiMode() });
}

export async function getAgentRun(req, res) {
  const run = await getRun(Number(req.params.id));
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

export async function submitContact(req, res) {
  const parsed = contactSchema.parse(req.body || {});
  const data = {
    name: sanitiseText(parsed.name, 100),
    email: parsed.email.trim(),
    subject: sanitiseText(parsed.subject, 150).replace(/[\r\n]+/g, ' '),
    message: sanitiseText(parsed.message, 5000),
  };
  // Stored for the admin portal's Messages inbox (no email is sent).
  const id = await Messages.saveContactMessage(data);
  res.status(201).json({ id, received: true });
}

// ---------- Admin: Messages inbox ----------

export async function listMessages(req, res) {
  const filter = ['all', 'unread', 'read'].includes(req.query.filter) ? req.query.filter : 'all';
  res.json({ messages: await Messages.listMessages({ filter }), counts: await Messages.messageCounts() });
}

async function requireMessage(id) {
  const msg = await Messages.getMessage(Number(id));
  if (!msg) throw new AppError(404, 'NOT_FOUND', 'Message not found.');
  return msg;
}

export async function updateMessage(req, res) {
  const msg = await requireMessage(req.params.id);
  const { read } = z.object({ read: z.boolean() }).parse(req.body || {});
  res.json({ message: await Messages.setMessageRead(msg.id, read), counts: await Messages.messageCounts() });
}

export async function removeMessage(req, res) {
  const msg = await requireMessage(req.params.id);
  await Messages.deleteMessage(msg.id);
  res.json({ deleted: true, counts: await Messages.messageCounts() });
}
