import { getDb, clean, nowIso } from '../db/index.js';

export function upsertDuplicateLink({ reportId, candidateId, distanceM, imageSimilarity, textSimilarity, likelihood, reason }) {
  getDb()
    .prepare(
      `INSERT INTO duplicate_links (report_id, candidate_report_id, distance_m, image_similarity, text_similarity, likelihood, reason)
       VALUES (:rid, :cid, :dist, :img, :txt, :lik, :reason)
       ON CONFLICT(report_id, candidate_report_id) DO UPDATE SET distance_m = excluded.distance_m, image_similarity = excluded.image_similarity,
         text_similarity = excluded.text_similarity, likelihood = excluded.likelihood, reason = excluded.reason`,
    )
    .run(clean({ rid: reportId, cid: candidateId, dist: distanceM, img: imageSimilarity, txt: textSimilarity, lik: likelihood, reason }));
}

const LINK_SELECT = `
  SELECT d.*, r.reference AS candidate_reference, r.category AS candidate_category, r.ai_description AS candidate_description,
         r.status AS candidate_status, r.created_at AS candidate_created_at, r.is_demo AS candidate_is_demo,
         (SELECT filename FROM report_images i WHERE i.report_id = r.id ORDER BY i.id LIMIT 1) AS candidate_image
  FROM duplicate_links d JOIN reports r ON r.id = d.candidate_report_id`;

/** Links where this report is the newer report (it points to older candidates). */
export function getDuplicatesForReport(reportId) {
  return getDb().prepare(`${LINK_SELECT} WHERE d.report_id = ? ORDER BY d.distance_m`).all(reportId);
}

/** Links where a newer report points at this one. */
export function getReportsDuplicatingThis(reportId) {
  return getDb()
    .prepare(
      `SELECT d.*, r.reference AS source_reference, r.category AS source_category, r.created_at AS source_created_at
       FROM duplicate_links d JOIN reports r ON r.id = d.report_id WHERE d.candidate_report_id = ? ORDER BY d.created_at DESC`,
    )
    .all(reportId);
}

/** Duplicate groups: one group per report that has suggested/approved links. */
export function listDuplicateGroups({ status } = {}) {
  const db = getDb();
  const params = {};
  let filter = '';
  if (status) {
    filter = 'WHERE d.status = :status';
    params.status = status;
  }
  const links = db
    .prepare(
      `SELECT d.*, s.reference AS source_reference, s.category AS source_category, s.latitude AS source_lat, s.longitude AS source_lon,
              s.priority AS source_priority, s.is_demo AS source_is_demo,
              c.reference AS candidate_reference, c.category AS candidate_category, c.latitude AS candidate_lat, c.longitude AS candidate_lon
       FROM duplicate_links d JOIN reports s ON s.id = d.report_id JOIN reports c ON c.id = d.candidate_report_id ${filter}
       ORDER BY d.created_at DESC`,
    )
    .all(params);
  const groups = new Map();
  for (const l of links) {
    if (!groups.has(l.report_id)) {
      groups.set(l.report_id, {
        report_id: l.report_id,
        reference: l.source_reference,
        category: l.source_category,
        priority: l.source_priority,
        is_demo: !!l.source_is_demo,
        latitude: l.source_lat,
        longitude: l.source_lon,
        links: [],
      });
    }
    groups.get(l.report_id).links.push(l);
  }
  return [...groups.values()];
}

export function getLink(id) {
  return getDb().prepare('SELECT * FROM duplicate_links WHERE id = ?').get(id);
}

export function reviewLinks(reportId, decision, note, linkIds) {
  const db = getDb();
  const ts = nowIso();
  if (linkIds?.length) {
    const stmt = db.prepare('UPDATE duplicate_links SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ? AND report_id = ?');
    for (const lid of linkIds) stmt.run(decision, note || null, ts, lid, reportId);
  } else {
    db.prepare('UPDATE duplicate_links SET status = ?, review_note = ?, reviewed_at = ? WHERE report_id = ?').run(decision, note || null, ts, reportId);
  }
  return getDuplicatesForReport(reportId);
}
