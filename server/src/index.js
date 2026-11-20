import { createApp } from './app.js';
import { config, loadedEnvFiles, ROOT_ENV_FILE } from './config/index.js';
import { describeAiMode } from './ai/modelClient.js';
import { initDatabase, closeDatabase, dialect } from './db/index.js';

async function main() {
  try {
    await initDatabase();
  } catch (err) {
    // Message never includes credentials (host/port and error code only).
    console.error(`
  ✖ Database initialisation failed: ${err.message}
`);
    process.exit(1);
  }

  const app = createApp();
  const ai = describeAiMode();
  const server = app.listen(config.port, config.host, () => {
    console.log(`
  CivicLens listening on ${config.host}:${config.port} (locally: http://localhost:${config.port})`);
    console.log(`  Environment: ${config.nodeEnv}`);
    console.log(`  Database: ${dialect() === 'mysql' ? `MySQL (${process.env.DB_NAME} on ${process.env.DB_HOST})` : `SQLite (${config.databasePath})`}`);
    console.log(`  Env file(s): ${loadedEnvFiles.length ? loadedEnvFiles.join(', ') : `none found (expected ${ROOT_ENV_FILE})`}`);
    console.log(`  AI provider: ${ai.provider}${ai.mode === 'gemini' ? ` (model ${ai.model})` : ''}`);
    if (ai.mode === 'development') console.log('  ⚠  GEMINI_API_KEY not set — agents use labelled development-mode sample responses.');
    if (!config.adminToken) console.log(`  ⚠  ADMIN_TOKEN not set — admin endpoints are ${config.isProduction ? 'DISABLED' : 'open (development only)'}.`);
    console.log('');
  });

  const shutdown = (signal) => {
    console.log(`
  ${signal} received — shutting down`);
    server.close(() => closeDatabase().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
