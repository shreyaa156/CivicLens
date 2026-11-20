import { z } from 'zod';
import { STATUSES, OPEN_STATUSES } from '../config/domain.js';
import { all, get } from '../db/index.js';
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

export async function getStats(req, res) {
  const demo = ['include', 'exclude', 'only'].includes(req.query.demo) ? req.query.demo : 'include';
  const where = demoFilter(demo);
  const and = andDemo(demo);
  const one = async (sql) => Number((await get(sql)).c);
  const open = OPEN_STATUSES.map((s) => `'${s}'`).join(',');

  const totals = {
    total: await one(`SELECT COUNT(*) AS c FROM reports ${where}`),
    pending: await one(`SELECT COUNT(*) AS c FROM reports WHERE status IN ('submitted','under_review') ${and}`),
    in_progress: await one(`SELECT COUNT(*) AS c FROM reports WHERE status = 'in_progress' ${and}`),
    high: await one(`SELECT COUNT(*) AS c FROM reports WHERE priority = 'High' AND status IN (${open}) ${and}`),
    critical: await one(`SELECT COUNT(*) AS c FROM reports WHERE priority = 'Critical' AND status IN (${open}) ${and}`),
    resolved: await one(`SELECT COUNT(*) AS c FROM reports WHERE status = 'resolved' ${and}`),
    needs_review: await one(`SELECT COUNT(*) AS c FROM reports WHERE needs_human_review = 1 AND status IN (${open}) ${and}`),
    potential_duplicates: await one(
      `SELECT COUNT(*) AS c FROM duplicate_links d JOIN reports r ON r.id = d.report_id WHERE d.status = 'suggested' ${and.replace('is_demo', 'r.is_demo')}`,
    ),
  };
  const counts = (rows) => rows.map((r) => ({ ...r, value: Number(r.value) }));
  const group = async (col) =>
    counts(await all(`SELECT COALESCE(${col}, 'unclassified') AS name, COUNT(*) AS value FROM reports ${where} GROUP BY COALESCE(${col}, 'unclassified') ORDER BY value DESC`));
  const byArea = counts(
    await all(`SELECT COALESCE(area, 'Unknown area') AS name, COUNT(*) AS value FROM reports ${where} GROUP BY COALESCE(area, 'Unknown area') ORDER BY value DESC LIMIT 10`),
  );
  const timeline = (
    await all(
      `SELECT SUBSTR(created_at, 1, 10) AS day, COUNT(*) AS reports FROM reports WHERE created_at >= ? ${and} GROUP BY SUBSTR(created_at, 1, 10) ORDER BY day`,
      [new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)],
    )
  ).map((r) => ({ ...r, reports: Number(r.reports) }));
  const recent = (await Reports.listReports({ demo, limit: 8 })).map(presentReport);
  const runs = await listRuns({ limit: 8 });
  const agentStats = await all(`SELECT status, COUNT(*) AS c, AVG(duration_ms) AS avg_ms FROM agent_runs GROUP BY status`);

  res.json({
    messages: await messageCounts(),
    totals,
    byCategory: await group('category'),
    byPriority: await group('priority'),
    byStatus: await group('status'),
    byArea,
    timeline,
    recent,
    runs,
    agentStats,
  });
}

const statusSchema = z.object({ status: z.enum(STATUSES), note: z.string().max(1000).optional() });

async function requireReport(id) {
  const report = await Reports.getReportRow(Number(id));
  if (!report) throw new AppError(404, 'NOT_FOUND', 'Report not found.');
  return report;
}

export async function updateStatus(req, res) {
  const report = await requireReport(req.params.id);
  const { status, note } = statusSchema.parse(req.body);
  if (report.status === status) throw new AppError(409, 'NO_CHANGE', `Report is already ${status}.`);
  await Reports.changeStatus(report.id, status, { note: note ? sanitiseText(note, 1000) : null });
  res.json({ report: await getReportDetail(report.id) });
}

const noteSchema = z.object({ note: z.string().trim().min(1, 'Note cannot be empty').max(2000) });

export async function addNote(req, res) {
  const report = await requireReport(req.params.id);
  const { note } = noteSchema.parse(req.body);
  res.status(201).json({ note: await Reports.addNote(report.id, sanitiseText(note, 2000)) });
}

export async function getNotes(req, res) {
  const report = await requireReport(req.params.id);
  res.json({ notes: await Reports.getNotes(report.id) });
}

const reviewFlagSchema = z.object({ flag: z.boolean(), reason: z.string().max(300).optional() });

export async function flagReview(req, res) {
  const report = await requireReport(req.params.id);
  const { flag, reason } = reviewFlagSchema.parse(req.body);
  await Reports.setHumanReview(report.id, flag, reason ? sanitiseText(reason, 300) : 'Flagged by administrator');
  res.json({ report: await getReportDetail(report.id) });
}

export async function listDuplicateGroups(req, res) {
  const status = ['suggested', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
  res.json({ groups: await Duplicates.listDuplicateGroups({ status }) });
}

const dupReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
  linkIds: z.array(z.number().int().positive()).optional(),
});

export async function reviewDuplicateGroup(req, res) {
  const report = await requireReport(req.params.reportId);
  const { decision, note, linkIds } = dupReviewSchema.parse(req.body);
  const links = await Duplicates.getDuplicatesForReport(report.id);
  if (!links.length) throw new AppError(404, 'NO_DUPLICATES', 'This report has no suggested duplicates.');
  const updated = await Duplicates.reviewLinks(report.id, decision, note ? sanitiseText(note, 1000) : null, linkIds);

  if (decision === 'approved' && report.status !== 'duplicate') {
    const target = updated.find((l) => l.status === 'approved');
    await Reports.changeStatus(report.id, 'duplicate', { note: `Duplicate group approved${target ? ` — linked to ${target.candidate_reference}` : ''}` });
  }
  const remaining = updated.filter((l) => l.status === 'suggested').length;
  if (!remaining && decision === 'rejected') {
    const r = await Reports.getReportRow(report.id);
    const reasons = r.review_reasons.filter((x) => !/duplicate/i.test(x));
    await Reports.updateReport(report.id, { review_reasons: reasons, needs_human_review: reasons.length ? 1 : 0 });
  }
  res.json({ links: updated, report: await getReportDetail(report.id) });
}

export async function reanalyse(req, res) {
  const report = await requireReport(req.params.id);
  const { runId, client } = await startRun(report.id);
  const job = processReport(report.id, { client, runId });
  if (req.query.wait === 'true') {
    await job;
    return res.json({ runId, report: await getReportDetail(report.id) });
  }
  job.catch((err) => console.error('[orchestrator] unhandled', err));
  res.status(202).json({ runId });
}
