import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { AppError } from './errors.js';

const limiter = (max, message) =>
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message } }),
  });

export const apiLimiter = limiter(config.rateLimit.max, 'Too many requests. Please slow down.');
export const reportLimiter = limiter(config.rateLimit.reportMax, 'Too many reports submitted. Please try again later.');
export const contactLimiter = limiter(config.rateLimit.contactMax, 'Too many messages. Please try again later.');

/** Memory storage: images are validated, re-encoded and only then written to disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(new AppError(415, 'INVALID_IMAGE', 'Only JPEG, PNG or WebP photographs are accepted.'));
    }
    cb(null, true);
  },
});

/**
 * Admin protection. If ADMIN_TOKEN is set, admin endpoints require `Authorization: Bearer <token>`.
 * In production an ADMIN_TOKEN is mandatory; in development it is optional for convenience.
 */
export function requireAdmin(req, res, next) {
  const expected = config.adminToken;
  if (!expected) {
    if (config.isProduction) return next(new AppError(503, 'ADMIN_NOT_CONFIGURED', 'Admin access is disabled until ADMIN_TOKEN is configured.'));
    return next();
  }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Admin token required.'));
  }
  next();
}

/** Strip control characters and trim; React escapes output, this keeps stored data tidy. */
export function sanitiseText(value, max = 2000) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, max);
}
