import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import { getDb } from '../src/db/index.js';
import { setModelClientFactory } from '../src/ai/modelClient.js';
import { getRun } from '../src/models/agentModel.js';
import { record, makeImage, mockGemini, baseFindings, baseAssessment } from './helpers.js';

let app;
const count = () => getDb().prepare('SELECT COUNT(*) c FROM reports').get().c;

beforeAll(() => {
  app = createApp();
});
afterEach(() => {
  setModelClientFactory(null);
  config.adminToken = '';
});

async function createReport(lat = 21.1, lon = 79.08, client) {
  if (client) setModelClientFactory(() => client);
  return request(app)
    .post('/api/reports?wait=true')
    .field('description', 'Pothole near the junction')
    .field('latitude', String(lat))
    .field('longitude', String(lon))
    .attach('image', await makeImage({ seed: 3 }), { filename: 'p.jpg', contentType: 'image/jpeg' });
}

describe('Report submission & validation', () => {
  it('TC11 missing location handling', async () => {
    const r = record({ id: 'TC11', scenario: 'Missing location handling', input: 'Valid photo, no latitude/longitude', expected: 'HTTP 400 LOCATION_REQUIRED; nothing stored' });
    const before = count();
    const res = await request(app).post('/api/reports').field('description', 'x').attach('image', await makeImage(), { filename: 'a.jpg', contentType: 'image/jpeg' });
    const partial = await request(app).post('/api/reports').field('latitude', '20.1').attach('image', await makeImage(), { filename: 'a.jpg', contentType: 'image/jpeg' });
    r.actual = `HTTP ${res.status} ${res.body.error?.code}; lat-only → HTTP ${partial.status}; reports stored: ${count() - before}`;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
    expect(partial.status).toBe(400);
    expect(count()).toBe(before);
  });

  it('TC12 invalid image rejection', async () => {
    const r = record({ id: 'TC12', scenario: 'Invalid image rejection', input: '(a) text file disguised as image/jpeg, (b) PDF mimetype, (c) 9 MB file, (d) no image', expected: '(a) 415 (b) 415 (c) 413 (d) 400; nothing stored' });
    const before = count();
    const send = (buf, name, type) => request(app).post('/api/reports').field('latitude', '20').field('longitude', '73').attach('image', buf, { filename: name, contentType: type });
    const a = await send(Buffer.from('this is not really an image at all, just text'), 'fake.jpg', 'image/jpeg');
    const b = await send(Buffer.from('%PDF-1.4 ...'), 'doc.pdf', 'application/pdf');
    const big = Buffer.alloc(9 * 1024 * 1024, 0xff);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    const c = await send(big, 'big.jpg', 'image/jpeg');
    const d = await request(app).post('/api/reports').field('latitude', '20').field('longitude', '73');
    r.actual = `(a) ${a.status} ${a.body.error?.code} (b) ${b.status} (c) ${c.status} (d) ${d.status} ${d.body.error?.code}; stored ${count() - before}`;
    expect(a.status).toBe(415);
    expect(b.status).toBe(415);
    expect(c.status).toBe(413);
    expect(d.status).toBe(400);
    expect(count()).toBe(before);
  });

  it('TC13 successful report submission (end-to-end, development mode)', async () => {
    const r = record({ id: 'TC13', scenario: 'Successful report submission', input: 'Valid JPEG + description + coordinates via POST /api/reports (dev-mode agents)', expected: '201; reference CL-xxxx; image stored & EXIF-stripped JPEG; run completed with all agent milestones; report listed' });
    const res = await createReport(21.15, 79.09);
    const rep = res.body.report;
    const run = getRun(res.body.runId);
    const steps = new Set(run.steps.map((s) => s.step));
    const milestones = ['workflow_started', 'image_received', 'issue_identified', 'tool_result:search_nearby_reports', 'duplicates_completed', 'risk_assessment_started', 'priority_assigned', 'department_recommended', 'action_suggested', 'final_decision'];
    const missing = milestones.filter((m) => !steps.has(m));
    const fileExists = fs.existsSync(path.join(config.uploadDir, rep.images[0].filename));
    const list = await request(app).get('/api/reports');
    r.actual = `HTTP ${res.status}, ref=${rep.reference}, file=${fileExists}, run=${run.status} (${run.ai_mode}), missing milestones=${missing.length}, listed=${list.body.reports.some((x) => x.id === rep.id)}`;
    expect(res.status).toBe(201);
    expect(rep.reference).toMatch(/^CL-/);
    expect(fileExists).toBe(true);
    expect(rep.images[0].mime_type).toBe('image/jpeg');
    expect(run.status).toBe('completed');
    expect(run.ai_mode).toBe('development');
    expect(missing).toEqual([]);
    expect(list.body.reports.some((x) => x.id === rep.id)).toBe(true);
  });

  it('returns 202 + runId immediately in async mode', async () => {
    const res = await request(app).post('/api/reports').field('latitude', '22').field('longitude', '75').attach('image', await makeImage(), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(202);
    expect(res.body.runId).toBeTypeOf('number');
    // wait for background completion so the run isn't left dangling
    for (let i = 0; i < 50 && getRun(res.body.runId).status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(getRun(res.body.runId).status).toBe('completed');
  });
});

describe('Administration', () => {
  it('TC15 admin status update', async () => {
    const r = record({ id: 'TC15', scenario: 'Admin status update', input: 'PATCH status → in_progress with note; invalid status; with ADMIN_TOKEN set: no token / correct token', expected: '200 + history entry; invalid → 400; no token → 401; correct token → 200' });
    const { body } = await createReport(21.2, 79.1);
    const id = body.report.id;
    const ok = await request(app).patch(`/api/admin/reports/${id}/status`).send({ status: 'in_progress', note: 'Crew assigned' });
    const last = ok.body.report.history.at(-1);
    const bad = await request(app).patch(`/api/admin/reports/${id}/status`).send({ status: 'teleported' });
    config.adminToken = 'test-secret-token';
    const unauth = await request(app).patch(`/api/admin/reports/${id}/status`).send({ status: 'resolved' });
    const authed = await request(app).patch(`/api/admin/reports/${id}/status`).set('Authorization', 'Bearer test-secret-token').send({ status: 'resolved' });
    const note = await request(app).post(`/api/admin/reports/${id}/notes`).set('Authorization', 'Bearer test-secret-token').send({ note: 'Verified on site' });
    r.actual = `update=${ok.status} history="${last.from_status}→${last.to_status} (${last.note})"; invalid=${bad.status}; noToken=${unauth.status}; token=${authed.status} status=${authed.body.report?.status}; note=${note.status}`;
    expect(ok.status).toBe(200);
    expect(last).toMatchObject({ from_status: 'submitted', to_status: 'in_progress', note: 'Crew assigned' });
    expect(bad.status).toBe(400);
    expect(unauth.status).toBe(401);
    expect(authed.status).toBe(200);
    expect(authed.body.report.status).toBe('resolved');
    expect(note.status).toBe(201);
  });

  it('TC16 duplicate grouping approval and rejection', async () => {
    const r = record({ id: 'TC16', scenario: 'Duplicate grouping approval and rejection', input: 'Two duplicate groups suggested by Agent 1; approve group 1, reject group 2', expected: 'Group 1 links approved & report status=duplicate; group 2 links rejected, duplicate review reason cleared' });
    const dupClient = () =>
      mockGemini({
        findings: ({ compare }) => baseFindings({ duplicates: (compare?.comparisons || []).map((c) => ({ report_id: c.report_id, likelihood: 'likely', reason: 'Same location and photo' })), duplicate_summary: 'Duplicate found.' }),
        assessment: baseAssessment(),
      });
    await createReport(23.0, 77.0, dupClient());
    const g1 = (await createReport(23.0001, 77.0, dupClient())).body.report;
    await createReport(24.0, 78.0, dupClient());
    const g2 = (await createReport(24.0001, 78.0, dupClient())).body.report;
    expect(g1.duplicates.length).toBe(1);
    const groups = await request(app).get('/api/admin/duplicates?status=suggested');
    const approve = await request(app).post(`/api/admin/duplicates/${g1.id}/review`).send({ decision: 'approved', note: 'Confirmed same pothole' });
    const reject = await request(app).post(`/api/admin/duplicates/${g2.id}/review`).send({ decision: 'rejected' });
    r.actual = `groups suggested=${groups.body.groups.length}; approve → link=${approve.body.links[0].status}, report status=${approve.body.report.status}; reject → link=${reject.body.links[0].status}, dup reason remaining=${reject.body.report.review_reasons.some((x) => /duplicate/i.test(x))}`;
    expect(groups.body.groups.map((g) => g.report_id)).toEqual(expect.arrayContaining([g1.id, g2.id]));
    expect(approve.body.links[0].status).toBe('approved');
    expect(approve.body.report.status).toBe('duplicate');
    expect(reject.body.links[0].status).toBe('rejected');
    expect(reject.body.report.review_reasons.some((x) => /duplicate/i.test(x))).toBe(false);
  });
});

describe('Contact form → admin Messages inbox', () => {
  it('TC18 contact form validation and admin inbox', async () => {
    const r = record({ id: 'TC18', scenario: 'Contact form validation and admin Messages inbox', input: '(a) invalid email + short message (b) valid message (c) honeypot filled (d) admin lists / marks read / deletes (e) inbox with ADMIN_TOKEN set, no token', expected: '(a) 400 with field errors (b) 201 received, stored unread (c) 400 (d) appears unread → read → deleted (e) 401' });
    const a = await request(app).post('/api/contact').send({ name: 'A', email: 'not-an-email', subject: 'Hi', message: 'short' });
    const valid = { name: 'Asha Patil', email: 'asha@example.com', subject: 'Pilot enquiry', message: 'We would like to pilot CivicLens in our ward.' };
    const b = await request(app).post('/api/contact').send(valid);
    const c = await request(app).post('/api/contact').send({ ...valid, website: 'http://spam' });
    const list = await request(app).get('/api/admin/messages');
    const stored = list.body.messages.find((m) => m.id === b.body.id);
    const read = await request(app).patch(`/api/admin/messages/${b.body.id}`).send({ read: true });
    const unreadAfter = await request(app).get('/api/admin/messages?filter=unread');
    config.adminToken = 'inbox-secret';
    const locked = await request(app).get('/api/admin/messages');
    config.adminToken = '';
    const del = await request(app).delete(`/api/admin/messages/${b.body.id}`);
    const gone = await request(app).get('/api/admin/messages');
    r.actual = `(a) ${a.status} fields=${a.body.error.fields.map((f) => f.field).join(',')} (b) ${b.status} received=${b.body.received}, stored unread=${stored && !stored.is_read} (c) ${c.status} (d) read=${read.body.message.is_read}, in unread list=${unreadAfter.body.messages.some((m) => m.id === b.body.id)}, deleted=${del.body.deleted}, still listed=${gone.body.messages.some((m) => m.id === b.body.id)} (e) ${locked.status}`;
    expect(a.status).toBe(400);
    expect(a.body.error.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['name', 'email', 'subject', 'message']));
    expect(b.status).toBe(201);
    expect(stored).toMatchObject({ name: 'Asha Patil', email: 'asha@example.com', subject: 'Pilot enquiry', is_read: false });
    expect(c.status).toBe(400);
    expect(read.body.message.is_read).toBe(true);
    expect(unreadAfter.body.messages.some((m) => m.id === b.body.id)).toBe(false);
    expect(locked.status).toBe(401);
    expect(del.body.deleted).toBe(true);
    expect(gone.body.messages.some((m) => m.id === b.body.id)).toBe(false);
  });
});

describe('Public live statistics', () => {
  it('TC21 public stats are computed from genuine reports only', async () => {
    const r = record({ id: 'TC21', scenario: 'Live public statistics from real data', input: 'Real reports in the DB plus one legacy is_demo row inserted directly', expected: 'Totals equal the count of genuine reports; legacy demo row ignored; latest decision comes from a real agent run' });
    const db = getDb();
    db.prepare(`INSERT INTO reports (reference, latitude, longitude, is_demo, status) VALUES ('DEMO-X', 1, 1, 1, 'submitted')`).run();
    const genuine = db.prepare('SELECT COUNT(*) c FROM reports WHERE is_demo = 0').get().c;
    const res = await request(app).get('/api/stats/public');
    const latestRun = db.prepare(`SELECT r.reference FROM agent_runs a JOIN reports r ON r.id = a.report_id WHERE a.status = 'completed' AND r.is_demo = 0 ORDER BY a.id DESC LIMIT 1`).get();
    r.actual = `total=${res.body.totals.total} (genuine in DB=${genuine}), latest decision=${res.body.latestDecision?.reference} (latest real run=${latestRun?.reference})`;
    expect(res.status).toBe(200);
    expect(res.body.totals.total).toBe(genuine);
    expect(res.body.latestDecision?.reference).toBe(latestRun?.reference);
    db.prepare(`DELETE FROM reports WHERE reference = 'DEMO-X'`).run();
  });

  it('agent run list is admin-only while a single run stays readable for live progress', async () => {
    config.adminToken = 'secret-admin';
    const list = await request(app).get('/api/admin/agent-runs');
    const oldPublicList = await request(app).get('/api/agents/runs');
    config.adminToken = '';
    expect(list.status).toBe(401);
    expect(oldPublicList.status).toBe(404);
  });
});

describe('Security basics', () => {
  it('CORS: blocks unknown origins on the API, allows same-origin and configured origins', async () => {
    const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    const same = await request(app).get('/api/health').set('Host', 'civiclens.test').set('Origin', 'http://civiclens.test');
    const dev = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(evil.status).toBe(403);
    expect(same.status).toBe(200);
    expect(dev.status).toBe(200);
  });

  it('CORS: development accepts any localhost port (Vite on 5174); production stays strict', async () => {
    const devAlt = await request(app).get('/api/health').set('Origin', 'http://localhost:5174');
    config.isProduction = true;
    const prodAlt = await request(app).get('/api/health').set('Origin', 'http://localhost:5174');
    config.isProduction = false;
    expect(devAlt.status).toBe(200);
    expect(prodAlt.status).toBe(403);
  });

  it('does not expose the Gemini key via /api/config and hides internals on errors', async () => {
    config.gemini.apiKey = 'AIza-secret-test-key';
    const res = await request(app).get('/api/config');
    config.gemini.apiKey = '';
    expect(JSON.stringify(res.body)).not.toContain('AIza-secret-test-key');
    const nf = await request(app).get('/api/reports/does-not-exist');
    expect(nf.status).toBe(404);
    expect(nf.body.error.message).not.toMatch(/sql|stack/i);
  });
});
