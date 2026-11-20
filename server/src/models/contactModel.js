import { all, get, run, nowIso } from '../db/index.js';

const COLUMNS = 'id, name, email, subject, message, read_at, created_at';
const mapMessage = (m) => m && { ...m, is_read: !!m.read_at };

export async function saveContactMessage({ name, email, subject, message }) {
  const { insertId } = await run(
    `INSERT INTO contact_messages (name, email, subject, message, delivery_status, created_at) VALUES (:name, :email, :subject, :message, 'stored', :ts)`,
    { name, email, subject, message, ts: nowIso() },
  );
  return insertId;
}

export async function listMessages({ filter = 'all', limit = 200 } = {}) {
  const where = filter === 'unread' ? 'WHERE read_at IS NULL' : filter === 'read' ? 'WHERE read_at IS NOT NULL' : '';
  const lim = Math.min(Number(limit) || 200, 500);
  return (await all(`SELECT ${COLUMNS} FROM contact_messages ${where} ORDER BY id DESC LIMIT ${lim}`)).map(mapMessage);
}

export async function getMessage(id) {
  return mapMessage(await get(`SELECT ${COLUMNS} FROM contact_messages WHERE id = ?`, [id]));
}

export async function setMessageRead(id, read) {
  await run('UPDATE contact_messages SET read_at = ? WHERE id = ?', [read ? nowIso() : null, id]);
  return getMessage(id);
}

export async function deleteMessage(id) {
  return (await run('DELETE FROM contact_messages WHERE id = ?', [id])).changes > 0;
}

export async function messageCounts() {
  const row = await get('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread FROM contact_messages');
  return { total: Number(row.total), unread: Number(row.unread) };
}
