/**
 * DEVELOPMENT MODE — deterministic sample responses. NOT Google Gemini.
 *
 * Used when GEMINI_API_KEY is not configured (or AI_MODE=development). It implements the same
 * generateContent() function-calling protocol as Gemini so the real agent loops, backend tools,
 * validation, orchestration and logging all run end-to-end. Its "reasoning" is a transparent
 * keyword heuristic over the citizen's description; it does NOT look at the photograph.
 * Every output is labelled "[Development mode]".
 */

const KEYWORDS = [
  ['not_civic_issue', /\b(selfie|my cat|my dog|pet|food|meme|screenshot|birthday|test photo)\b/i],
  ['open_drain', /\b(drain|sewer|sewage|gutter|manhole|nala|nallah|overflowing drain)\b/i],
  ['water_leakage', /\b(leak|leakage|leaking|pipeline|pipe burst|burst pipe|burst|water wast|tap)\b/i],
  ['broken_streetlight', /\b(street ?light|lamp ?post|lamp|light (is )?not working|lights? off|dark street|pole light)\b/i],
  ['garbage', /\b(garbage|trash|waste|litter|dump|dumping|rubbish|kachra|bin overflow|plastic)\b/i],
  ['pothole', /\b(pothole|potholes|crater|road damage|broken road|damaged road|pit in (the )?road)\b/i],
  ['damaged_infrastructure', /\b(broken|damaged|collapsed|crack|footpath|bridge|wall|signage|divider|railing|bench)\b/i],
];
const SEVERE = /\b(deep|huge|large|dangerous|accident|injur|children|school|hospital|exposed wire|live wire|open manhole|collapsed|flood|electrocut)\b/gi;
const CRITICAL = /\b(accident|injur|exposed wire|live wire|open manhole|electrocut|collapsed)\b/i;

const DEPT = {
  pothole: 'Roads and Infrastructure',
  damaged_infrastructure: 'Roads and Infrastructure',
  garbage: 'Sanitation',
  broken_streetlight: 'Electricity',
  water_leakage: 'Water Supply',
  open_drain: 'Drainage',
  other: 'Other',
  not_civic_issue: 'Other',
};
const PRIORITY_BY_SEVERITY = { low: 'Low', moderate: 'Medium', high: 'High', critical: 'Critical' };
const ORDER = ['Low', 'Medium', 'High', 'Critical'];

