import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setModelClientFactory } from '../src/ai/modelClient.js';
import { createDevelopmentClient } from '../src/ai/devModel.js';
import { getRun } from '../src/models/agentModel.js';
import { record, makeImage, mockGemini, baseFindings, baseAssessment } from './helpers.js';

let app;
const BASE = { lat: 20.0, lon: 73.78 };
let lonOffset = 0;
// Each test uses its own distant location so reports don't interfere unless intended.
const freshLocation = () => ({ latitude: BASE.lat, longitude: BASE.lon + (lonOffset += 0.05) });

async function submit({ client, image, description = '', latitude, longitude }) {
  if (client) setModelClientFactory(() => client);
  const res = await request(app)
    .post('/api/reports?wait=true')
    .field('description', description)
    .field('latitude', String(latitude))
    .field('longitude', String(longitude))
    .attach('image', image || (await makeImage()), { filename: 'photo.jpg', contentType: 'image/jpeg' });
  return res;
}

beforeAll(() => {
  app = createApp();
});
afterEach(() => setModelClientFactory(null));

describe('Agent 1 — Civic Issue Intelligence', () => {
  it('TC01 pothole identification', async () => {
    const r = record({ id: 'TC01', scenario: 'Pothole identification', input: 'Road photo + "Big pothole on main road"; mocked Gemini vision classifies pothole', expected: 'category=pothole, image sent to Gemini, department=Roads and Infrastructure, analysis completed' });
    const client = mockGemini({ findings: baseFindings({ category: 'pothole', severity: 'moderate' }), assessment: baseAssessment() });
    const res = await submit({ client, description: 'Big pothole on main road', ...freshLocation() });
    expect(res.status).toBe(201);
    const rep = res.body.report;
    r.actual = `category=${rep.category}, imageSent=${client.calls.sawImage}, department=${rep.department}, status=${rep.analysis_status}`;
    expect(rep.category).toBe('pothole');
    expect(client.calls.sawImage).toBe(true);
    expect(rep.department).toBe('Roads and Infrastructure');
    expect(rep.analysis_status).toBe('completed');
  });

  it('TC02 garbage identification', async () => {
    const r = record({ id: 'TC02', scenario: 'Garbage identification', input: 'Photo of garbage pile; mocked Gemini returns garbage', expected: 'category=garbage, department=Sanitation' });
    const client = mockGemini({
      findings: baseFindings({ category: 'garbage', description: 'A heap of mixed household garbage dumped beside the road.' }),
      assessment: baseAssessment({ department: 'Sanitation', explanation: 'Garbage accumulation on a public street; moderate hygiene risk.' }),
    });
    const res = await submit({ client, description: 'Garbage not collected', ...freshLocation() });
    r.actual = `category=${res.body.report.category}, department=${res.body.report.department}`;
    expect(res.body.report.category).toBe('garbage');
    expect(res.body.report.department).toBe('Sanitation');
  });

  it('TC03 broken streetlight identification', async () => {
    const r = record({ id: 'TC03', scenario: 'Broken streetlight identification', input: 'Photo of unlit streetlight; mocked Gemini returns broken_streetlight', expected: 'category=broken_streetlight, department=Electricity' });
    const client = mockGemini({
      findings: baseFindings({ category: 'broken_streetlight', description: 'A streetlight pole with a broken, unlit lamp head.' }),
      assessment: baseAssessment({ department: 'Electricity', explanation: 'Non-functional streetlight reduces night-time visibility for pedestrians.' }),
    });
    const res = await submit({ client, ...freshLocation() });
    r.actual = `category=${res.body.report.category}, department=${res.body.report.department}`;
    expect(res.body.report.category).toBe('broken_streetlight');
    expect(res.body.report.department).toBe('Electricity');
  });

  it('TC04 non-civic image handling', async () => {
    const r = record({ id: 'TC04', scenario: 'Non-civic image handling', input: 'Selfie photo; Gemini returns not_civic_issue/irrelevant but Agent 2 says Medium', expected: 'priority forced to Low by orchestrator, flagged for human review' });
    const client = mockGemini({
      findings: baseFindings({ is_civic_issue: false, image_assessment: 'irrelevant', category: 'not_civic_issue', severity: 'low', confidence: 0.85, description: 'A close-up selfie of a person indoors; no civic infrastructure visible.' }),
      assessment: baseAssessment({ priority: 'Medium', department: 'Other' }),
    });
    const res = await submit({ client, description: 'my selfie', ...freshLocation() });
    const rep = res.body.report;
    r.actual = `category=${rep.category}, priority=${rep.priority}, review=${rep.needs_human_review}, reasons=${rep.review_reasons.join(' | ')}`;
    expect(rep.category).toBe('not_civic_issue');
    expect(rep.priority).toBe('Low');
    expect(rep.needs_human_review).toBe(true);
    expect(rep.review_reasons.join(' ')).toMatch(/civic issue/i);
  });

  it('TC05 unclear image requires review', async () => {
    const r = record({ id: 'TC05', scenario: 'Unclear image requiring review', input: 'Blurry photo; Gemini returns image_assessment=unclear, confidence 0.35', expected: 'needs_human_review=true with unclear + low-confidence reasons' });
    const client = mockGemini({
      findings: baseFindings({ image_assessment: 'unclear', confidence: 0.35, category: 'other', unclear_reason: 'Image is blurry and dark.' }),
      assessment: baseAssessment({ department: 'Other', priority: 'Low' }),
    });
    const res = await submit({ client, ...freshLocation() });
    const rep = res.body.report;
    r.actual = `review=${rep.needs_human_review}, reasons=${rep.review_reasons.join(' | ')}`;
    expect(rep.needs_human_review).toBe(true);
    expect(rep.review_reasons.join(' ')).toMatch(/unclear/i);
    expect(rep.review_reasons.join(' ')).toMatch(/confidence/i);
  });

  it('TC06 duplicate report within geographic radius', async () => {
    const r = record({ id: 'TC06', scenario: 'Duplicate report within geographic radius', input: 'Report A, then report B ~22 m away with the same photo; Gemini judges candidates from compare_candidates output', expected: 'B linked to A as likely duplicate; distance computed by backend (~22 m); image similarity 1.0' });
    const loc = freshLocation();
    const photo = await makeImage({ seed: 7 });
    const first = await submit({ client: mockGemini({ findings: baseFindings(), assessment: baseAssessment() }), image: photo, ...loc });
    const aId = first.body.report.id;
    const client = mockGemini({
      findings: ({ compare }) =>
        baseFindings({
          duplicates: (compare?.comparisons || []).filter((c) => c.image_similarity >= 0.9).map((c) => ({ report_id: c.report_id, likelihood: 'likely', reason: `Same pothole: ${c.distance_m} m away, image similarity ${c.image_similarity}` })),
          duplicate_summary: 'One likely duplicate found nearby.',
        }),
      assessment: baseAssessment(),
    });
    const res = await submit({ client, image: photo, latitude: loc.latitude + 0.0002, longitude: loc.longitude });
    const dup = res.body.report.duplicates[0];
    r.actual = dup ? `linked to id ${dup.candidate_report_id} (A=${aId}), likelihood=${dup.likelihood}, distance=${dup.distance_m} m, image_sim=${dup.image_similarity}` : 'no duplicate link';
    expect(dup.candidate_report_id).toBe(aId);
    expect(dup.likelihood).toBe('likely');
    expect(dup.distance_m).toBeGreaterThan(20);
    expect(dup.distance_m).toBeLessThan(24);
    expect(dup.image_similarity).toBe(1);
  });

  it('TC07 similar issue outside geographic radius', async () => {
    const r = record({ id: 'TC07', scenario: 'Similar issue outside geographic radius', input: 'Same photo/category submitted ~330 m away; agent searches 75 m radius', expected: 'search_nearby_reports returns 0 reports; no duplicate links' });
    const loc = freshLocation();
    const photo = await makeImage({ seed: 9 });
    await submit({ client: mockGemini({ findings: baseFindings(), assessment: baseAssessment() }), image: photo, ...loc });
    const client = mockGemini({ findings: baseFindings(), assessment: baseAssessment() });
    const res = await submit({ client, image: photo, latitude: loc.latitude + 0.003, longitude: loc.longitude });
    const run = getRun(res.body.runId);
    const search = run.steps.find((s) => s.step === 'tool_result:search_nearby_reports');
    r.actual = `nearby found=${search.data.count} within ${search.data.radius_m} m; duplicates=${res.body.report.duplicates.length}`;
    expect(search.data.count).toBe(0);
    expect(res.body.report.duplicates).toHaveLength(0);
  });

  it('TC19 hallucinated duplicate ids are discarded by the orchestrator', async () => {
    const r = record({ id: 'TC19', scenario: 'Agent claims a duplicate the database never returned', input: 'Gemini submit_findings lists report_id 99999 as a duplicate without it being retrieved', expected: 'Orchestrator discards the claim; no link stored; validation warning logged' });
    const client = mockGemini({ findings: baseFindings({ duplicates: [{ report_id: 99999, likelihood: 'likely', reason: 'Invented' }] }), assessment: baseAssessment() });
    const res = await submit({ client, ...freshLocation() });
    const run = getRun(res.body.runId);
    const warn = run.steps.find((s) => s.step === 'validation' && s.status === 'warning');
    r.actual = `links=${res.body.report.duplicates.length}, warning="${warn?.message}"`;
    expect(res.body.report.duplicates).toHaveLength(0);
    expect(warn.message).toMatch(/Discarded 1/);
  });
});

