import { config } from '../config/index.js';
import { CATEGORY_DEFAULT_DEPARTMENT, PRIORITIES } from '../config/domain.js';
import { getReportRow, getImages, updateReport, getImageHashes } from '../models/reportModel.js';
import { upsertDuplicateLink } from '../models/duplicateModel.js';
import { createRun, createStepLogger, finishRun, saveResult } from '../models/agentModel.js';
import { readImageBase64, hashSimilarity } from '../services/imageService.js';
import { haversineMeters } from '../services/geo.js';
import { jaccard } from '../services/textSimilarity.js';
import { createModelClient } from './modelClient.js';
import { runIssueIntelligenceAgent, AGENT_ID as A1, AGENT_NAME as A1_NAME } from './agents/issueIntelligenceAgent.js';
import { runActionPrioritisationAgent, AGENT_ID as A2, AGENT_NAME as A2_NAME } from './agents/actionPrioritisationAgent.js';

const ORCH = 'orchestrator';
const AGENT_ATTEMPTS = 2; // whole-agent retries on top of per-request retries

const running = new Map(); // reportId -> promise (prevents double processing)

export function processReport(reportId, options = {}) {
  if (running.has(reportId)) return running.get(reportId);
  const p = orchestrate(reportId, options).finally(() => running.delete(reportId));
  running.set(reportId, p);
  return p;
}

/** Create the run record up-front so the API can return a run id for live progress. */
export async function startRun(reportId, client = createModelClient()) {
  const runId = await createRun({ reportId, aiMode: client.mode, model: client.model });
  return { runId, client };
}

async function orchestrate(reportId, { client, runId } = {}) {
  client = client || createModelClient();
  runId = runId || (await createRun({ reportId, aiMode: client.mode, model: client.model }));
  const log = createStepLogger(runId);
  const report = await getReportRow(reportId);

  log({
    agent: ORCH,
    step: 'workflow_started',
    status: 'info',
    message: `Workflow started for report ${report.reference} (${client.mode === 'gemini' ? `Google Gemini · ${client.model}` : 'DEVELOPMENT MODE — sample responses, not Gemini'})`,
    data: { report_id: reportId, ai_mode: client.mode, model: client.model },
  });
  await updateReport(reportId, { analysis_status: 'processing', ai_mode: client.mode });

  // ---------- Agent 1 ----------
  const image = (await getImages(reportId))[0];
  let a1;
  try {
    if (!image) throw new Error('Report has no image');
    const imageBase64 = await readImageBase64(image.filename);
    log({ agent: A1, step: 'image_received', status: 'success', message: `Image received (${image.width}×${image.height}, ${Math.round(image.size_bytes / 1024)} KB)`, data: { filename: image.filename } });
    log({ agent: ORCH, step: 'handoff', status: 'info', message: `Handoff → ${A1_NAME}`, data: { to: A1, inputs: ['photograph', 'citizen description', 'coordinates'] } });
    log({ agent: A1, step: 'analysis_started', status: 'info', message: 'Vision analysis and duplicate search started' });

    a1 = await attemptAgent(A1, log, () =>
      runIssueIntelligenceAgent({ client, input: { report, imageBase64, imageMimeType: image.mime_type, imageHash: image.image_hash }, log }),
    );
  } catch (err) {
    return failWorkflow({ runId, reportId, log, stage: A1, err, model: client.model });
  }

  const { findings } = a1;
  log({
    agent: A1,
    step: 'issue_identified',
    status: 'success',
    message: `Identified: ${findings.category.replace(/_/g, ' ')} · severity ${findings.severity} · confidence ${Math.round(findings.confidence * 100)}%`,
    data: { category: findings.category, severity: findings.severity, confidence: findings.confidence, image_assessment: findings.image_assessment },
  });

  // ---------- Validate Agent 1 duplicates against real DB evidence ----------
  const duplicateEvidence = await buildDuplicateEvidence(report, image, a1, log);
  await saveResult(runId, reportId, A1, { ...findings, duplicates: duplicateEvidence.candidates }, duplicateEvidence.droppedIds.length ? [`Dropped unverifiable duplicate ids: ${duplicateEvidence.droppedIds.join(', ')}`] : null);
  for (const d of duplicateEvidence.candidates.filter((c) => c.likelihood !== 'unlikely')) {
    await upsertDuplicateLink({
      reportId,
      candidateId: d.report_id,
      distanceM: d.distance_m,
      imageSimilarity: d.image_similarity,
      textSimilarity: d.text_similarity,
      likelihood: d.likelihood,
      reason: d.reason,
    });
  }
  log({
    agent: A1,
    step: 'duplicates_completed',
    status: 'success',
    message: `Duplicate detection completed: ${duplicateEvidence.retrieved_count} nearby report(s) retrieved, ${duplicateEvidence.candidates.filter((c) => c.likelihood !== 'unlikely').length} potential duplicate(s)`,
    data: { summary: findings.duplicate_summary, candidates: duplicateEvidence.candidates },
  });

  // Persist Agent 1 results immediately so they survive an Agent 2 failure.
  await updateReport(reportId, {
    category: findings.category,
    ai_description: findings.description,
    severity: findings.severity,
    confidence: findings.confidence,
    image_assessment: findings.image_assessment,
    duplicate_summary: findings.duplicate_summary,
  });

  // ---------- Agent 2 ----------
  log({
    agent: ORCH,
    step: 'handoff',
    status: 'info',
    message: `Handoff → ${A2_NAME} with validated findings and ${duplicateEvidence.candidates.length} duplicate candidate(s)`,
    data: { to: A2, evidence: { category: findings.category, severity: findings.severity, confidence: findings.confidence, duplicates: duplicateEvidence.candidates.length } },
  });
  log({ agent: A2, step: 'risk_assessment_started', status: 'info', message: 'Risk assessment started' });
  log({
    agent: A2,
    step: 'evidence_considered',
    status: 'info',
    message: `Evidence received: ${findings.category.replace(/_/g, ' ')}, ${findings.severity} severity, ${findings.safety_hazards.length} hazard(s), ${duplicateEvidence.candidates.length} duplicate candidate(s)`,
  });

  let a2;
  try {
    a2 = await attemptAgent(A2, log, () => runActionPrioritisationAgent({ client, input: { report, findings, duplicateEvidence }, log }));
  } catch (err) {
    return partialWorkflow({ runId, reportId, log, findings, err, model: client.model });
  }
  const { assessment } = a2;
  await saveResult(runId, reportId, A2, assessment);
  log({ agent: A2, step: 'priority_assigned', status: 'success', message: `Priority assigned: ${assessment.priority} (safety risk: ${assessment.safety_risk})`, data: { priority: assessment.priority, urgent: assessment.urgent } });
  log({ agent: A2, step: 'department_recommended', status: 'success', message: `Department recommended: ${assessment.department}` });
  log({ agent: A2, step: 'action_suggested', status: 'success', message: `Next action suggested: ${assessment.recommended_action}` });

  // ---------- Orchestrator validation & guardrails ----------
  const decision = applyGuardrails(findings, assessment, duplicateEvidence, log);

  await updateReport(reportId, {
    priority: decision.priority,
    department: decision.department,
    recommended_action: decision.recommended_action,
    priority_explanation: decision.explanation,
    needs_human_review: decision.needs_human_review ? 1 : 0,
    review_reasons: decision.review_reasons,
    analysis_status: 'completed',
  });

  log({
    agent: ORCH,
    step: 'final_decision',
    status: 'success',
    message: `Final decision: ${decision.priority} priority → ${decision.department}${decision.needs_human_review ? ' · flagged for human review' : ''}`,
    data: decision,
  });
  await log.flush();
  await finishRun(runId, { model: client.model, status: 'completed', finalDecision: decision });
  return { runId, status: 'completed', decision };
}

