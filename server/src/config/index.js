import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(__dirname, '..', '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

/** Canonical location of the backend environment file: <project root>/.env */
export const ROOT_ENV_FILE = path.join(PROJECT_ROOT, '.env');
/** Optional backend-only overrides: server/.env */
export const SERVER_ENV_FILE = path.join(SERVER_ROOT, '.env');

/**
 * Load an env file into process.env.
 *  - A variable that is unset OR set to an empty string (e.g. a stale blank system/shell variable)
 *    is filled from the file, so a blank GEMINI_API_KEY in the environment can't mask the real one.
 *  - With `override`, non-empty file values win; an empty value in the override file never
 *    erases a value loaded earlier (e.g. a blank GEMINI_API_KEY= in server/.env).
 * Values are never logged.
 */
function loadEnvFile(file, { override = false } = {}) {
  if (!fs.existsSync(file)) return false;
  const parsed = dotenv.parse(fs.readFileSync(file));
  for (const [key, value] of Object.entries(parsed)) {
    const current = process.env[key];
    if (current === undefined || current === '' || (override && value !== '')) process.env[key] = value;
  }
  return true;
}

// Automated tests must never pick up real credentials, so .env files are skipped under Vitest.
export const loadedEnvFiles = process.env.VITEST
  ? []
  : [
      loadEnvFile(ROOT_ENV_FILE) && ROOT_ENV_FILE,
      loadEnvFile(SERVER_ENV_FILE, { override: true }) && SERVER_ENV_FILE,
    ].filter(Boolean);

const env = process.env;
const bool = (v, fallback = false) => (v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v));
const num = (v, fallback) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));
const resolveFromServer = (p) => (path.isAbsolute(p) ? p : path.resolve(SERVER_ROOT, p));

const nodeEnv = env.NODE_ENV || 'development';

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test' || env.VITEST === 'true',
  port: num(env.PORT, 4000),
  // Bind on all interfaces so container/proxy health checks can reach the app.
  host: env.HOST || '0.0.0.0',

  // AI (Google Gemini only)
  gemini: {
    apiKey: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || 'gemini-3.8-flash',
    // Tried in order when the primary model is overloaded (503/429) or times out. Empty = no fallback.
    fallbackModels: (env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean),
    // AI_MODE: "auto" (Gemini if key present, otherwise development), "gemini", or "development"
    mode: (env.AI_MODE || 'auto').toLowerCase(),
    maxRetries: num(env.GEMINI_MAX_RETRIES, 2),
    timeoutMs: num(env.GEMINI_TIMEOUT_MS, 60000),
  },

  // Duplicate detection
  duplicates: {
    defaultRadiusMeters: num(env.DUPLICATE_RADIUS_METERS, 75),
    maxRadiusMeters: 500,
    lookbackDays: num(env.DUPLICATE_LOOKBACK_DAYS, 60),
  },

  reviewConfidenceThreshold: num(env.REVIEW_CONFIDENCE_THRESHOLD, 0.6),

  // Storage
  databasePath: resolveFromServer(env.DATABASE_PATH || './data/civiclens.db'),
  uploadDir: resolveFromServer(env.UPLOAD_DIR || './data/uploads'),
  maxUploadBytes: num(env.MAX_UPLOAD_MB, 8) * 1024 * 1024,

  // Security
  corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  adminToken: env.ADMIN_TOKEN || '',
  rateLimit: {
    windowMs: num(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: num(env.RATE_LIMIT_MAX, 300),
    reportMax: num(env.REPORT_RATE_LIMIT_MAX, 20),
    contactMax: num(env.CONTACT_RATE_LIMIT_MAX, 5),
  },
  trustProxy: bool(env.TRUST_PROXY, false),

  // Reverse geocoding via OpenStreetMap Nominatim (free; respects 1 req/s policy)
  geocoding: {
    enabled: bool(env.GEOCODING_ENABLED, true),
    userAgent: env.GEOCODING_USER_AGENT || 'CivicLens/1.0 (civic issue reporting app)',
  },


  clientDist: path.join(PROJECT_ROOT, 'client', 'dist'),
};

/** Resolved AI mode for this process: "gemini" or "development". */
export function resolveAiMode() {
  const { mode, apiKey } = config.gemini;
  if (mode === 'development') return 'development';
  if (mode === 'gemini') return 'gemini';
  return apiKey ? 'gemini' : 'development';
}
