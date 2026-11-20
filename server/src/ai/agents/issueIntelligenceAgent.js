import { Type } from '@google/genai';
import { CATEGORIES, IMAGE_ASSESSMENTS, SEVERITIES, DUPLICATE_LIKELIHOODS, CATEGORY_LABELS } from '../../config/domain.js';
import { config } from '../../config/index.js';
import { findNearbyReports, getImageHashes } from '../../models/reportModel.js';
import { haversineMeters } from '../../services/geo.js';
import { hashSimilarity } from '../../services/imageService.js';
import { jaccard } from '../../services/textSimilarity.js';
import { runAgentLoop } from '../agentRunner.js';
import { IssueFindingsSchema } from '../schemas.js';

export const AGENT_ID = 'intelligence';
export const AGENT_NAME = 'Civic Issue Intelligence Agent';

const SYSTEM_INSTRUCTION = `You are the ${AGENT_NAME} for CivicLens, a civic issue platform for Tier 2 and Tier 3 cities in India.

Your job for each citizen report:
1. Look carefully at the attached photograph together with the citizen's description.
2. Decide whether it shows a genuine civic maintenance issue. Classify it as exactly one category:
   ${CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(', ')}.
   Use "not_civic_issue" for selfies, pets, food, screenshots, indoor/private scenes or anything irrelevant.
3. Judge image quality: "clear", "unclear" (blurry, too dark, too far, ambiguous) or "irrelevant".
4. Write a factual description (2-4 sentences) of what is visible. Do not speculate beyond the evidence.
5. Estimate severity (low, moderate, high, critical) and a calibrated confidence between 0 and 1.
   Lower your confidence when the image is unclear or the description contradicts the photo.
6. Duplicate detection — you MUST use the backend tools:
   a. Call search_nearby_reports to retrieve existing reports near the citizen's location from the database.
   b. If any are returned, call compare_candidates with their report_ids to get deterministic distance,
      image-similarity and text-similarity measurements.
   c. Judge each candidate as "likely", "possible" or "unlikely" duplicate using category, distance, similarity
      and description. Only include candidates returned by the tools. Never invent report ids or distances.
7. Finish by calling submit_findings exactly once with your structured findings.

Rules: In descriptions and summaries, refer to other reports by their reference (e.g. CL-AB12CD), never by report_id.
Never claim any department has been notified. Never fabricate database results. If no nearby reports are
returned, state that no duplicates were found.`;

const toolDeclarations = {
  search_nearby_reports: {
    name: 'search_nearby_reports',
    description:
      "Query the CivicLens database for existing reports near the citizen's submitted coordinates. Distances are computed by the backend with the haversine formula. Coordinates are fixed to the current report and cannot be changed.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        radius_m: { type: Type.NUMBER, description: `Search radius in metres (10-${config.duplicates.maxRadiusMeters}). Recommended ${config.duplicates.defaultRadiusMeters}.` },
        category: { type: Type.STRING, enum: CATEGORIES, description: 'Optional: only return reports already classified in this category.' },
      },
      required: ['radius_m'],
    },
  },
  compare_candidates: {
    name: 'compare_candidates',
    description:
      'Deterministically compare the new report with candidate reports returned by search_nearby_reports. Returns exact distance in metres, perceptual image similarity (0-1, from image hashes) and description text similarity (0-1).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        candidate_ids: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: 'report_id values from search_nearby_reports.' },
      },
      required: ['candidate_ids'],
    },
  },
};

const finalDeclaration = {
  name: 'submit_findings',
  description: 'Submit the final structured findings to the orchestrator. Call exactly once when analysis is complete.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      is_civic_issue: { type: Type.BOOLEAN },
      image_assessment: { type: Type.STRING, enum: IMAGE_ASSESSMENTS },
      category: { type: Type.STRING, enum: CATEGORIES },
      description: { type: Type.STRING, description: 'Factual 2-4 sentence description of what the photograph shows.' },
      severity: { type: Type.STRING, enum: SEVERITIES },
      confidence: { type: Type.NUMBER, description: 'Calibrated confidence 0-1 in the category and severity.' },
      visual_evidence: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Concrete visual observations supporting the classification.' },
      safety_hazards: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Safety hazards visible or described (empty if none).' },
      unclear_reason: { type: Type.STRING, description: 'Why the image is unclear/irrelevant, if applicable.' },
      description_matches_image: { type: Type.BOOLEAN, description: "Whether the citizen's text is consistent with the photo." },
      duplicates: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            report_id: { type: Type.INTEGER },
            likelihood: { type: Type.STRING, enum: DUPLICATE_LIKELIHOODS },
            reason: { type: Type.STRING },
          },
          required: ['report_id', 'likelihood', 'reason'],
        },
      },
      duplicate_summary: { type: Type.STRING, description: 'One or two sentences explaining the duplicate detection outcome.' },
    },
    required: ['is_civic_issue', 'image_assessment', 'category', 'description', 'severity', 'confidence', 'duplicates', 'duplicate_summary'],
  },
};

