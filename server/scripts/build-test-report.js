// Builds docs/TEST_REPORT.md from the rows recorded by tests (tests/.results/results.jsonl).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'tests', '.results', 'results.jsonl');
const out = path.resolve(root, '..', 'docs', 'TEST_REPORT.md');

if (!fs.existsSync(src)) {
  console.error('No results found. Run `npm test` first.');
  process.exit(1);
}
const rows = fs
  .readFileSync(src, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const passed = rows.filter((r) => r.result === 'PASS').length;
const md = [
  '# CivicLens — Test Scenario Report',
  '',
  `Generated: ${new Date().toISOString()}  `,
  `Runner: Vitest + Supertest (automated, deterministic). AI responses are **mocked Gemini function-call responses** or the labelled development-mode model; the real orchestrator, agent loops, backend tools, SQLite database and validation run unmodified.  `,
  `Result: **${passed}/${rows.length} scenarios passed**`,
  '',
  '| Test ID | Scenario | Input | Expected result | Actual result | Pass/Fail |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${esc(r.scenario)} | ${esc(r.input)} | ${esc(r.expected)} | ${esc(r.actual)}${r.error ? ` — ${esc(r.error)}` : ''} | ${r.result === 'PASS' ? '✅ PASS' : '❌ FAIL'} |`),
  '',
  'A live Gemini smoke test (`npm run smoke:gemini`) is run separately and only when your own GEMINI_API_KEY is configured.',
  '',
].join('\n');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(`Wrote ${out} (${passed}/${rows.length} passed)`);