describe('Agent 2 — Civic Action & Prioritisation', () => {
  it('TC08 high-risk pothole prioritisation', async () => {
    const r = record({ id: 'TC08', scenario: 'High-risk pothole prioritisation', input: 'Deep pothole near school (severity high, hazards); Agent 2 receives evidence and returns High', expected: 'Agent 2 receives severity=high + hazards in handoff; priority=High; urgent; policy tool consulted' });
    let handoff;
    const client = mockGemini({
      findings: baseFindings({ severity: 'high', safety_hazards: ['Two-wheelers swerving', 'Near school entrance'] }),
      assessment: (ev) => {
        handoff = ev;
        return baseAssessment({ priority: 'High', safety_risk: 'high', urgent: true, explanation: 'Deep pothole near a school creates a high accident risk for two-wheelers and children.' });
      },
    });
    const res = await submit({ client, description: 'Deep pothole near school gate', ...freshLocation() });
    const run = getRun(res.body.runId);
    const policy = run.steps.some((s) => s.step === 'tool_result:get_priority_policy');
    r.actual = `handoff severity=${handoff.agent1_findings.severity}, hazards=${handoff.agent1_findings.safety_hazards.length}; priority=${res.body.report.priority}; policyConsulted=${policy}`;
    expect(handoff.agent1_findings.severity).toBe('high');
    expect(handoff.agent1_findings.safety_hazards).toHaveLength(2);
    expect(res.body.report.priority).toBe('High');
    expect(policy).toBe(true);
  });

  it('TC09 critical safety issue prioritisation (+ guardrail)', async () => {
    const r = record({ id: 'TC09', scenario: 'Critical safety issue prioritisation', input: '(a) Open manhole, severity critical, Agent 2 returns Critical; (b) severity critical but Agent 2 returns Medium', expected: '(a) Critical + human confirmation flag; (b) orchestrator raises to High and logs guardrail' });
    const a = await submit({
      client: mockGemini({
        findings: baseFindings({ category: 'open_drain', severity: 'critical', safety_hazards: ['Uncovered manhole on busy road'] }),
        assessment: baseAssessment({ priority: 'Critical', department: 'Drainage', safety_risk: 'severe', urgent: true, explanation: 'Uncovered manhole on a busy road poses an immediate danger to life.' }),
      }),
      ...freshLocation(),
    });
    const b = await submit({
      client: mockGemini({ findings: baseFindings({ category: 'open_drain', severity: 'critical' }), assessment: baseAssessment({ priority: 'Medium', department: 'Drainage' }) }),
      ...freshLocation(),
    });
    const bRun = getRun(b.body.runId);
    const guard = bRun.steps.find((s) => s.step === 'guardrail');
    r.actual = `(a) priority=${a.body.report.priority}, review=${a.body.report.needs_human_review}; (b) priority=${b.body.report.priority}, guardrail="${guard?.message}"`;
    expect(a.body.report.priority).toBe('Critical');
    expect(a.body.report.review_reasons.join(' ')).toMatch(/critical/i);
    expect(b.body.report.priority).toBe('High');
    expect(guard.message).toMatch(/raised from Medium to High/);
  });

  it('TC10 correct department recommendation (development-mode pipeline)', async () => {
    const r = record({ id: 'TC10', scenario: 'Correct department recommendation', input: 'Dev-mode agents on: water leak, open drain, streetlight, garbage, pothole descriptions', expected: 'Water Supply, Drainage, Electricity, Sanitation, Roads and Infrastructure' });
    const cases = [
      ['Water pipeline leaking on road', 'Water Supply'],
      ['Open drain overflowing near homes', 'Drainage'],
      ['Street light not working for a week', 'Electricity'],
      ['Garbage dumped near the market', 'Sanitation'],
      ['Pothole in front of bus stop', 'Roads and Infrastructure'],
    ];
    const got = [];
    for (const [desc] of cases) {
      const res = await submit({ client: createDevelopmentClient(), description: desc, ...freshLocation() });
      got.push(res.body.report.department);
    }
    r.actual = got.join(', ');
    expect(got).toEqual(cases.map((c) => c[1]));
  });
});
