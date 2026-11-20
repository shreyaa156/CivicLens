import { getDb, clean, nowIso } from '../db/index.js';

const COLUMNS = 'id, name, email, subject, message, read_at, created_at';
const mapMessage = (m) => m && { ...m, is_read: !!m.read_at };

export function saveContactMessage({ name, email, subject, message }) {
  const info = getDb()
    .prepare(`INSERT INTO contact_messages (name, email, subject, message, delivery_status) VALUES (:name, :email, :subject, :message, 'stored')`)
    .run(clean({ name, email, subject, message }));
  return Number(info.lastInsertRowid);
}

export function listMessages({ filter = 'all', limit = 200 } = {}) {
  const where = filter === 'unread' ? 'WHERE read_at IS NULL' : filter === 'read' ? 'WHERE read_at IS NOT NULL' : '';
  return getDb()
    .prepare(`SELECT ${COLUMNS} FROM contact_messages ${where} ORDER BY id DESC LIMIT ?`)
    .all(Math.min(Number(limit) || 200, 500))
    .map(mapMessage);
}

export function getMessage(id) {
  return mapMessage(getDb().prepare(`SELECT ${COLUMNS} FROM contact_messages WHERE id = ?`).get(id));
}

export function setMessageRead(id, read) {
  getDb().prepare('UPDATE contact_messages SET read_at = ? WHERE id = ?').run(read ? nowIso() : null, id);
  return getMessage(id);
}

export function deleteMessage(id) {
  return getDb().prepare('DELETE FROM contact_messages WHERE id = ?').run(id).changes > 0;
}

export function messageCounts() {
  return getDb().prepare('SELECT COUNT(*) total, COALESCE(SUM(read_at IS NULL), 0) unread FROM contact_messages').get();
}
