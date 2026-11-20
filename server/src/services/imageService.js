import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errors.js';

export const ALLOWED_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Detect real image type from magic bytes (never trust the client-provided mimetype). */
export function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Validate and normalise an uploaded image:
 *  - verifies magic bytes and that sharp can decode it
 *  - auto-rotates, strips metadata (removes EXIF GPS etc.), caps dimensions
 *  - computes a perceptual difference hash (dHash) used for duplicate image similarity
 */
export async function processUpload(file) {
  if (!file?.buffer?.length) throw new AppError(400, 'IMAGE_REQUIRED', 'A photograph of the issue is required.');
  const sniffed = sniffImageType(file.buffer);
  if (!sniffed) throw new AppError(415, 'INVALID_IMAGE', 'Only JPEG, PNG or WebP photographs are accepted.');

  let meta;
  try {
    meta = await sharp(file.buffer, { limitInputPixels: 50_000_000 }).metadata();
  } catch {
    throw new AppError(415, 'INVALID_IMAGE', 'The uploaded file could not be read as an image.');
  }
  if (!meta.width || !meta.height || meta.width < 32 || meta.height < 32) {
    throw new AppError(422, 'IMAGE_TOO_SMALL', 'The photograph is too small to analyse (minimum 32×32 pixels).');
  }

  const normalised = await sharp(file.buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const hash = await computeDHash(normalised.data);
  return {
    buffer: normalised.data,
    mimeType: 'image/jpeg',
    width: normalised.info.width,
    height: normalised.info.height,
    sizeBytes: normalised.data.length,
    hash,
    originalName: sanitiseFilename(file.originalname),
  };
}

export async function saveImage(processed) {
  await fs.mkdir(config.uploadDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
  await fs.writeFile(path.join(config.uploadDir, filename), processed.buffer);
  return filename;
}

export async function readImageBase64(filename) {
  const safe = path.basename(filename);
  const buf = await fs.readFile(path.join(config.uploadDir, safe));
  return buf.toString('base64');
}

/** 64-bit difference hash as 16 hex chars. */
export async function computeDHash(buffer) {
  const { data } = await sharp(buffer).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += data[y * 9 + x] < data[y * 9 + x + 1] ? '1' : '0';
  }
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

/** Similarity 0..1 from hamming distance between two dHashes. */
export function hashSimilarity(a, b) {
  if (!a || !b) return null;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let dist = 0;
  while (x) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return Math.round((1 - dist / 64) * 1000) / 1000;
}

function sanitiseFilename(name = '') {
  return String(name).replace(/[^\w.\- ]+/g, '').slice(0, 120) || 'upload';
}
