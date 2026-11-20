import { z } from 'zod';
import { STATUSES, OPEN_STATUSES } from '../config/domain.js';
import { getDb } from '../db/index.js';
import { AppError } from '../middleware/errors.js';
import { sanitiseText } from '../middleware/security.js';
import * as Reports from '../models/reportModel.js';
import * as Duplicates from '../models/duplicateModel.js';
import { listRuns } from '../models/agentModel.js';
import { messageCounts } from '../models/contactModel.js';
import { processReport, startRun } from '../ai/orchestrator.js';
import { getReportDetail, presentReport } from './reportController.js';

const demoFilter = (demo) => (demo === 'exclude' ? 'WHERE is_demo = 0' : demo === 'only' ? 'WHERE is_demo = 1' : '');
const andDemo = (demo) => (demo === 'exclude' ? 'AND is_demo = 0' : demo === 'only' ? 'AND is_demo = 1' : '');

export function getStats(req, res) {
  const demo = ['include', 'exclude', 'only'].includes(req.query.demo) ? req.query.demo : 'include';
  const db = getDb();
  const where = demoFilter(demo);
  const and = andDemo(demo);
  const one = (sql) => db.prepare(sql).get().c;
  const open = OPEN_STATUSES.map((s) => `'${s}'`).join(',');

  const totals = {
    total: one(`SELECT COUNT(*) c FROM reports ${where}`),
    pending: one(`SELECT COUNT(*) c FROM reports WHERE status IN ('submitted','under_review') ${and}`),
    in_progress: one(`SELECT COUNT(*) c FROM reports WHERE status = 'in_progress' ${and}`),
    high: one(`SELECT COUNT(*) c FROM reports WHERE priority = 'High' AND status IN (${open}) ${and}`),
    critical: one(`SELECT COUNT(*) c FROM reports WHERE priority = 'Critical' AND status IN (${open}) ${and}`),
    resolved: one(`SELECT COUNT(*) c FROM reports WHERE status = 'resolved' ${and}`),
    needs_review: one(`SELECT COUNT(*) c FROM reports WHERE needs_human_review = 1 AND status IN (${open}) ${and}`),
    potential_duplicates: db
      .prepare(`SELECT COUNT(*) c FROM duplicate_links d JOIN reports r ON r.id = d.report_id WHERE d.status = 'suggested' ${and.replace('is_demo', 'r.is_demo')}`)
      .get().c,
  };
  const group = (col) => db.prepare(`SELECT COALESCE(${col}, 'unclassified') AS name, COUNT(*) AS value FROM reports ${where} GROUP BY 1 ORDER BY 2 DESC`).all();
  const byArea = db.prepare(`SELECT COALESCE(area, 'Unknown area') AS name, COUNT(*) AS value FROM reports ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`).all();
  const timeline = db
    .prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS reports FROM reports WHERE created_at >= ? ${and} GROUP BY 1 ORDER BY 1`)
    .all(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const recent = Reports.listReports({ demo, limit: 8 }).map(presentReport);
  const runs = listRuns({ limit: 8 });
  const agentStats = db
    .prepare(`SELECT status, COUNT(*) c, AVG(duration_ms) avg_ms FROM agent_runs GROUP BY status`)
    .all();

  res.json({
    messages: messageCounts(),
    totals,
    byCategory: group('category'),
    byPriority: group('priority'),
    byStatus: group('status'),
    byArea,
    timeline,
    recent,
    runs,
    agentStats,
  });
}

const statusSchema = z.object({ status: z.enum(STATUSES), note: z.string().max(1000).optional() });

function requireReport(id) {
  const report = Reports.getReportRow(Number(id));
  if (!report) throw new AppError(404, 'NOT_FOUND', 'Report not found.');
  return report;
}

export function updateStatus(req, res) {
  const report = requireReport(req.params.id);
  const { status, note } = statusSchema.parse(req.body);
  if (report.status === status) throw new AppError(409, 'NO_CHANGE', `Report is already ${status}.`);
  Reports.changeStatus(report.id, status, { note: note ? sanitiseText(note, 1000) : null });
  res.json({ report: getReportDetail(report.id) });
}

const noteSchema = z.object({ note: z.string().trim().min(1, 'Note cannot be empty').max(2000) });

export function addNote(req, res) {
  const report = requireReport(req.params.id);
  const { note } = noteSchema.parse(req.body);
  res.status(201).json({ note: Reports.addNote(report.id, sanitiseText(note, 2000)) });
}

export function getNotes(req, res) {
  const report = requireReport(req.params.id);
  res.json({ notes: Reports.getNotes(report.id) });
}

const reviewFlagSchema = z.object({ flag: z.boolean(), reason: z.string().max(300).optional() });

export function flagReview(req, res) {
  const report = requireReport(req.params.id);
  const { flag, reason } = reviewFlagSchema.parse(req.body);
  Reports.setHumanReview(report.id, flag, reason ? sanitiseText(reason, 300) : 'Flagged by administrator');
  res.json({ report: getReportDetail(report.id) });
}

export function listDuplicateGroups(req, res) {
  const status = ['suggested', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
  res.json({ groups: Duplicates.listDuplicateGroups({ status }) });
}

const dupReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
  linkIds: z.array(z.number().int().positive()).optional(),
});

export function reviewDuplicateGroup(req, res) {
  const report = requireReport(req.params.reportId);
  const { decision, note, linkIds } = dupReviewSchema.parse(req.body);
  const links = Duplicates.getDuplicatesForReport(report.id);
  if (!links.length) throw new AppError(404, 'NO_DUPLICATES', 'This report has no suggested duplicates.');
  const updated = Duplicates.reviewLinks(report.id, decision, note ? sanitiseText(note, 1000) : null, linkIds);

  if (decision === 'approved' && report.status !== 'duplicate') {
    const target = updated.find((l) => l.status === 'approved');
    Reports.changeStatus(report.id, 'duplicate', { note: `Duplicate group approved${target ? ` — linked to ${target.candidate_reference}` : ''}` });
  }
  const remaining = updated.filter((l) => l.status === 'suggested').length;
  if (!remaining && decision === 'rejected') {
    const r = Reports.getReportRow(report.id);
    const reasons = r.review_reasons.filter((x) => !/duplicate/i.test(x));
    Reports.updateReport(report.id, { review_reasons: reasons, needs_human_review: reasons.length ? 1 : 0 });
  }
  res.json({ links: updated, report: getReportDetail(report.id) });
}

export async function reanalyse(req, res) {
  const report = requireReport(req.params.id);
  const { runId, client } = startRun(report.id);
  const job = processReport(report.id, { client, runId });
  if (req.query.wait === 'true') {
    await job;
    return res.json({ runId, report: getReportDetail(report.id) });
  }
  job.catch((err) => console.error('[orchestrator] unhandled', err));
  res.status(202).json({ runId });
}
