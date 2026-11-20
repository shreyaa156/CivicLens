import crypto from 'node:crypto';
import { all, get, run, nowIso } from '../db/index.js';
import { boundingBox, haversineMeters } from '../services/geo.js';

const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

export function mapReport(row) {
  if (!row) return null;
  return {
    ...row,
    needs_human_review: !!row.needs_human_review,
    is_demo: !!row.is_demo,
    review_reasons: parseJson(row.review_reasons, []),
  };
}

export function generateReference(isDemo = false) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `${isDemo ? 'DEMO' : 'CL'}-${code}`;
}

export async function createReport({ citizenDescription, latitude, longitude, area, address, isDemo = false, createdAt }) {
  const ts = createdAt || nowIso();
  const { insertId: id } = await run(
    `INSERT INTO reports (reference, citizen_description, latitude, longitude, area, address, is_demo, review_reasons, status, analysis_status, created_at, updated_at)
     VALUES (:reference, :descr, :lat, :lon, :area, :address, :demo, '[]', 'submitted', 'pending', :ts, :ts2)`,
    { reference: generateReference(isDemo), descr: citizenDescription || '', lat: latitude, lon: longitude, area, address, demo: isDemo, ts, ts2: ts },
  );
  await run(
    `INSERT INTO status_history (report_id, from_status, to_status, note, changed_by, created_at) VALUES (?, NULL, 'submitted', 'Report submitted by citizen', 'citizen', ?)`,
    [id, ts],
  );
  return id;
}

const ANALYSIS_FIELDS = [
  'category', 'ai_description', 'severity', 'confidence', 'image_assessment', 'priority', 'department',
  'recommended_action', 'priority_explanation', 'duplicate_summary', 'needs_human_review', 'review_reasons',
  'analysis_status', 'ai_mode', 'status', 'area', 'address',
];

export async function updateReport(id, fields) {
  const entries = Object.entries(fields).filter(([k]) => ANALYSIS_FIELDS.includes(k));
  if (!entries.length) return;
  const params = {};
  const sets = entries.map(([k, v]) => {
    params[k] = k === 'review_reasons' ? JSON.stringify(v ?? []) : v;
    return `${k} = :${k}`;
  });
  params.id = id;
  params.updated_at = nowIso();
  await run(`UPDATE reports SET ${sets.join(', ')}, updated_at = :updated_at WHERE id = :id`, params);
}

export async function getReportRow(id) {
  return mapReport(await get('SELECT * FROM reports WHERE id = ?', [id]));
}

export async function getReportByRef(ref) {
  return mapReport(await get('SELECT * FROM reports WHERE reference = ?', [ref]));
}

export async function addImage(reportId, img) {
  await run(
    `INSERT INTO report_images (report_id, filename, original_name, mime_type, size_bytes, width, height, image_hash, created_at)
     VALUES (:rid, :filename, :orig, :mime, :size, :w, :h, :hash, :ts)`,
    { rid: reportId, filename: img.filename, orig: img.originalName, mime: img.mimeType, size: img.sizeBytes, w: img.width, h: img.height, hash: img.hash, ts: nowIso() },
  );
}

export async function getImages(reportId) {
  return all('SELECT id, filename, original_name, mime_type, size_bytes, width, height, image_hash, created_at FROM report_images WHERE report_id = ? ORDER BY id', [reportId]);
}

