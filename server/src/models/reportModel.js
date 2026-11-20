import crypto from 'node:crypto';
import { getDb, clean, nowIso } from '../db/index.js';
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

export function createReport({ citizenDescription, latitude, longitude, area, address, isDemo = false, createdAt }) {
  const db = getDb();
  const ts = createdAt || nowIso();
  const info = db
    .prepare(
      `INSERT INTO reports (reference, citizen_description, latitude, longitude, area, address, is_demo, status, analysis_status, created_at, updated_at)
       VALUES (:reference, :desc, :lat, :lon, :area, :address, :demo, 'submitted', 'pending', :ts, :ts)`,
    )
    .run(clean({ reference: generateReference(isDemo), desc: citizenDescription || '', lat: latitude, lon: longitude, area, address, demo: isDemo, ts }));
  const id = Number(info.lastInsertRowid);
  db.prepare(`INSERT INTO status_history (report_id, from_status, to_status, note, changed_by, created_at) VALUES (?, NULL, 'submitted', 'Report submitted by citizen', 'citizen', ?)`).run(id, ts);
  return id;
}

const ANALYSIS_FIELDS = [
  'category', 'ai_description', 'severity', 'confidence', 'image_assessment', 'priority', 'department',
  'recommended_action', 'priority_explanation', 'duplicate_summary', 'needs_human_review', 'review_reasons',
  'analysis_status', 'ai_mode', 'status', 'area', 'address',
];

export function updateReport(id, fields) {
  const entries = Object.entries(fields).filter(([k]) => ANALYSIS_FIELDS.includes(k));
  if (!entries.length) return;
  const params = {};
  const sets = entries.map(([k, v]) => {
    params[k] = k === 'review_reasons' ? JSON.stringify(v ?? []) : v;
    return `${k} = :${k}`;
  });
  params.id = id;
  params.updated_at = nowIso();
  getDb().prepare(`UPDATE reports SET ${sets.join(', ')}, updated_at = :updated_at WHERE id = :id`).run(clean(params));
}

export function getReportRow(id) {
  return mapReport(getDb().prepare('SELECT * FROM reports WHERE id = ?').get(id));
}

export function getReportByRef(ref) {
  return mapReport(getDb().prepare('SELECT * FROM reports WHERE reference = ?').get(ref));
}

export function addImage(reportId, img) {
  getDb()
    .prepare(
      `INSERT INTO report_images (report_id, filename, original_name, mime_type, size_bytes, width, height, image_hash)
       VALUES (:rid, :filename, :orig, :mime, :size, :w, :h, :hash)`,
    )
    .run(clean({ rid: reportId, filename: img.filename, orig: img.originalName, mime: img.mimeType, size: img.sizeBytes, w: img.width, h: img.height, hash: img.hash }));
}

export function getImages(reportId) {
  return getDb().prepare('SELECT id, filename, original_name, mime_type, size_bytes, width, height, image_hash, created_at FROM report_images WHERE report_id = ? ORDER BY id').all(reportId);
}

/** Primary image hash per report id. */
export function getImageHashes(ids) {
  if (!ids.length) return {};
  const rows = getDb()
    .prepare(`SELECT report_id, image_hash FROM report_images WHERE report_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);
  const out = {};
  for (const r of rows) if (!(r.report_id in out)) out[r.report_id] = r.image_hash;
  return out;
}

/**
 * Real database search: reports within radiusM of (lat, lon) using an indexed bounding box
 * pre-filter followed by exact haversine distance.
 */
export function findNearbyReports({ latitude, longitude, radiusM, excludeId, category, lookbackDays, includeDemo = true }) {
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
  const rows = getDb().prepare(sql).all(clean(params));
  return rows
    .map((r) => ({ ...mapReport(r), distance_m: Math.round(haversineMeters(latitude, longitude, r.latitude, r.longitude) * 10) / 10 }))
    .filter((r) => r.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m);
}

export function listReports({ category, priority, status, q, demo = 'include', reviewOnly, limit = 500, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (category) { where.push('r.category = :category'); params.category = category; }
  if (priority) { where.push('r.priority = :priority'); params.priority = priority; }
  if (status) { where.push('r.status = :status'); params.status = status; }
  if (reviewOnly) where.push('r.needs_human_review = 1');
  if (demo === 'exclude') where.push('r.is_demo = 0');
  if (demo === 'only') where.push('r.is_demo = 1');
  if (q) {
    where.push('(r.reference LIKE :q OR r.citizen_description LIKE :q OR r.ai_description LIKE :q OR r.area LIKE :q OR r.address LIKE :q)');
    params.q = `%${q}%`;
  }
  params.limit = Math.min(Number(limit) || 500, 1000);
  params.offset = Number(offset) || 0;
  const sql = `
    SELECT r.*,
      (SELECT filename FROM report_images i WHERE i.report_id = r.id ORDER BY i.id LIMIT 1) AS image_filename,
      (SELECT COUNT(*) FROM duplicate_links d WHERE (d.report_id = r.id OR d.candidate_report_id = r.id) AND d.status != 'rejected') AS duplicate_count
    FROM reports r ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.created_at DESC LIMIT :limit OFFSET :offset`;
  return getDb().prepare(sql).all(params).map(mapReport);
}

// ---------- status history & notes ----------

export function changeStatus(id, toStatus, { note, changedBy = 'admin' } = {}) {
  const db = getDb();
  const current = db.prepare('SELECT status FROM reports WHERE id = ?').get(id);
  if (!current) return null;
  const ts = nowIso();
  db.prepare('UPDATE reports SET status = ?, updated_at = ? WHERE id = ?').run(toStatus, ts, id);
  db.prepare('INSERT INTO status_history (report_id, from_status, to_status, note, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, current.status, toStatus, note || null, changedBy, ts,
  );
  return { from: current.status, to: toStatus };
}

export function getStatusHistory(id) {
  return getDb().prepare('SELECT * FROM status_history WHERE report_id = ? ORDER BY id').all(id);
}

export function addNote(id, note, author = 'admin') {
  const info = getDb().prepare('INSERT INTO admin_notes (report_id, note, author) VALUES (?, ?, ?)').run(id, note, author);
  return getDb().prepare('SELECT * FROM admin_notes WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function getNotes(id) {
  return getDb().prepare('SELECT * FROM admin_notes WHERE report_id = ? ORDER BY id DESC').all(id);
}

export function setHumanReview(id, flag, reason) {
  const report = getReportRow(id);
  if (!report) return null;
  const reasons = new Set(report.review_reasons);
  if (flag && reason) reasons.add(reason);
  updateReport(id, { needs_human_review: flag ? 1 : 0, review_reasons: flag ? [...reasons] : [] });
  return getReportRow(id);
}