function extractJson(contents, marker) {
  for (const c of contents) {
    for (const p of c.parts || []) {
      if (typeof p.text === 'string' && p.text.includes(marker)) {
        const start = p.text.indexOf(marker) + marker.length;
        const end = p.text.indexOf('\n', start);
        try {
          return JSON.parse(p.text.slice(start, end === -1 ? undefined : end));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function toolResponses(contents) {
  const out = {};
  for (const c of contents) {
    if (c.role !== 'user') continue;
    for (const p of c.parts || []) if (p.functionResponse) out[p.functionResponse.name] = p.functionResponse.response;
  }
  return out;
}

let counter = 0;
const call = (name, args) => {
  const fc = { id: `dev-${++counter}`, name, args };
  return { functionCalls: [fc], candidates: [{ content: { role: 'model', parts: [{ functionCall: fc }] }, finishReason: 'STOP' }] };
};

export function classifyDescription(text = '') {
  const match = KEYWORDS.find(([, re]) => re.test(text));
  const category = match ? match[0] : 'other';
  const severeHits = (text.match(SEVERE) || []).length;
  let severity = 'moderate';
  if (category === 'not_civic_issue') severity = 'low';
  else if (CRITICAL.test(text) && severeHits >= 2) severity = 'critical';
  else if (severeHits >= 1) severity = 'high';
  else if (/\b(small|minor|slight)\b/i.test(text)) severity = 'low';
  return { category, severity, matched: Boolean(match) };
}

function agent1(contents) {
  const ctx = extractJson(contents, 'REPORT_CONTEXT=') || {};
  const responses = toolResponses(contents);
  const search = responses.search_nearby_reports;
  if (!search) return call('search_nearby_reports', { radius_m: ctx.recommended_search_radius_m || 75 });

  const text = ctx.citizen_description || '';
  const { category, severity, matched } = classifyDescription(text);
  const ids = (search.reports || []).map((r) => r.report_id);
  const compare = responses.compare_candidates;
  if (ids.length && !compare) return call('compare_candidates', { candidate_ids: ids });

  const notCivic = category === 'not_civic_issue';
  const duplicates = [];
  for (const c of compare?.comparisons || []) {
    const sameCat = c.category === category;
    const img = c.image_similarity ?? 0;
    if (notCivic || !matched) continue;
    if (sameCat && (c.distance_m <= 25 || img >= 0.88)) duplicates.push({ report_id: c.report_id, likelihood: 'likely', reason: `[Development mode] Same category (${category}) ${c.distance_m} m away; image similarity ${c.image_similarity ?? 'n/a'}.` });
    else if (sameCat || img >= 0.88 || c.text_similarity >= 0.35) duplicates.push({ report_id: c.report_id, likelihood: 'possible', reason: `[Development mode] ${sameCat ? 'Same category' : 'Different category'} ${c.distance_m} m away; text similarity ${c.text_similarity}.` });
  }

  const label = category.replace(/_/g, ' ');
  return call('submit_findings', {
    is_civic_issue: !notCivic,
    image_assessment: notCivic ? 'irrelevant' : matched ? 'clear' : 'unclear',
    category,
    description: matched
      ? `[Development mode] Report classified as ${label} from the citizen's description: "${text.slice(0, 160)}". The photograph was not analysed by an AI model in development mode.`
      : `[Development mode] The citizen's description did not identify a recognisable civic issue, so the report cannot be classified reliably. The photograph was not analysed by an AI model in development mode.`,
    severity: matched ? severity : 'low',
    confidence: notCivic ? 0.75 : matched ? 0.7 : 0.3,
    visual_evidence: ['Development mode: no visual analysis performed'],
    safety_hazards: severity === 'critical' || severity === 'high' ? ['Hazard keywords present in citizen description'] : [],
    unclear_reason: matched ? null : 'Development mode heuristic could not identify the issue from the description.',
    description_matches_image: null,
    duplicates,
    duplicate_summary: duplicates.length
      ? `[Development mode] ${duplicates.length} nearby report(s) look like potential duplicates based on backend distance and similarity measurements.`
      : `[Development mode] ${search.count} nearby report(s) found within ${search.radius_m} m; none appear to be duplicates.`,
  });
}

function agent2(contents) {
  const ev = extractJson(contents, 'EVIDENCE=') || {};
  const responses = toolResponses(contents);
  if (!responses.get_priority_policy) return call('get_priority_policy', {});
  if (!responses.get_area_backlog) return call('get_area_backlog', { radius_m: 500 });

  const f = ev.agent1_findings || {};
  const dups = (ev.duplicate_evidence?.candidates || []).filter((d) => d.likelihood !== 'unlikely').length;
  let priority = PRIORITY_BY_SEVERITY[f.severity] || 'Medium';
  const reasons = [];
  if (dups >= 2 && priority !== 'Critical') {
    priority = ORDER[ORDER.indexOf(priority) + 1];
    reasons.push(`${dups} nearby duplicate complaints increase community impact`);
  }
  if (!f.is_civic_issue) priority = 'Low';
  const review = [];
  if (!f.is_civic_issue) review.push('Image does not appear to show a civic issue');
  if (f.image_assessment !== 'clear') review.push('Image is unclear');
  if ((f.confidence ?? 0) < (ev.review_confidence_threshold ?? 0.6)) review.push('Low analysis confidence');
  if (priority === 'Critical') review.push('Critical priority requires human confirmation before dispatch');
  if (dups) review.push('Possible duplicates need confirmation');

  return call('submit_assessment', {
    priority,
    department: DEPT[f.category] || 'Other',
    safety_risk: { Low: 'low', Medium: 'moderate', High: 'high', Critical: 'severe' }[priority],
    recommended_action: f.is_civic_issue
      ? `[Development mode] Recommend that the ${DEPT[f.category] || 'Other'} team inspect the site and schedule repair according to ${priority} priority.`
      : '[Development mode] Recommend a human reviewer verifies the submission before any action is taken.',
    explanation: `[Development mode] Rule-based sample: severity "${f.severity}" maps to ${PRIORITY_BY_SEVERITY[f.severity] || 'Medium'} priority${reasons.length ? `; ${reasons.join('; ')}` : ''}. Area backlog: ${responses.get_area_backlog.open_reports} open report(s) nearby.`,
    risk_factors: f.safety_hazards || [],
    evidence_considered: ['Agent 1 category and severity', `Duplicate candidates: ${dups}`, 'Municipal priority policy', 'Area backlog'],
    urgent: priority === 'Critical' || priority === 'High',
    needs_human_review: review.length > 0,
    review_reasons: review,
  });
}

export function createDevelopmentClient() {
  return {
    mode: 'development',
    model: 'development-sample-responses',
    async generateContent({ contents, config }) {
      const names = (config?.tools?.[0]?.functionDeclarations || []).map((d) => d.name);
      await new Promise((r) => setTimeout(r, process.env.VITEST ? 0 : 350)); // make the live workflow observable
      if (names.includes('submit_findings')) return agent1(contents);
      if (names.includes('submit_assessment')) return agent2(contents);
      throw new Error('Development model: unknown agent');
    },
  };
}
