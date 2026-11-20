import { createApp } from './app.js';
import { config, loadedEnvFiles, ROOT_ENV_FILE } from './config/index.js';
import { describeAiMode } from './ai/modelClient.js';

const app = createApp();

const ai = describeAiMode();
app.listen(config.port, () => {
  console.log(`\n  CivicLens API running on http://localhost:${config.port}`);
  console.log(`  Environment: ${config.nodeEnv}`);
  console.log(`  Env file(s): ${loadedEnvFiles.length ? loadedEnvFiles.join(', ') : `none found (expected ${ROOT_ENV_FILE})`}`);
  console.log(`  AI provider: ${ai.provider}${ai.mode === 'gemini' ? ` (model ${ai.model})` : ''}`);
  if (ai.mode === 'development') console.log('  ⚠  GEMINI_API_KEY not set — agents use labelled development-mode sample responses.');
  if (!config.adminToken) console.log(`  ⚠  ADMIN_TOKEN not set — admin endpoints are ${config.isProduction ? 'DISABLED' : 'open (development only)'}.`);
  console.log('');
});
