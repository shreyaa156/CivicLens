import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { onTestFinished } from 'vitest';

const RESULTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '.results', 'results.jsonl');

/**
 * Record a test-report row (ID, scenario, input, expected, actual, pass/fail).
 * Set `.actual` during the test; pass/fail is taken from the real test outcome.
 */
export function record({ id, scenario, input, expected }) {
  const row = { id, scenario, input, expected, actual: '(not recorded)' };
  onTestFinished(({ task }) => {
    const state = task.result?.state;
    const err = task.result?.errors?.[0]?.message;
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.appendFileSync(RESULTS, JSON.stringify({ ...row, result: state === 'pass' ? 'PASS' : 'FAIL', error: err || null }) + '\n');
  });
  return row;
}

/** Generate a real JPEG. `seed` changes the pattern so different seeds give different perceptual hashes. */
export async function makeImage({ seed = 1, width = 320, height = 240 } = {}) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const v = Math.floor(127 + 127 * Math.sin((x * seed) / 23 + (y * (seed % 5 + 1)) / 31));
      buf[i] = v;
      buf[i + 1] = (v * seed) % 256;
      buf[i + 2] = 255 - v;
    }
  }
  return sharp(buf, { raw: { width, height, channels } }).jpeg().toBuffer();
}

// ---------------------------------------------------------------------------
// Mocked Gemini: a scripted model client that speaks the Gemini function-calling
// protocol (response.functionCalls + candidates[0].content). Used so automated
// tests are deterministic; the real agents, tools, DB and orchestrator all run.
// ---------------------------------------------------------------------------

let n = 0;
export function fnCall(name, args) {
  const fc = { id: `mock-${++n}`, name, args };
  return { functionCalls: [fc], candidates: [{ content: { role: 'model', parts: [{ functionCall: fc }] }, finishReason: 'STOP' }] };
}

function responses(contents) {
  const out = {};
  for (const c of contents) for (const p of c.parts || []) if (p.functionResponse) out[p.functionResponse.name] = p.functionResponse.response;
  return out;
}

export function parseMarker(contents, marker) {
  for (const c of contents)
    for (const p of c.parts || [])
      if (p.text?.includes(marker)) {
        const s = p.text.indexOf(marker) + marker.length;
        const e = p.text.indexOf('\n', s);
        return JSON.parse(p.text.slice(s, e === -1 ? undefined : e));
      }
  return null;
}

/**
 * A well-behaved mocked Gemini.
 *  findings:   object (Agent 1 submit_findings args) or fn({ search, compare, contents }) -> args
 *  assessment: object (Agent 2 submit_assessment args) or fn(evidence) -> args
 *  radius:     radius the "model" asks for
 *  agent2:     optional custom generator fn(contents, state) -> response (overrides default)
 */
export function mockGemini({ findings, assessment, radius = 75, agent2, agent1, onCall } = {}) {
  const calls = { agent1: 0, agent2: 0, sawImage: false };
  const client = {
    mode: 'gemini',
    model: 'mock-gemini',
    calls,
    async generateContent({ contents, config }) {
      onCall?.({ contents, config });
      const names = config.tools[0].functionDeclarations.map((d) => d.name);
      if (names.includes('submit_findings')) {
        calls.agent1++;
        if (contents[0].parts.some((p) => p.inlineData?.data)) calls.sawImage = true;
        if (agent1) return agent1(contents, calls);
        const r = responses(contents);
        if (!r.search_nearby_reports) return fnCall('search_nearby_reports', { radius_m: radius });
        const ids = r.search_nearby_reports.reports.map((x) => x.report_id);
        if (ids.length && !r.compare_candidates) return fnCall('compare_candidates', { candidate_ids: ids });
        const args = typeof findings === 'function' ? findings({ search: r.search_nearby_reports, compare: r.compare_candidates, contents }) : findings;
        return fnCall('submit_findings', args);
      }
      calls.agent2++;
      if (agent2) return agent2(contents, calls);
      const r = responses(contents);
      if (!r.get_priority_policy) return fnCall('get_priority_policy', {});
      const evidence = parseMarker(contents, 'EVIDENCE=');
      return fnCall('submit_assessment', typeof assessment === 'function' ? assessment(evidence) : assessment);
    },
  };
  return client;
}

export const baseFindings = (over = {}) => ({
  is_civic_issue: true,
  image_assessment: 'clear',
  category: 'pothole',
  description: 'A large pothole in the asphalt road surface with exposed gravel.',
  severity: 'moderate',
  confidence: 0.9,
  visual_evidence: ['Broken asphalt'],
  safety_hazards: [],
  description_matches_image: true,
  duplicates: [],
  duplicate_summary: 'No nearby reports found.',
  ...over,
});

export const baseAssessment = (over = {}) => ({
  priority: 'Medium',
  department: 'Roads and Infrastructure',
  safety_risk: 'moderate',
  recommended_action: 'Inspect the site and schedule a road patch repair.',
  explanation: 'Moderate severity pothole on a local road with no nearby duplicates.',
  risk_factors: [],
  evidence_considered: ['Agent 1 findings'],
  urgent: false,
  needs_human_review: false,
  review_reasons: [],
  ...over,
});
