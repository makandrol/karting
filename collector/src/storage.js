/**
 * SQLite storage для collector'а
 *
 * Зберігає:
 * - sessions (заїзди)
 * - events (лог подій для реплеїв)
 * - laps (компактні кола)
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DB_DIR, 'karting.db');

// Ensure data directory exists
mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL mode for better concurrent read/write
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ============================================================
// Create tables
// ============================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    pilot_count INTEGER DEFAULT 0,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    ts INTEGER NOT NULL,
    data TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts);
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

  CREATE TABLE IF NOT EXISTS laps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    pilot TEXT NOT NULL,
    kart INTEGER NOT NULL,
    lap_number INTEGER NOT NULL,
    lap_time TEXT,
    s1 TEXT,
    s2 TEXT,
    best_lap TEXT,
    position INTEGER,
    ts INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_laps_session ON laps(session_id);
  CREATE INDEX IF NOT EXISTS idx_laps_pilot ON laps(pilot);

  CREATE TABLE IF NOT EXISTS db_stats (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    date TEXT NOT NULL,
    path TEXT NOT NULL,
    session_id TEXT,
    user_email TEXT,
    user_name TEXT,
    user_agent TEXT,
    ip TEXT
  );

  CREATE TABLE IF NOT EXISTS visitor_sessions (
    session_id TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    page_count INTEGER DEFAULT 1,
    user_email TEXT,
    user_name TEXT,
    date TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pv_date ON page_views(date);
  CREATE INDEX IF NOT EXISTS idx_pv_email ON page_views(user_email);
  CREATE INDEX IF NOT EXISTS idx_vs_date ON visitor_sessions(date);
`);

// ============================================================
// Prepared statements
// ============================================================

const stmts = {
  insertSession: db.prepare('INSERT OR IGNORE INTO sessions (id, start_time, pilot_count, date) VALUES (?, ?, ?, ?)'),
  endSession: db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?'),
  insertEvent: db.prepare('INSERT INTO events (session_id, event_type, ts, data) VALUES (?, ?, ?, ?)'),
  insertLap: db.prepare('INSERT INTO laps (session_id, pilot, kart, lap_number, lap_time, s1, s2, best_lap, position, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  getSessions: db.prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?'),
  getSessionsByDate: db.prepare('SELECT * FROM sessions WHERE date = ? ORDER BY start_time'),
  getEvents: db.prepare('SELECT * FROM events WHERE session_id = ? AND ts >= ? ORDER BY ts LIMIT 10000'),
  getAllEvents: db.prepare('SELECT * FROM events WHERE ts >= ? ORDER BY ts LIMIT 10000'),
  getLaps: db.prepare('SELECT * FROM laps WHERE session_id = ? ORDER BY ts'),
  getDbSize: db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()"),
  countEvents: db.prepare('SELECT COUNT(*) as cnt FROM events'),
  countLaps: db.prepare('SELECT COUNT(*) as cnt FROM laps'),
  countSessions: db.prepare('SELECT COUNT(*) as cnt FROM sessions'),
  // Cleanup: delete poll_ok events older than N days (keep laps/snapshots)
  cleanupOldPolls: db.prepare("DELETE FROM events WHERE event_type = 'poll_ok' AND ts < ?"),
  // Cleanup: delete all events older than N days for non-competition sessions
  cleanupOldEvents: db.prepare("DELETE FROM events WHERE ts < ? AND event_type NOT IN ('lap', 's1', 'snapshot')"),
  // Analytics
  insertPageView: db.prepare('INSERT INTO page_views (ts, date, path, session_id, user_email, user_name, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  upsertVisitorSession: db.prepare(`INSERT INTO visitor_sessions (session_id, first_seen, last_seen, page_count, user_email, user_name, date) 
    VALUES (?, ?, ?, 1, ?, ?, ?) 
    ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen, page_count = page_count + CASE WHEN excluded.page_count > 0 THEN 1 ELSE 0 END, 
    user_email = COALESCE(excluded.user_email, user_email), user_name = COALESCE(excluded.user_name, user_name)`),
  updateVisitorHeartbeat: db.prepare('UPDATE visitor_sessions SET last_seen = ? WHERE session_id = ?'),
  getPageViewsByDate: db.prepare('SELECT date, COUNT(*) as views, COUNT(DISTINCT user_email) as users, COUNT(DISTINCT session_id) as unique_sessions FROM page_views WHERE date >= ? GROUP BY date ORDER BY date'),
  getPageViewsByPath: db.prepare('SELECT path, COUNT(*) as views FROM page_views WHERE date >= ? GROUP BY path ORDER BY views DESC LIMIT 20'),
  getRecentUsers: db.prepare("SELECT DISTINCT user_email, user_name, MAX(ts) as last_seen FROM page_views WHERE user_email IS NOT NULL AND user_email != '' GROUP BY user_email ORDER BY last_seen DESC LIMIT 50"),
  getTotalPageViews: db.prepare('SELECT COUNT(*) as cnt FROM page_views'),
  getVisitorSessions: db.prepare('SELECT *, (last_seen - first_seen) / 1000 as duration_sec FROM visitor_sessions WHERE date >= ? ORDER BY last_seen DESC LIMIT 100'),
};

// ============================================================
// Public API
// ============================================================

export const storage = {
  /** Створити нову сесію */
  createSession(id, startTime, pilotCount) {
    const date = new Date(startTime).toISOString().split('T')[0];
    stmts.insertSession.run(id, startTime, pilotCount, date);
  },

  /** Завершити сесію */
  endSession(id, endTime) {
    stmts.endSession.run(endTime, id);
  },

  /** Записати подію */
  addEvent(sessionId, type, ts, data) {
    stmts.insertEvent.run(sessionId, type, ts, data ? JSON.stringify(data) : null);
  },

  /** Записати коло */
  addLap(sessionId, lap) {
    stmts.insertLap.run(
      sessionId, lap.pilot, lap.kart, lap.lapNumber,
      lap.lastLap, lap.s1, lap.s2, lap.bestLap, lap.position, lap.ts
    );
  },

  /** Отримати список сесій */
  getSessions(limit = 50) {
    return stmts.getSessions.all(limit);
  },

  /** Отримати сесії за дату */
  getSessionsByDate(date) {
    return stmts.getSessionsByDate.all(date);
  },

  /** Отримати події */
  getEvents(sessionId, since = 0) {
    if (sessionId) {
      return stmts.getEvents.all(sessionId, since).map(r => ({
        ...r, data: r.data ? JSON.parse(r.data) : null
      }));
    }
    return stmts.getAllEvents.all(since).map(r => ({
      ...r, data: r.data ? JSON.parse(r.data) : null
    }));
  },

  /** Отримати кола за сесію */
  getLaps(sessionId) {
    return stmts.getLaps.all(sessionId);
  },

  /** Статистика БД */
  getStats() {
    const sizeRow = stmts.getDbSize.get();
    return {
      dbPath: DB_PATH,
      dbSizeBytes: sizeRow?.size || 0,
      dbSizeMB: ((sizeRow?.size || 0) / 1024 / 1024).toFixed(2),
      totalEvents: stmts.countEvents.get()?.cnt || 0,
      totalLaps: stmts.countLaps.get()?.cnt || 0,
      totalSessions: stmts.countSessions.get()?.cnt || 0,
    };
  },

  /** Очистити старі poll_ok події (залишити лише N днів) */
  cleanupPolls(daysToKeep = 10) {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const result = stmts.cleanupOldPolls.run(cutoff);
    return result.changes;
  },

  /** Записати аналітику (pageview або heartbeat) */
  trackPageView(data) {
    const now = Date.now();
    const date = new Date(now).toISOString().split('T')[0];
    const sid = data.sessionId || null;

    if (data.type === 'heartbeat') {
      // Just update last_seen
      if (sid) stmts.updateVisitorHeartbeat.run(now, sid);
      return;
    }

    // Page view
    stmts.insertPageView.run(now, date, data.path || '/', sid, data.email || null, data.name || null, data.userAgent || null, data.ip || null);

    // Upsert visitor session
    if (sid) {
      stmts.upsertVisitorSession.run(sid, now, now, data.email || null, data.name || null, date);
    }
  },

  /** Отримати аналітику за N днів */
  getAnalytics(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sessions = stmts.getVisitorSessions.all(since);
    return {
      byDate: stmts.getPageViewsByDate.all(since),
      byPath: stmts.getPageViewsByPath.all(since),
      recentUsers: stmts.getRecentUsers.all(),
      totalPageViews: stmts.getTotalPageViews.get()?.cnt || 0,
      visitorSessions: sessions.map(s => ({
        ...s,
        durationMin: Math.round((s.duration_sec || 0) / 60 * 10) / 10,
      })),
    };
  },

  /** Закрити БД */
  close() {
    db.close();
  },
};

console.log(`💾 SQLite DB: ${DB_PATH}`);
