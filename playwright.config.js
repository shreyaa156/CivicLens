import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E tests run against an isolated production build on port 4400 with a throwaway
// database, so test submissions never touch your real data.
const PORT = 4400;
const runDir = path.join(os.tmpdir(), `civiclens-e2e-${Date.now()}`);

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    geolocation: { latitude: 19.9975, longitude: 73.7898 }, // Nashik
    permissions: ['geolocation'],
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm start',
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 120000,
        env: {
          NODE_ENV: 'test',
          PORT: String(PORT),
          DATABASE_PATH: path.join(runDir, 'e2e.db'),
          UPLOAD_DIR: path.join(runDir, 'uploads'),
          AI_MODE: 'development',
          GEOCODING_ENABLED: 'false',
          ADMIN_TOKEN: 'e2e-admin-token', // test-only token (overrides the one in .env)
        },
      },
});