async function attemptAgent(agent, log, fn) {
  let lastErr;
  for (let attempt = 1; attempt <= AGENT_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      log({ agent, step: 'agent_error', status: 'error', message: `Attempt ${attempt}/${AGENT_ATTEMPTS} failed: ${err.message}` });
    }
  }
  throw lastErr;
}

/** Cross-check Agent 1's duplicate claims against what the tools actually retrieved; attach backend metrics. */
export async function buildDuplicateEvidence(report, image, a1, log) {
  const retrievedById = new Map(a1.retrieved.map((r) => [r.id, r]));
  const hashes = await getImageHashes([...retrievedById.keys()]);
  const droppedIds = [];
  const candidates = [];
  for (const d of a1.findings.duplicates) {
    const c = retrievedById.get(d.report_id);
    if (!c || d.report_id === report.id) {
      droppedIds.push(d.report_id);
      continue;
    }
    candidates.push({
      report_id: c.id,
      reference: c.reference,
      category: c.category,
      likelihood: d.likelihood,
      reason: d.reason,
      distance_m: Math.round(haversineMeters(report.latitude, report.longitude, c.latitude, c.longitude) * 10) / 10,
      image_similarity: hashSimilarity(image?.image_hash, hashes[c.id]),
      text_similarity: jaccard(report.citizen_description, `${c.citizen_description} ${c.ai_description || ''}`),
      is_demo_record: c.is_demo,
    });
  }
  if (droppedIds.length) {
    log({ agent: ORCH, step: 'validation', status: 'warning', message: `Discarded ${droppedIds.length} duplicate claim(s) not backed by database results`, data: { droppedIds } });
  } else {
    log({ agent: ORCH, step: 'validation', status: 'success', message: 'Agent 1 output validated: schema OK, all duplicate claims backed by database results' });
  }
  return { retrieved_count: a1.retrieved.length, candidates, droppedIds };
}

const raise = (p, min) => (PRIORITIES.indexOf(p) < PRIORITIES.indexOf(min) ? min : p);