/**
 * Run Agent 1.
 * @param {object} input { report, imageBase64, imageMimeType, imageHash }
 */
export async function runIssueIntelligenceAgent({ client, input, log }) {
  const { report, imageBase64, imageMimeType, imageHash } = input;
  const retrieved = new Map(); // report_id -> candidate row (from real DB search)

  const tools = {
    search_nearby_reports: {
      declaration: toolDeclarations.search_nearby_reports,
      handler: ({ radius_m, category }) => {
        const radius = Math.min(Math.max(Number(radius_m) || config.duplicates.defaultRadiusMeters, 10), config.duplicates.maxRadiusMeters);
        const rows = findNearbyReports({
          latitude: report.latitude,
          longitude: report.longitude,
          radiusM: radius,
          excludeId: report.id,
          category: CATEGORIES.includes(category) ? category : undefined,
          lookbackDays: config.duplicates.lookbackDays,
        }).slice(0, 10);
        for (const r of rows) retrieved.set(r.id, r);
        return {
          radius_m: radius,
          origin: { latitude: report.latitude, longitude: report.longitude },
          count: rows.length,
          reports: rows.map((r) => ({
            report_id: r.id,
            reference: r.reference,
            category: r.category,
            description: (r.ai_description || r.citizen_description || '').slice(0, 300),
            distance_m: r.distance_m,
            status: r.status,
            priority: r.priority,
            days_ago: Math.max(0, Math.round((Date.now() - new Date(r.created_at)) / 86400000)),
            is_demo_record: r.is_demo,
          })),
        };
      },
      summarise: (res) => `Database returned ${res.count} report(s) within ${res.radius_m} m`,
    },
    compare_candidates: {
      declaration: toolDeclarations.compare_candidates,
      handler: ({ candidate_ids }) => {
        const ids = (Array.isArray(candidate_ids) ? candidate_ids : []).map(Number).filter((id) => retrieved.has(id)).slice(0, 10);
        const rejected = (candidate_ids || []).map(Number).filter((id) => !retrieved.has(id));
        const hashes = getImageHashes(ids);
        return {
          comparisons: ids.map((id) => {
            const c = retrieved.get(id);
            return {
              report_id: id,
              reference: c.reference,
              category: c.category,
              distance_m: Math.round(haversineMeters(report.latitude, report.longitude, c.latitude, c.longitude) * 10) / 10,
              image_similarity: hashSimilarity(imageHash, hashes[id]),
              text_similarity: jaccard(report.citizen_description, `${c.citizen_description} ${c.ai_description || ''}`),
            };
          }),
          ...(rejected.length ? { ignored_ids: rejected, note: 'Only ids returned by search_nearby_reports can be compared.' } : {}),
        };
      },
      summarise: (res) => `Compared ${res.comparisons.length} candidate(s) using distance, image hash and text similarity`,
    },
  };

  const contextBlock = {
    report_id: report.id,
    citizen_description: report.citizen_description || '(none provided)',
    latitude: report.latitude,
    longitude: report.longitude,
    area: report.area || 'unknown',
    recommended_search_radius_m: config.duplicates.defaultRadiusMeters,
  };

  const userParts = [
    { text: `New citizen report. REPORT_CONTEXT=${JSON.stringify(contextBlock)}\nAnalyse the attached photograph, check for duplicates with the tools, then call submit_findings.` },
    { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
  ];

  const { output, toolCalls, turns } = await runAgentLoop({
    client,
    agent: AGENT_ID,
    systemInstruction: SYSTEM_INSTRUCTION,
    userParts,
    tools,
    finalTool: { declaration: finalDeclaration },
    finalSchema: IssueFindingsSchema,
    requiredTools: ['search_nearby_reports'],
    log,
  });

  return { findings: output, retrieved: [...retrieved.values()], toolCalls, turns, imageHash };
}
