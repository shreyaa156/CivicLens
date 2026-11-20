import { GoogleGenAI } from '@google/genai';
import { config, resolveAiMode } from '../config/index.js';
import { createDevelopmentClient } from './devModel.js';

/**
 * A "model client" exposes:
 *   mode:  'gemini' | 'development'
 *   model: model name used for the run
 *   generateContent({ contents, config }) -> response with `.functionCalls` and `.candidates`
 *
 * Gemini mode wraps the official @google/genai SDK with timeouts and retries.
 * Development mode is a deterministic stand-in that speaks the same protocol (function calls),
 * so the exact same agent loops, tools and validation run. It is always labelled as development mode.
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  if (typeof err.status === 'number') return RETRYABLE_STATUS.has(err.status);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|overloaded|unavailable/i.test(err.message || '');
}

export async function withRetries(fn, { retries = config.gemini.maxRetries, baseDelayMs = 800, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      attempt++;
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 200);
      onRetry?.(err, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

const isTimeout = (err) => err?.name === 'AbortError' || err?.name === 'TimeoutError';
/** Capacity problems (overloaded / rate-limited / timed out) justify switching to a fallback model. */
export const isCapacityError = (err) => isTimeout(err) || [429, 500, 503, 504].includes(err?.status);

/**
 * Wrap a raw SDK-like `models` object (real or fake) into a model client with retries and
 * model fallback. The primary model is tried first; on capacity errors the client moves to the
 * next model in `fallbackModels` and stays on it for the rest of the process ("sticky").
 */
export function createGeminiClient({
  apiKey = config.gemini.apiKey,
  model = config.gemini.model,
  fallbackModels = config.gemini.fallbackModels,
  models,
  retryDelayMs,
  primaryRetryAfterMs = 10 * 60 * 1000,
} = {}) {
  if (!models) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
    models = new GoogleGenAI({ apiKey }).models;
  }
  const chain = [model, ...fallbackModels.filter((m) => m && m !== model)];
  let active = 0;
  let fellBackAt = 0;

  return {
    mode: 'gemini',
    get model() {
      return chain[active];
    },
    async generateContent({ contents, config: genConfig }, { onRetry, onFallback } = {}) {
      // Give the primary model another chance after a cool-down, but only when a new agent
      // conversation starts (never switch models in the middle of one).
      if (active > 0 && contents.length === 1 && Date.now() - fellBackAt > primaryRetryAfterMs) active = 0;
      for (;;) {
        const current = chain[active];
        try {
          return await withRetries(
            () => models.generateContent({ model: current, contents, config: { ...genConfig, abortSignal: AbortSignal.timeout(config.gemini.timeoutMs) } }),
            {
              onRetry,
              // A timed-out model rarely recovers within seconds: skip straight to the fallback if one exists.
              retries: active < chain.length - 1 ? 1 : config.gemini.maxRetries,
              ...(retryDelayMs !== undefined ? { baseDelayMs: retryDelayMs } : {}),
            },
          );
        } catch (err) {
          if (!isCapacityError(err) || active >= chain.length - 1) throw err;
          active++;
          fellBackAt = Date.now();
          onFallback?.(current, chain[active], err);
        }
      }
    },
  };
}

let factoryOverride = null;
let sharedGeminiClient = null;

/** Tests can inject a client factory (mocked Gemini responses). */
export function setModelClientFactory(factory) {
  factoryOverride = factory;
}

export function createModelClient() {
  if (factoryOverride) return factoryOverride();
  if (resolveAiMode() !== 'gemini') return createDevelopmentClient();
  // One shared Gemini client so fallback state carries across reports.
  sharedGeminiClient ||= createGeminiClient();
  return sharedGeminiClient;
}

export function describeAiMode() {
  const mode = resolveAiMode();
  return {
    mode,
    model: mode === 'gemini' ? config.gemini.model : 'development-sample-responses',
    provider: mode === 'gemini' ? 'Google Gemini API' : 'Development mode (deterministic sample responses — not Gemini)',
    geminiKeyConfigured: Boolean(config.gemini.apiKey),
  };
}
