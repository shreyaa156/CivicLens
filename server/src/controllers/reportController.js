import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config/index.js';
import { CATEGORIES, PRIORITIES, STATUSES } from '../config/domain.js';
import { transaction } from '../db/index.js';
import { AppError } from '../middleware/errors.js';
import { sanitiseText } from '../middleware/security.js';
import { processUpload, saveImage } from '../services/imageService.js';
import { reverseGeocode } from '../services/geocodingService.js';
import { isValidCoordinate } from '../services/geo.js';
import * as Reports from '../models/reportModel.js';
import * as Duplicates from '../models/duplicateModel.js';
import { getLatestRunForReport } from '../models/agentModel.js';
import { processReport, startRun } from '../ai/orchestrator.js';

const coord = (name, min, max) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : Number(v)),
    z.number({ error: (iss) => (iss.input === undefined ? `${name} is required. Share your location or pick it on the map.` : `${name} must be a number`) }).min(min).max(max),
  );

const createSchema = z.object({
  description: z.string().max(1000, 'Description must be 1000 characters or fewer').optional().default(''),
  latitude: coord('Latitude', -90, 90),
  longitude: coord('Longitude', -180, 180),
});

const imageUrl = (filename) => (filename ? `/uploads/${encodeURIComponent(filename)}` : null);

export function presentReport(r) {
  if (!r) return null;
  const { image_filename, ...rest } = r;
  return { ...rest, image_url: imageUrl(image_filename) };
}

export async function createReport(req, res) {
  const body = req.body || {};
  if ((body.latitude === undefined || body.latitude === '') && (body.longitude === undefined || body.longitude === '')) {
    throw new AppError(400, 'LOCATION_REQUIRED', 'Location is required. Allow location access or select the spot on the map.');
  }
  const input = createSchema.parse(body);
  if (!isValidCoordinate(input.latitude, input.longitude)) throw new AppError(400, 'INVALID_LOCATION', 'Coordinates are invalid.');
  if (!req.file) throw new AppError(400, 'IMAGE_REQUIRED', 'Please attach a photograph of the issue.');

  const processed = await processUpload(req.file);
  const geo = await reverseGeocode(input.latitude, input.longitude);
  const filename = await saveImage(processed);

  let reportId;
  try {
    reportId = await transaction(async () => {
      const id = await Reports.createReport({
        citizenDescription: sanitiseText(input.description, 1000),
        latitude: input.latitude,
        longitude: input.longitude,
        area: geo.area,
        address: geo.address,
      });
      await Reports.addImage(id, { ...processed, filename });
      return id;
    });
  } catch (err) {
    await fs.rm(path.join(config.uploadDir, filename), { force: true });
    throw err;
  }

  const { runId, client } = await startRun(reportId);
  const job = processReport(reportId, { client, runId });

  if (req.query.wait === 'true') {
    const outcome = await job;
    return res.status(201).json({ report: await getReportDetail(reportId), runId, outcome });
  }
  job.catch((err) => console.error('[orchestrator] unhandled', err));
  res.status(202).json({ report: presentReport(await Reports.getReportRow(reportId)), runId });
}

export async function getReportDetail(id) {
  const report = await Reports.getReportRow(id);
  if (!report) return null;
  const images = (await Reports.getImages(id)).map((i) => ({ ...i, url: imageUrl(i.filename) }));
  const duplicates = (await Duplicates.getDuplicatesForReport(id)).map((d) => ({ ...d, candidate_image_url: imageUrl(d.candidate_image), candidate_is_demo: !!d.candidate_is_demo }));
  const duplicatedBy = await Duplicates.getReportsDuplicatingThis(id);
  const history = await Reports.getStatusHistory(id);
  const run = await getLatestRunForReport(id);
  return {
    ...report,
    image_url: images[0]?.url || null,
    images,
    duplicates,
    duplicated_by: duplicatedBy,
    history,
    latest_run: run ? { id: run.id, status: run.status, ai_mode: run.ai_mode, model: run.model, started_at: run.started_at, duration_ms: run.duration_ms, final_decision: run.final_decision, error: run.error } : null,
  };
}

const listSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(STATUSES).optional(),
  q: z.string().max(100).optional(),
  demo: z.enum(['include', 'exclude', 'only']).optional(),
  review: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export async function listReports(req, res) {
  const f = listSchema.parse(req.query);
  const reports = (await Reports.listReports({ ...f, reviewOnly: f.review === 'true' })).map(presentReport);
  res.json({ reports, count: reports.length });
}

export async function getReport(req, res) {
  const id = Number(req.params.id);
  const detail = Number.isInteger(id) ? await getReportDetail(id) : null;
  const byRef = !detail ? await Reports.getReportByRef(String(req.params.id)) : null;
  const result = detail || (byRef && (await getReportDetail(byRef.id)));
  if (!result) throw new AppError(404, 'NOT_FOUND', 'Report not found.');
  res.json({ report: result });
}
