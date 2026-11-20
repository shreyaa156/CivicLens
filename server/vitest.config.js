import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.js'],
    testTimeout: 20000,
    execArgv: ['--disable-warning=ExperimentalWarning'],
    env: {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      UPLOAD_DIR: path.join(os.tmpdir(), 'civiclens-test-uploads'),
      GEOCODING_ENABLED: 'false',
      AI_MODE: 'development',
      GEMINI_API_KEY: '',
      GEMINI_FALLBACK_MODELS: '',
      ADMIN_TOKEN: '',
      SEED_DEMO_DATA: 'false',
      SMTP_HOST: '',
    },
  },
});
