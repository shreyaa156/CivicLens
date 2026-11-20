import { all, get, run, nowIso } from '../db/index.js';

const parse = (v) => {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export async function createRun({ reportId, aiMode, model }) {
  const { insertId } = await run(`INSERT INTO agent_runs (report_id, status, ai_mode, model, started_at) VALUES (:rid, 'running', :mode, :model, :ts)`, {
    rid: reportId,
    mode: aiMode,
    model,
    ts: nowIso(),
  });
  return insertId;
}

export async function addStep(runId, { agent, step, status = 'info', message, data, durationMs }) {
  await run(
    `INSERT INTO agent_steps (run_id, agent, step, status, message, data, duration_ms, created_at)
     VALUES (:run, :agent, :step, :status, :message, :data, :dur, :ts)`,
    { run: runId, agent, step, status, message, data: data === undefined ? null : JSON.stringify(data), dur: durationMs, ts: nowIso() },
  );
}

/**
 * Ordered, non-blocking step logger for one run. Agents call log() synchronously; writes are
 * queued so steps are stored in order. Call flush() before finishing the run.
 */
export function createStepLogger(runId) {
  let chain = Promise.resolve();
  const log = (entry) => {
    chain = chain.then(() => addStep(runId, entry)).catch((err) => console.error('[agent-log] failed to store step:', err.message));
  };
  log.flush = () => chain;
  return log;
}

export async function finishRun(runId, { status, error, finalDecision, model }) {
  const runRow = await get('SELECT started_at FROM agent_runs WHERE id = ?', [runId]);
  const end = new Date();
  if (model) await run('UPDATE agent_runs SET model = ? WHERE id = ?', [model, runId]);
  await run('UPDATE agent_runs SET status = :status, completed_at = :end, duration_ms = :dur, error = :error, final_decision = :fd WHERE id = :id', {
    id: runId,
    status,
    end: end.toISOString(),
    dur: runRow ? end - new Date(runRow.started_at) : null,
    error,
    fd: finalDecision ? JSON.stringify(finalDecision) : null,
  });
}

export async function saveResult(runId, reportId, agent, output, validationErrors) {
  await run('INSERT INTO agent_results (run_id, report_id, agent, output, valid, validation_errors, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    runId,
    reportId ?? null,
    agent,
    JSON.stringify(output ?? null),
    validationErrors?.length ? 0 : 1,
    validationErrors?.length ? JSON.stringify(validationErrors) : null,
    nowIso(),
  ]);
}

function mapRun(r) {
  return r && { ...r, final_decision: parse(r.final_decision) };
}

export async function getRun(runId) {
  const runRow = mapRun(
    await get(`SELECT a.*, r.reference, r.category, r.priority, r.is_demo FROM agent_runs a LEFT JOIN reports r ON r.id = a.report_id WHERE a.id = ?`, [runId]),
  );
  if (!runRow) return null;
  runRow.steps = (await all('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY id', [runId])).map((s) => ({ ...s, data: parse(s.data) }));
  runRow.results = (await all('SELECT * FROM agent_results WHERE run_id = ? ORDER BY id', [runId])).map((s) => ({
    ...s,
    output: parse(s.output),
    validation_errors: parse(s.validation_errors),
    valid: !!s.valid,
  }));
  return runRow;
}

export async function getLatestRunForReport(reportId) {
  const row = await get('SELECT id FROM agent_runs WHERE report_id = ? ORDER BY id DESC LIMIT 1', [reportId]);
  return row ? getRun(row.id) : null;
}

export async function listRuns({ limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 200);
  const rows = await all(
    `SELECT a.*, r.reference, r.category, r.priority, r.is_demo,
            (SELECT COUNT(*) FROM agent_steps s WHERE s.run_id = a.id) AS step_count,
            (SELECT COUNT(*) FROM agent_steps s WHERE s.run_id = a.id AND s.step LIKE 'tool_call%') AS tool_calls
     FROM agent_runs a LEFT JOIN reports r ON r.id = a.report_id ORDER BY a.id DESC LIMIT ${lim}`,
  );
  return rows.map(mapRun);
}
