import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env';

const resolved = path.resolve(process.cwd(), env.SQLITE_PATH);
fs.mkdirSync(path.dirname(resolved), { recursive: true });

export const db = new Database(resolved);

export function initDb() {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(admin_id) REFERENCES admins(id)
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT,
      refresh_token TEXT,
      expires_at TEXT,
      scope TEXT,
      token_type TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      timezone TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      company TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      start_at_utc TEXT NOT NULL,
      end_at_utc TEXT NOT NULL,
      previous_start_at_utc TEXT,
      previous_end_at_utc TEXT,
      outlook_event_id TEXT,
      reschedule_token TEXT NOT NULL,
      cancel_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_reschedule_token ON bookings(reschedule_token);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_cancel_token ON bookings(cancel_token);
    CREATE INDEX IF NOT EXISTS idx_booking_start ON bookings(start_at_utc);
  `);
}
