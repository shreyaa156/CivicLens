import { Type } from '@google/genai';
import { PRIORITIES, DEPARTMENTS, DEPARTMENT_NAMES, PRIORITY_POLICY, OPEN_STATUSES } from '../../config/domain.js';
import { config } from '../../config/index.js';
import { findNearbyReports } from '../../models/reportModel.js';
import { runAgentLoop } from '../agentRunner.js';
import { ActionAssessmentSchema } from '../schemas.js';

export const AGENT_ID = 'action';
export const AGENT_NAME = 'Civic Action & Prioritisation Agent';

const SYSTEM_INSTRUCTION = `You are the ${AGENT_NAME} for CivicLens, serving municipal corporations in Tier 2 and Tier 3 Indian cities.

You receive validated findings from the Civic Issue Intelligence Agent (issue category, description, severity,
confidence, safety hazards and duplicate evidence computed from the database). Your job:
1. Call get_priority_policy to read the municipal prioritisation rubric (required).
2. Call get_department_directory to see department responsibilities.
3. Optionally call get_area_backlog to see how many open issues already exist nearby.
4. Assess safety risk, consider the number of independent duplicate/nearby complaints, and assign one priority:
   Low, Medium, High or Critical.
5. Recommend exactly one department and a concrete next action for municipal staff (e.g. "Dispatch road crew to
   barricade and patch the pothole"). Phrase it as a recommendation — never claim a department has been notified,
   received or acted on anything.
6. Explain your decision clearly, citing the evidence you considered.
7. Set needs_human_review=true with reasons when the case is uncertain, Critical, contradictory, low-confidence,
   not a civic issue, or has possible duplicates to confirm.
Finish by calling submit_assessment exactly once.`;

const declarations = {
  get_priority_policy: {
    name: 'get_priority_policy',
    description: 'Returns the municipal priority rubric, escalation factors and human-review rules.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  get_department_directory: {
    name: 'get_department_directory',
    description: 'Returns the list of municipal departments and their responsibilities.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  get_area_backlog: {
    name: 'get_area_backlog',
    description: 'Counts open (unresolved) reports near this location from the database, grouped by category and priority.',
    parameters: {
      type: Type.OBJECT,
      properties: { radius_m: { type: Type.NUMBER, description: 'Radius in metres (50-2000). Recommended 500.' } },
      required: ['radius_m'],
    },
  },
};

const finalDeclaration = {
  name: 'submit_assessment',
  description: 'Submit the final prioritisation and routing recommendation to the orchestrator.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      priority: { type: Type.STRING, enum: PRIORITIES },
      department: { type: Type.STRING, enum: DEPARTMENT_NAMES },
      safety_risk: { type: Type.STRING, enum: ['none', 'low', 'moderate', 'high', 'severe'] },
      recommended_action: { type: Type.STRING, description: 'Concrete next step recommended for municipal staff.' },
      explanation: { type: Type.STRING, description: 'Why this priority and department were chosen, citing evidence.' },
      risk_factors: { type: Type.ARRAY, items: { type: Type.STRING } },
      evidence_considered: { type: Type.ARRAY, items: { type: Type.STRING } },
      urgent: { type: Type.BOOLEAN },
      needs_human_review: { type: Type.BOOLEAN },
      review_reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['priority', 'department', 'safety_risk', 'recommended_action', 'explanation', 'urgent', 'needs_human_review'],
  },
};

/**
 * Run Agent 2.
 * @param {object} input { report, findings, duplicateEvidence }
 */
export async function runActionPrioritisationAgent({ client, input, log }) {
  const { report, findings, duplicateEvidence } = input;

  const tools = {
    get_priority_policy: {
      declaration: declarations.get_priority_policy,
      handler: () => ({ ...PRIORITY_POLICY, review_confidence_threshold: config.reviewConfidenceThreshold }),
      summarise: () => 'Loaded municipal priority rubric and review rules',
    },
    get_department_directory: {
      declaration: declarations.get_department_directory,
      handler: () => ({ departments: Object.entries(DEPARTMENTS).map(([name, handles]) => ({ name, handles })) }),
      summarise: (r) => `Loaded ${r.departments.length} departments`,
    },
    get_area_backlog: {
      declaration: declarations.get_area_backlog,
      handler: ({ radius_m }) => {
        const radius = Math.min(Math.max(Number(radius_m) || 500, 50), 2000);
        const rows = findNearbyReports({ latitude: report.latitude, longitude: report.longitude, radiusM: radius, excludeId: report.id }).filter((r) =>
          OPEN_STATUSES.includes(r.status),
        );
        const byCategory = {};
        const byPriority = {};
        for (const r of rows) {
          byCategory[r.category || 'unclassified'] = (byCategory[r.category || 'unclassified'] || 0) + 1;
          byPriority[r.priority || 'unassigned'] = (byPriority[r.priority || 'unassigned'] || 0) + 1;
        }
        return { radius_m: radius, open_reports: rows.length, by_category: byCategory, by_priority: byPriority, same_category_open: byCategory[findings.category] || 0 };
      },
      summarise: (r) => `${r.open_reports} open report(s) within ${r.radius_m} m (${r.same_category_open} same category)`,
    },
  };

  const evidence = {
    report_id: report.id,
    area: report.area || 'unknown',
    citizen_description: report.citizen_description || '(none provided)',
    agent1_findings: {
      is_civic_issue: findings.is_civic_issue,
      category: findings.category,
      description: findings.description,
      severity: findings.severity,
      confidence: findings.confidence,
      image_assessment: findings.image_assessment,
      safety_hazards: findings.safety_hazards,
      visual_evidence: findings.visual_evidence,
      description_matches_image: findings.description_matches_image ?? null,
      unclear_reason: findings.unclear_reason ?? null,
    },
    duplicate_evidence: duplicateEvidence,
    review_confidence_threshold: config.reviewConfidenceThreshold,
  };

  const { output, toolCalls, turns } = await runAgentLoop({
    client,
    agent: AGENT_ID,
    systemInstruction: SYSTEM_INSTRUCTION,
    userParts: [{ text: `Handoff from the Civic Issue Intelligence Agent. EVIDENCE=${JSON.stringify(evidence)}\nAssess risk, then call submit_assessment.` }],
    tools,
    finalTool: { declaration: finalDeclaration },
    finalSchema: ActionAssessmentSchema,
    requiredTools: ['get_priority_policy'],
    log,
  });

  return { assessment: output, toolCalls, turns };
}
