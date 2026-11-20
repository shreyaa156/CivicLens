import { getDb, clean, nowIso } from '../db/index.js';

const parse = (v) => {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export function createRun({ reportId, aiMode, model }) {
  const info = getDb()
    .prepare(`INSERT INTO agent_runs (report_id, status, ai_mode, model, started_at) VALUES (:rid, 'running', :mode, :model, :ts)`)
    .run(clean({ rid: reportId, mode: aiMode, model, ts: nowIso() }));
  return Number(info.lastInsertRowid);
}

export function addStep(runId, { agent, step, status = 'info', message, data, durationMs }) {
  getDb()
    .prepare(
      `INSERT INTO agent_steps (run_id, agent, step, status, message, data, duration_ms, created_at)
       VALUES (:run, :agent, :step, :status, :message, :data, :dur, :ts)`,
    )
    .run(clean({ run: runId, agent, step, status, message, data: data === undefined ? null : JSON.stringify(data), dur: durationMs, ts: nowIso() }));
}

export function finishRun(runId, { status, error, finalDecision, model }) {
  const db = getDb();
  const run = db.prepare('SELECT started_at FROM agent_runs WHERE id = ?').get(runId);
  const end = new Date();
  if (model) db.prepare('UPDATE agent_runs SET model = ? WHERE id = ?').run(model, runId);
  db.prepare('UPDATE agent_runs SET status = :status, completed_at = :end, duration_ms = :dur, error = :error, final_decision = :fd WHERE id = :id').run(
    clean({
      id: runId,
      status,
      end: end.toISOString(),
      dur: run ? end - new Date(run.started_at) : null,
      error,
      fd: finalDecision ? JSON.stringify(finalDecision) : null,
    }),
  );
}

export function saveResult(runId, reportId, agent, output, validationErrors) {
  getDb()
    .prepare('INSERT INTO agent_results (run_id, report_id, agent, output, valid, validation_errors) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId, reportId ?? null, agent, JSON.stringify(output ?? null), validationErrors?.length ? 0 : 1, validationErrors?.length ? JSON.stringify(validationErrors) : null);
}

function mapRun(r) {
  return r && { ...r, final_decision: parse(r.final_decision) };
}

export function getRun(runId) {
  const db = getDb();
  const run = mapRun(
    db.prepare(`SELECT a.*, r.reference, r.category, r.priority, r.is_demo FROM agent_runs a LEFT JOIN reports r ON r.id = a.report_id WHERE a.id = ?`).get(runId),
  );
  if (!run) return null;
  run.steps = db.prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY id').all(runId).map((s) => ({ ...s, data: parse(s.data) }));
  run.results = db.prepare('SELECT * FROM agent_results WHERE run_id = ? ORDER BY id').all(runId).map((s) => ({ ...s, output: parse(s.output), validation_errors: parse(s.validation_errors), valid: !!s.valid }));
  return run;
}

export function getLatestRunForReport(reportId) {
  const row = getDb().prepare('SELECT id FROM agent_runs WHERE report_id = ? ORDER BY id DESC LIMIT 1').get(reportId);
  return row ? getRun(row.id) : null;
}

export function listRuns({ limit = 50 } = {}) {
  return getDb()
    .prepare(
      `SELECT a.*, r.reference, r.category, r.priority, r.is_demo,
              (SELECT COUNT(*) FROM agent_steps s WHERE s.run_id = a.id) AS step_count,
              (SELECT COUNT(*) FROM agent_steps s WHERE s.run_id = a.id AND s.step LIKE 'tool_call%') AS tool_calls
       FROM agent_runs a LEFT JOIN reports r ON r.id = a.report_id ORDER BY a.id DESC LIMIT ?`,
    )
    .all(Math.min(Number(limit) || 50, 200))
    .map(mapRun);
}