export function applyGuardrails(findings, assessment, duplicateEvidence, log) {
  const reasons = new Set(assessment.review_reasons || []);
  // Add an orchestrator reason only if the agent has not already given an equivalent one.
  const addReason = (pattern, text) => {
    if (![...reasons].some((r) => pattern.test(r))) reasons.add(text);
  };
  let { priority, department } = assessment;
  const adjustments = [];

  if (!findings.is_civic_issue || findings.category === 'not_civic_issue') {
    addReason(/civic issue|not civic|irrelevant/i, 'Image does not appear to show a civic issue');
    if (priority !== 'Low') adjustments.push(`Priority lowered from ${priority} to Low (not a civic issue)`);
    priority = 'Low';
  }
  if (findings.image_assessment !== 'clear') addReason(/unclear|irrelevant|image/i, `Image assessed as ${findings.image_assessment}`);
  if (findings.confidence < config.reviewConfidenceThreshold) addReason(/confidence/i, `Confidence ${Math.round(findings.confidence * 100)}% below review threshold`);
  if (findings.description_matches_image === false) addReason(/match|contradict/i, 'Citizen description does not match the photograph');
  if (findings.severity === 'critical' && findings.is_civic_issue) {
    const before = priority;
    priority = raise(priority, 'High');
    if (before !== priority) adjustments.push(`Priority raised from ${before} to ${priority} (critical severity)`);
  }
  if (priority === 'Critical') addReason(/critical/i, 'Critical priority — human confirmation recommended before dispatch');
  const potential = duplicateEvidence.candidates.filter((c) => c.likelihood !== 'unlikely').length;
  if (potential) addReason(/duplicate/i, `${potential} potential duplicate(s) need confirmation`);

  const expected = CATEGORY_DEFAULT_DEPARTMENT[findings.category];
  if (expected && expected !== department && findings.category !== 'other') {
    log({ agent: ORCH, step: 'validation', status: 'warning', message: `Department "${department}" differs from usual "${expected}" for ${findings.category}; kept AI recommendation and flagged for review` });
    reasons.add(`Department differs from the usual routing (${expected})`);
  }
  for (const a of adjustments) log({ agent: ORCH, step: 'guardrail', status: 'warning', message: a });
  if (!adjustments.length) log({ agent: ORCH, step: 'validation', status: 'success', message: 'Agent 2 output validated: priority and department consistent with evidence' });

  const needsReview = assessment.needs_human_review || reasons.size > 0;
  return {
    priority,
    department,
    recommended_action: assessment.recommended_action,
    explanation: assessment.explanation + (adjustments.length ? ` [Orchestrator: ${adjustments.join('; ')}]` : ''),
    safety_risk: assessment.safety_risk,
    urgent: assessment.urgent || priority === 'Critical',
    risk_factors: assessment.risk_factors,
    evidence_considered: assessment.evidence_considered,
    needs_human_review: needsReview,
    review_reasons: [...reasons],
    adjustments,
    category: findings.category,
    severity: findings.severity,
    confidence: findings.confidence,
  };
}

async function failWorkflow({ runId, reportId, log, stage, err, model }) {
  const message = `${stage === A1 ? A1_NAME : A2_NAME} failed: ${err.message}`;
  log({ agent: ORCH, step: 'workflow_failed', status: 'error', message: `${message}. Report saved and queued for manual review.` });
  await updateReport(reportId, {
    analysis_status: 'failed',
    needs_human_review: 1,
    review_reasons: ['Automated AI analysis failed — manual triage required'],
  });
  await log.flush();
  await finishRun(runId, { model, status: 'failed', error: message.slice(0, 500) });
  return { runId, status: 'failed', error: message };
}

/** Agent 2 failed: keep Agent 1 results, apply transparent rule-based routing, require human review. */
async function partialWorkflow({ runId, reportId, log, findings, err, model }) {
  const department = CATEGORY_DEFAULT_DEPARTMENT[findings.category] || 'Other';
  const decision = {
    priority: null,
    department,
    recommended_action: 'Prioritisation agent unavailable — a human reviewer should assign priority.',
    explanation: `Prioritisation agent failed (${err.message}). Department suggested by rule-based category routing; priority left unassigned.`,
    needs_human_review: true,
    review_reasons: ['Prioritisation agent failed — manual priority assignment required'],
  };
  log({ agent: ORCH, step: 'fallback', status: 'warning', message: `Agent 2 failed; applied rule-based department routing (${department}) and flagged for human review` });
  await updateReport(reportId, {
    department,
    recommended_action: decision.recommended_action,
    priority_explanation: decision.explanation,
    needs_human_review: 1,
    review_reasons: decision.review_reasons,
    analysis_status: 'partial',
  });
  await log.flush();
  await finishRun(runId, { model, status: 'partial', error: err.message.slice(0, 500), finalDecision: decision });
  return { runId, status: 'partial', decision };
}
