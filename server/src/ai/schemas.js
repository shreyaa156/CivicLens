import { z } from 'zod';
import { CATEGORIES, SEVERITIES, PRIORITIES, IMAGE_ASSESSMENTS, DUPLICATE_LIKELIHOODS, DEPARTMENT_NAMES } from '../config/domain.js';

const lowerEnum = (values) => z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(values));
const titleEnum = (values) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const match = values.find((x) => x.toLowerCase() === v.trim().toLowerCase());
    return match ?? v;
  }, z.enum(values));
const strList = (max = 8) => z.array(z.string().trim().min(1).max(300)).max(max).default([]);

/** Agent 1 — Civic Issue Intelligence: final structured findings. */
export const IssueFindingsSchema = z.object({
  is_civic_issue: z.boolean(),
  image_assessment: lowerEnum(IMAGE_ASSESSMENTS),
  category: lowerEnum(CATEGORIES),
  description: z.string().trim().min(10).max(1200),
  severity: lowerEnum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  visual_evidence: strList(),
  safety_hazards: strList(),
  unclear_reason: z.string().max(500).optional().nullable(),
  description_matches_image: z.boolean().optional().nullable(),
  duplicates: z
    .array(
      z.object({
        report_id: z.number().int().positive(),
        likelihood: lowerEnum(DUPLICATE_LIKELIHOODS),
        reason: z.string().trim().min(3).max(600),
      }),
    )
    .max(10)
    .default([]),
  duplicate_summary: z.string().trim().min(3).max(800),
});

/** Agent 2 — Civic Action & Prioritisation: final structured assessment. */
export const ActionAssessmentSchema = z.object({
  priority: titleEnum(PRIORITIES),
  department: titleEnum(DEPARTMENT_NAMES),
  safety_risk: lowerEnum(['none', 'low', 'moderate', 'high', 'severe']),
  recommended_action: z.string().trim().min(10).max(800),
  explanation: z.string().trim().min(20).max(1500),
  risk_factors: strList(),
  evidence_considered: strList(10),
  urgent: z.boolean(),
  needs_human_review: z.boolean(),
  review_reasons: strList(),
});