/** Primary image hash per report id. */
export async function getImageHashes(ids) {
  if (!ids.length) return {};
  const rows = await all(`SELECT report_id, image_hash FROM report_images WHERE report_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
  const out = {};
  for (const r of rows) if (!(r.report_id in out)) out[r.report_id] = r.image_hash;
  return out;
}

/**
 * Real database search: reports within radiusM of (lat, lon) using an indexed bounding box
 * pre-filter followed by exact haversine distance.
 */
export async function findNearbyReports({ latitude, longitude, radiusM, excludeId, category, lookbackDays, includeDemo = true }) {
  const box = boundingBox(latitude, longitude, radiusM);
  const params = { ...box, exclude: excludeId ?? -1 };
  let sql = `SELECT * FROM reports WHERE latitude BETWEEN :minLat AND :maxLat AND longitude BETWEEN :minLon AND :maxLon AND id != :exclude AND status NOT IN ('rejected')`;
  if (category) {
    sql += ' AND category = :category';
    params.category = category;
  }
  if (lookbackDays) {
    sql += ' AND created_at >= :since';
    params.since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  }
  if (!includeDemo) sql += ' AND is_demo = 0';
  const rows = await all(sql, params);
  return rows
    .map((r) => ({ ...mapReport(r), distance_m: Math.round(haversineMeters(latitude, longitude, r.latitude, r.longitude) * 10) / 10 }))
    .filter((r) => r.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m);
}

export async function listReports({ category, priority, status, q, demo = 'include', reviewOnly, limit = 500, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (category) { where.push('r.category = :category'); params.category = category; }
  if (priority) { where.push('r.priority = :priority'); params.priority = priority; }
  if (status) { where.push('r.status = :status'); params.status = status; }
  if (reviewOnly) where.push('r.needs_human_review = 1');
  if (demo === 'exclude') where.push('r.is_demo = 0');
  if (demo === 'only') where.push('r.is_demo = 1');
  if (q) {
    where.push('(r.reference LIKE :q1 OR r.citizen_description LIKE :q2 OR r.ai_description LIKE :q3 OR r.area LIKE :q4 OR r.address LIKE :q5)');
    for (const k of ['q1', 'q2', 'q3', 'q4', 'q5']) params[k] = `%${q}%`;
  }
  const lim = Math.min(Number(limit) || 500, 1000);
  const off = Math.max(Number(offset) || 0, 0);
  const sql = `
    SELECT r.*,
      (SELECT filename FROM report_images i WHERE i.report_id = r.id ORDER BY i.id LIMIT 1) AS image_filename,
      (SELECT COUNT(*) FROM duplicate_links d WHERE (d.report_id = r.id OR d.candidate_report_id = r.id) AND d.status != 'rejected') AS duplicate_count
    FROM reports r ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.created_at DESC LIMIT ${lim} OFFSET ${off}`;
  return (await all(sql, params)).map(mapReport);
}

// ---------- status history & notes ----------

export async function changeStatus(id, toStatus, { note, changedBy = 'admin' } = {}) {
  const current = await get('SELECT status FROM reports WHERE id = ?', [id]);
  if (!current) return null;
  const ts = nowIso();
  await run('UPDATE reports SET status = ?, updated_at = ? WHERE id = ?', [toStatus, ts, id]);
  await run('INSERT INTO status_history (report_id, from_status, to_status, note, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, current.status, toStatus, note || null, changedBy, ts,
  ]);
  return { from: current.status, to: toStatus };
}

export async function getStatusHistory(id) {
  return all('SELECT * FROM status_history WHERE report_id = ? ORDER BY id', [id]);
}

export async function addNote(id, note, author = 'admin') {
  const { insertId } = await run('INSERT INTO admin_notes (report_id, note, author, created_at) VALUES (?, ?, ?, ?)', [id, note, author, nowIso()]);
  return get('SELECT * FROM admin_notes WHERE id = ?', [insertId]);
}

export async function getNotes(id) {
  return all('SELECT * FROM admin_notes WHERE report_id = ? ORDER BY id DESC', [id]);
}

export async function setHumanReview(id, flag, reason) {
  const report = await getReportRow(id);
  if (!report) return null;
  const reasons = new Set(report.review_reasons);
  if (flag && reason) reasons.add(reason);
  await updateReport(id, { needs_human_review: flag ? 1 : 0, review_reasons: flag ? [...reasons] : [] });
  return getReportRow(id);
}
