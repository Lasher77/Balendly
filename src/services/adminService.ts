import { db } from '../db/database';
import { dayjs } from '../utils/time';
import { hashPassword, randomToken, verifyPassword } from '../utils/security';

export function hasAdmin(): boolean {
  const row = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  return row.count > 0;
}

export function createAdmin(username: string, password: string) {
  const now = dayjs.utc().toISOString();
  db.prepare('INSERT INTO admins(username, password_hash, created_at) VALUES(?,?,?)')
    .run(username, hashPassword(password), now);
}

export function loginAdmin(username: string, password: string): string | null {
  const admin = db.prepare('SELECT id, password_hash FROM admins WHERE username = ?').get(username) as { id: number; password_hash: string } | undefined;
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return null;
  }
  const sessionId = randomToken(32);
  const expiresAt = dayjs.utc().add(12, 'hour').toISOString();
  db.prepare('INSERT INTO sessions(id, admin_id, expires_at, created_at) VALUES(?,?,?,?)')
    .run(sessionId, admin.id, expiresAt, dayjs.utc().toISOString());
  return sessionId;
}

export function getAdminBySession(sessionId?: string): { id: number; username: string } | null {
  if (!sessionId) return null;
  const now = dayjs.utc().toISOString();
  const row = db.prepare(`
    SELECT a.id, a.username
    FROM sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(sessionId, now) as { id: number; username: string } | undefined;
  return row ?? null;
}
