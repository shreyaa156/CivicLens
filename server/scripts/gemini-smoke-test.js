/**
 * Live Google Gemini smoke test — runs BOTH agents through the real orchestrator against the
 * real Gemini API, using a temporary database. Only runs when YOUR GEMINI_API_KEY is configured.
 *
 *   npm run smoke:gemini                     (uses a generated test image)
 *   npm run smoke:gemini -- path/to/photo.jpg "Pothole near school"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH = path.join(os.tmpdir(), `civiclens-smoke-${Date.now()}.db`);
process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'civiclens-smoke-uploads');
process.env.GEOCODING_ENABLED = 'false';

const { config, loadedEnvFiles, ROOT_ENV_FILE } = await import('../src/config/index.js');
console.log(`Env file(s) loaded: ${loadedEnvFiles.length ? loadedEnvFiles.join(', ') : 'none'}`);
if (!config.gemini.apiKey) {
  console.log(`SKIPPED: GEMINI_API_KEY is empty or missing. Add it to ${ROOT_ENV_FILE} to run the live smoke test.`);
  process.exit(0);
}
console.log('GEMINI_API_KEY: present (value not shown)');

const sharp = (await import('sharp')).default;
const { initDatabase, closeDatabase } = await import('../src/db/index.js');
const { createReport, addImage, getReportRow } = await import('../src/models/reportModel.js');
const { processUpload, saveImage } = await import('../src/services/imageService.js');
const { createGeminiClient } = await import('../src/ai/modelClient.js');
const { processReport } = await import('../src/ai/orchestrator.js');
const { getRun } = await import('../src/models/agentModel.js');

const [imgPath, desc = 'Large pothole on the road, vehicles swerving'] = process.argv.slice(2);
const buffer = imgPath
  ? fs.readFileSync(imgPath)
  : await sharp({ create: { width: 640, height: 480, channels: 3, background: '#5b5b5b' } })
      .composite([{ input: Buffer.from('<svg width="640" height="480"><ellipse cx="320" cy="300" rx="180" ry="80" fill="#2a2a2a"/></svg>') }])
      .jpeg()
      .toBuffer();

process.env.DB_CLIENT = process.env.DB_CLIENT || 'sqlite'; // smoke test uses a throwaway SQLite DB
await initDatabase();
const processed = await processUpload({ buffer, originalname: imgPath ? path.basename(imgPath) : 'synthetic.jpg' });
const filename = await saveImage(processed);
const id = await createReport({ citizenDescription: desc, latitude: 20.0076, longitude: 73.763 });
await addImage(id, { ...processed, filename });

console.log(`Running live Gemini agents with model ${config.gemini.model} …`);
const t0 = Date.now();
const outcome = await processReport(id, { client: createGeminiClient() });
const run = await getRun(outcome.runId);
const report = await getReportRow(id);
for (const s of run.steps) console.log(`  [${s.agent.padEnd(12)}] ${s.status.padEnd(7)} ${s.message}`);
console.log('\nResult:', JSON.stringify({ status: outcome.status, category: report.category, severity: report.severity, confidence: report.confidence, priority: report.priority, department: report.department }, null, 2));
console.log(`Elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await closeDatabase();
process.exit(outcome.status === 'completed' ? 0 : 1);
