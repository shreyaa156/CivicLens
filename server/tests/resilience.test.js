import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setModelClientFactory, createGeminiClient } from '../src/ai/modelClient.js';
import { getRun } from '../src/models/agentModel.js';
import { record, makeImage, mockGemini, baseFindings, baseAssessment, fnCall } from './helpers.js';

let app;
beforeAll(() => {
  app = createApp();
});
afterEach(() => setModelClientFactory(null));

async function submit(client, lat, lon) {
  setModelClientFactory(() => client);
  return request(app)
    .post('/api/reports?wait=true')
    .field('latitude', String(lat))
    .field('longitude', String(lon))
    .attach('image', await makeImage(), { filename: 'a.jpg', contentType: 'image/jpeg' });
}

/** Fake @google/genai `models` object that fails with HTTP-like errors. */
function failingModels({ failTimes = Infinity, status = 503, then } = {}) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async generateContent(params) {
      calls++;
      if (calls <= failTimes) {
        const err = new Error(`got status: ${status} UNAVAILABLE. The model is overloaded.`);
        err.status = status;
        throw err;
      }
      return then(params);
    },
  };
}

describe('Resilience', () => {
  it('TC14 Gemini API failure handling', async () => {
    const r = record({ id: 'TC14', scenario: 'Gemini API failure handling', input: '(a) Gemini SDK returns HTTP 503 on every call (b) 503 once then recovers', expected: '(a) retried, report still saved, analysis_status=failed, human review flagged, run=failed (b) retry succeeds, run completed' });
    const models = failingModels();
    const client = createGeminiClient({ models, model: 'gemini-test', retryDelayMs: 1 });
    const a = await submit(client, 30.0, 70.0);
    const aRun = await getRun(a.body.runId);
    const retries = aRun.steps.filter((s) => s.step === 'model_retry').length;

    const healthy = mockGemini({ findings: baseFindings(), assessment: baseAssessment() });
    const models2 = failingModels({ failTimes: 1, then: (p) => healthy.generateContent(p) });
    const b = await submit(createGeminiClient({ models: models2, model: 'gemini-test', retryDelayMs: 1 }), 30.5, 70.5);

    r.actual = `(a) HTTP ${a.status}, saved=${!!a.body.report.id}, analysis=${a.body.report.analysis_status}, review=${a.body.report.needs_human_review}, run=${aRun.status}, sdk calls=${models.calls}, retries logged=${retries} (b) analysis=${b.body.report.analysis_status}, sdk calls=${models2.calls}`;
    expect(a.status).toBe(201);
    expect(a.body.report.analysis_status).toBe('failed');
    expect(a.body.report.needs_human_review).toBe(true);
    expect(aRun.status).toBe('failed');
    expect(models.calls).toBe(6); // 3 attempts per request × 2 agent attempts
    expect(retries).toBe(4);
    expect(b.body.report.analysis_status).toBe('completed');
  });

  it('TC20 falls back to a secondary Gemini model when the primary is overloaded', async () => {
    const r = record({ id: 'TC20', scenario: 'Gemini model fallback on overload', input: 'Primary model returns HTTP 503 (high demand) on every call; fallback model is healthy', expected: 'Client switches to the fallback model, logs model_fallback, run completes and records the fallback model' });
    const healthy = mockGemini({ findings: baseFindings(), assessment: baseAssessment() });
    const seen = [];
    const models = {
      async generateContent(params) {
        seen.push(params.model);
        if (params.model === 'primary-model') {
          const err = new Error('This model is currently experiencing high demand.');
          err.status = 503;
          throw err;
        }
        return healthy.generateContent(params);
      },
    };
    const client = createGeminiClient({ models, model: 'primary-model', fallbackModels: ['fallback-model'], retryDelayMs: 1 });
    const res = await submit(client, 34, 74);
    const run = await getRun(res.body.runId);
    const fb = run.steps.filter((s) => s.step === 'model_fallback');
    const primaryCalls = seen.filter((m) => m === 'primary-model').length;
    r.actual = `run=${run.status}, recorded model=${run.model}, fallback events=${fb.length} ("${fb[0]?.message}"), primary attempts=${primaryCalls}, category=${res.body.report.category}`;
    expect(run.status).toBe('completed');
    expect(run.model).toBe('fallback-model');
    expect(fb).toHaveLength(1); // sticky: Agent 2 goes straight to the fallback
    expect(primaryCalls).toBe(2); // 1 try + 1 retry before switching
    expect(res.body.report.category).toBe('pothole');
  });

  it('does not fall back on non-capacity errors (e.g. 400 bad request)', async () => {
    const seen = [];
    const models = {
      async generateContent(params) {
        seen.push(params.model);
        const err = new Error('API key not valid');
        err.status = 400;
        throw err;
      },
    };
    const res = await submit(createGeminiClient({ models, model: 'primary-model', fallbackModels: ['fallback-model'], retryDelayMs: 1 }), 35, 75);
    expect(res.body.report.analysis_status).toBe('failed');
    expect(seen.every((m) => m === 'primary-model')).toBe(true);
  });

  it('does not retry non-retryable errors (e.g. invalid API key 400)', async () => {
    const models = failingModels({ status: 400 });
    const res = await submit(createGeminiClient({ models, model: 'gemini-test', retryDelayMs: 1 }), 31, 71);
    expect(res.body.report.analysis_status).toBe('failed');
    expect(models.calls).toBe(2); // one per agent attempt, no HTTP retries
  });

  it('TC17 orchestration failure handling', async () => {
    const r = record({ id: 'TC17', scenario: 'Orchestration failure handling', input: '(a) Agent 2 keeps returning invalid structured output (priority "Urgent!!") (b) Agent 1 tries to submit before searching the database', expected: '(a) run=partial: Agent 1 results kept, rule-based department, priority unassigned, human review (b) guardrail rejects early submission; agent then searches and completes' });
    const badAgent2 = mockGemini({
      findings: baseFindings({ category: 'water_leakage' }),
      agent2: (contents) => {
        const hasPolicy = contents.some((c) => c.parts?.some((p) => p.functionResponse?.name === 'get_priority_policy'));
        return hasPolicy ? fnCall('submit_assessment', { ...baseAssessment(), priority: 'Urgent!!' }) : fnCall('get_priority_policy', {});
      },
    });
    const a = await submit(badAgent2, 32, 72);
    const aRun = await getRun(a.body.runId);
    const validationFails = aRun.steps.filter((s) => s.step === 'validation_failed').length;

    let early = true;
    const eager = mockGemini({
      assessment: baseAssessment(),
      agent1: (contents) => {
        const searched = contents.some((c) => c.parts?.some((p) => p.functionResponse?.name === 'search_nearby_reports'));
        if (early) {
          early = false;
          return fnCall('submit_findings', baseFindings());
        }
        return searched ? fnCall('submit_findings', baseFindings()) : fnCall('search_nearby_reports', { radius_m: 75 });
      },
    });
    const b = await submit(eager, 33, 73);
    const bRun = await getRun(b.body.runId);
    const guard = bRun.steps.find((s) => s.step === 'guardrail');

    r.actual = `(a) run=${aRun.status}, analysis=${a.body.report.analysis_status}, category=${a.body.report.category}, department=${a.body.report.department}, priority=${a.body.report.priority}, review=${a.body.report.needs_human_review}, validation failures=${validationFails} (b) guardrail="${guard?.message}", run=${bRun.status}`;
    expect(aRun.status).toBe('partial');
    expect(a.body.report.category).toBe('water_leakage');
    expect(a.body.report.department).toBe('Water Supply');
    expect(a.body.report.priority).toBeNull();
    expect(a.body.report.needs_human_review).toBe(true);
    expect(validationFails).toBeGreaterThanOrEqual(3);
    expect(guard.message).toMatch(/must call search_nearby_reports/);
    expect(bRun.status).toBe('completed');
  });
});
