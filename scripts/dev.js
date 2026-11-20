/**
 * `npm run dev`
 *  - Local development: runs the API (auto-restart) and the Vite dev server together.
 *  - Production (NODE_ENV=production, e.g. a host that runs the dev script by mistake): starts the
 *    production server instead, because the dev-only tools (concurrently, Vite dev server) are not
 *    installed there.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

const [cmd, args] =
  process.env.NODE_ENV === 'production'
    ? [process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.js']]
    : [isWin ? 'npx.cmd' : 'npx', ['concurrently', '-n', 'api,web', '-c', 'blue,green', 'npm run dev --prefix server', 'npm run dev --prefix client']];

if (process.env.NODE_ENV === 'production') console.log('NODE_ENV=production: starting the production server (use `npm start`).');
const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin && cmd !== process.execPath });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
