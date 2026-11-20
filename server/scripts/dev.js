/**
 * Development server launcher (`npm run dev`).
 * Restarts the API when source files change, and also when a .env file changes, but only
 * watches .env files that actually exist, so it never crashes on hosts without a .env.
 * Production uses `npm start` (no watching at all).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = ['--disable-warning=ExperimentalWarning'];

// --watch-path is supported on Windows and macOS; elsewhere fall back to plain --watch.
if (process.platform === 'win32' || process.platform === 'darwin') {
  args.push('--watch-path=./src');
  for (const envFile of ['../.env', './.env']) {
    if (fs.existsSync(path.join(serverRoot, envFile))) args.push(`--watch-path=${envFile}`);
  }
} else {
  args.push('--watch');
}
args.push('src/index.js');

const child = spawn(process.execPath, args, { cwd: serverRoot, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
