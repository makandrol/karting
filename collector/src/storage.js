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
    track_id INTEGER DEFAULT 1,
    race_number INTEGER,
    is_race INTEGER DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    format TEXT,
    date TEXT,
    sessions TEXT NOT NULL DEFAULT '[]',
    results TEXT,
    uploaded_results TEXT,
    status TEXT NOT NULL DEFAULT 'live'
  );
`);

// Migrations for existing databases
try { db.exec('ALTER TABLE sessions ADD COLUMN track_id INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN race_number INTEGER'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN is_race INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE competitions ADD COLUMN status TEXT NOT NULL DEFAULT \'live\''); } catch {}

// ============================================================
// Current track (persisted across restarts)
// ============================================================

let _currentTrackId = 1;
try {
  const row = db.prepare('SELECT value FROM db_stats WHERE key = ?').get('current_track_id');
  if (row?.value) _currentTrackId = parseInt(row.value) || 1;
} catch {}

// ============================================================
// Prepared statements
// ============================================================

const MIN_LAP_SEC = 38;
const LAP_SEC_EXPR = `CASE WHEN lap_time LIKE '%:%' THEN CAST(SUBSTR(lap_time, 1, INSTR(lap_time, ':') - 1) AS REAL) * 60 + CAST(SUBSTR(lap_time, INSTR(lap_time, ':') + 1) AS REAL) ELSE CAST(lap_time AS REAL) END`;
const LAP_SEC_EXPR_L2 = LAP_SEC_EXPR.replace(/lap_time/g, 'l2.lap_time');
const LAP_SEC_EXPR_L = LAP_SEC_EXPR.replace(/lap_time/g, 'l.lap_time');
const VALID_LAP = `lap_time IS NOT NULL AND (${LAP_SEC_EXPR}) >= ${MIN_LAP_SEC}`;
const VALID_LAP_L2 = `l2.lap_time IS NOT NULL AND (${LAP_SEC_EXPR_L2}) >= ${MIN_LAP_SEC}`;
const VALID_LAP_L = `l.lap_time IS NOT NULL AND (${LAP_SEC_EXPR_L}) >= ${MIN_LAP_SEC}`;

const stmts = {
  insertSession: db.prepare('INSERT OR IGNORE INTO sessions (id, start_time, pilot_count, track_id, race_number, is_race, date) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  endSession: db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?'),
  insertEvent: db.prepare('INSERT INTO events (session_id, event_type, ts, data) VALUES (?, ?, ?, ?)'),
  insertLap: db.prepare('INSERT INTO laps (session_id, pilot, kart, lap_number, lap_time, s1, s2, best_lap, position, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  getSessions: db.prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?'),
  getSessionsByDate: db.prepare('SELECT * FROM sessions WHERE date = ? ORDER BY start_time'),
  getSessionsWithStats: db.prepare(`
    SELECT s.*,
      ls.real_pilot_count,
      ls.best_lap_time
    FROM sessions s
    LEFT JOIN (
      SELECT session_id,
        COUNT(DISTINCT pilot) as real_pilot_count,
        (SELECT l2.lap_time FROM laps l2 WHERE l2.session_id = laps.session_id AND ${VALID_LAP_L2}
          ORDER BY (${LAP_SEC_EXPR_L2}) ASC LIMIT 1
        ) as best_lap_time
      FROM laps
      WHERE ${VALID_LAP}
      GROUP BY session_id
    ) ls ON ls.session_id = s.id
    WHERE s.date = ?
    ORDER BY s.start_time
  `),
  getBestLapPilot: db.prepare(`
    SELECT pilot, kart FROM laps
    WHERE session_id = ? AND lap_time = ?
    LIMIT 1
  `),
  getEvents: db.prepare('SELECT * FROM events WHERE session_id = ? AND ts >= ? ORDER BY ts LIMIT 10000'),
  getSessionCountsByDateRange: db.prepare('SELECT date, COUNT(*) as count FROM sessions WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date'),
  getKartStats: db.prepare(`
    SELECT l.kart, l.pilot, l.lap_time, l.ts,
      (${LAP_SEC_EXPR_L}) as lap_sec
    FROM laps l
    JOIN sessions s ON s.id = l.session_id
    WHERE s.date >= ? AND s.date <= ? AND ${VALID_LAP_L}
    ORDER BY l.kart, lap_sec
  `),
  getKartStatsBySessions: db.prepare(`
    SELECT kart, pilot, lap_time, ts,
      (${LAP_SEC_EXPR}) as lap_sec
    FROM laps
    WHERE ${VALID_LAP}
    ORDER BY kart, lap_sec
  `),
  getAllEvents: db.prepare('SELECT * FROM events WHERE ts >= ? ORDER BY ts LIMIT 10000'),
  getLaps: db.prepare('SELECT * FROM laps WHERE session_id = ? ORDER BY ts'),
  getLapsByKart: db.prepare(`
    SELECT l.*, s.date, s.start_time as session_start
    FROM laps l JOIN sessions s ON s.id = l.session_id
    WHERE l.kart = ? AND s.date >= ? AND s.date <= ? AND ${VALID_LAP_L}
    ORDER BY l.ts
  `),
  getDbSize: db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()"),
  countEvents: db.prepare('SELECT COUNT(*) as cnt FROM events'),
  countLaps: db.prepare('SELECT COUNT(*) as cnt FROM laps'),
  countSessions: db.prepare('SELECT COUNT(*) as cnt FROM sessions'),
  getRecentSessions: db.prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?'),
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
  // System state
  getState: db.prepare('SELECT value FROM db_stats WHERE key = ?'),
  setState: db.prepare('INSERT OR REPLACE INTO db_stats (key, value, updated_at) VALUES (?, ?, ?)'),
  // Competitions
  insertCompetition: db.prepare('INSERT INTO competitions (id, name, format, date, sessions, results, uploaded_results, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  updateCompetition: db.prepare('UPDATE competitions SET name = ?, format = ?, date = ?, sessions = ?, results = ?, uploaded_results = ?, status = ? WHERE id = ?'),
  getCompetition: db.prepare('SELECT * FROM competitions WHERE id = ?'),
  getAllCompetitions: db.prepare('SELECT * FROM competitions ORDER BY date DESC'),
  getCompetitionsByFormat: db.prepare('SELECT * FROM competitions WHERE format = ? ORDER BY date DESC'),
  deleteCompetition: db.prepare('DELETE FROM competitions WHERE id = ?'),
};

// ============================================================
// Helpers
// ============================================================

function parseCompetitionRow(row) {
  let sessions = row.sessions ? JSON.parse(row.sessions) : [];
  // Migrate old format: ["session-123"] → [{sessionId: "session-123", phase: null}]
  if (sessions.length > 0 && typeof sessions[0] === 'string') {
    sessions = sessions.map(id => ({ sessionId: id, phase: null }));
  }
  return {
    ...row,
    sessions,
    results: row.results ? JSON.parse(row.results) : null,
    uploaded_results: row.uploaded_results ? JSON.parse(row.uploaded_results) : null,
    status: row.status || 'live',
  };
}

const MERGE_GAP_MS = 5 * 60 * 1000; // 5 minutes

function mergeSessions(sessions) {
  if (sessions.length <= 1) return sessions;
  
  // Group sessions by race_number, merging those within MERGE_GAP_MS
  const result = [];
  const used = new Set();
  
  for (let i = 0; i < sessions.length; i++) {
    if (used.has(i)) continue;
    const current = { ...sessions[i], _merged_ids: [sessions[i].id] };
    used.add(i);
    
    if (current.race_number !== null) {
      // Find all subsequent sessions with same race_number within gap
      for (let j = i + 1; j < sessions.length; j++) {
        if (used.has(j)) continue;
        const s = sessions[j];
        if (s.race_number !== current.race_number) continue;
        const currentEnd = current.end_time || s.start_time; // if no end, assume it ended when next started
        const gap = s.start_time - currentEnd;
        if (gap < 0 || gap >= MERGE_GAP_MS) continue;
        
        // Merge
        current.end_time = s.end_time || current.end_time;
        current.pilot_count = Math.max(current.pilot_count || 0, s.pilot_count || 0);
        if (s.real_pilot_count) {
          current.real_pilot_count = Math.max(current.real_pilot_count || 0, s.real_pilot_count);
          current.pilot_count = current.real_pilot_count;
        }
        if (s.best_lap_time && s.best_lap_pilot) {
          const curSec = parseLapTimeSec(current.best_lap_time);
          const newSec = parseLapTimeSec(s.best_lap_time);
          if (newSec !== null && (curSec === null || newSec < curSec)) {
            current.best_lap_time = s.best_lap_time;
            current.best_lap_pilot = s.best_lap_pilot;
            current.best_lap_kart = s.best_lap_kart;
          }
        }
        current._merged_ids.push(s.id);
        used.add(j);
      }
    }
    
    // Fix stuck live: if no end_time but there's a next session after, close it
    if (!current.end_time) {
      const nextIdx = sessions.findIndex((s, idx) => idx > i && !used.has(idx));
      if (nextIdx >= 0) {
        current.end_time = current.start_time;
      }
    }
    
    result.push(current);
  }
  
  // Sort by start_time (merging may have changed order)
  result.sort((a, b) => a.start_time - b.start_time);

  return result.map(s => {
    const merged = s._merged_ids;
    delete s._merged_ids;
    if (merged.length > 1) s.merged_session_ids = merged;
    return s;
  });
}

function parseLapTimeSec(t) {
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+\.\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  const s = t.match(/^\d+\.\d+$/);
  if (s) return parseFloat(t);
  return null;
}

function buildKartStats(rows) {
  const byKart = new Map();
  for (const r of rows) {
    if (!byKart.has(r.kart)) byKart.set(r.kart, new Map());
    const pilots = byKart.get(r.kart);
    if (!pilots.has(r.pilot) || r.lap_sec < pilots.get(r.pilot).lap_sec) {
      pilots.set(r.pilot, { pilot: r.pilot, lap_time: r.lap_time, lap_sec: r.lap_sec, ts: r.ts || null });
    }
  }
  const result = [];
  for (const [kart, pilots] of byKart) {
    const top5 = [...pilots.values()].sort((a, b) => a.lap_sec - b.lap_sec).slice(0, 5);
    result.push({ kart, top5 });
  }
  return result.sort((a, b) => a.kart - b.kart);
}

// ============================================================
// Public API
// ============================================================

export const storage = {
  /** Створити нову сесію */
  createSession(id, startTime, pilotCount, { trackId, raceNumber, isRace } = {}) {
    const date = new Date(startTime).toISOString().split('T')[0];
    stmts.insertSession.run(id, startTime, pilotCount, trackId ?? _currentTrackId, raceNumber ?? null, isRace ? 1 : 0, date);
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

  /** Отримати останні сесії (для collector log) */
  getRecentSessions(limit = 200) {
    return stmts.getRecentSessions.all(limit);
  },

  /** Отримати сесії за дату (з мержем дублікатів по race_number) */
  getSessionsByDate(date) {
    const rows = stmts.getSessionsWithStats.all(date);
    const compMap = this.getSessionCompetitionMap();
    const enriched = rows.map(r => {
      let best_lap_pilot = null;
      let best_lap_kart = null;
      if (r.best_lap_time) {
        const pilotRow = stmts.getBestLapPilot.get(r.id, r.best_lap_time);
        if (pilotRow) { best_lap_pilot = pilotRow.pilot; best_lap_kart = pilotRow.kart; }
      }
      const comp = compMap.get(r.id) || null;
      return {
        ...r, best_lap_pilot, best_lap_kart,
        pilot_count: r.real_pilot_count || r.pilot_count,
        competition_id: comp?.competitionId || null,
        competition_name: comp?.competitionName || null,
        competition_format: comp?.format || null,
        competition_phase: comp?.phase || null,
        competition_status: comp?.status || null,
      };
    });
    const merged = mergeSessions(enriched);
    return merged.map((s, i) => ({ ...s, day_order: i + 1 }));
  },

  getSessionCounts(fromDate, toDate) {
    const rawCounts = stmts.getSessionCountsByDateRange.all(fromDate, toDate);
    return rawCounts.map(({ date }) => {
      const raw = stmts.getSessionsByDate.all(date);
      const merged = mergeSessions(raw);
      const filtered = merged.filter(s => !s.end_time || (s.end_time - s.start_time) >= 60000);
      return { date, count: filtered.length };
    });
  },

  getKartStats(fromDate, toDate) {
    const rows = stmts.getKartStats.all(fromDate, toDate);
    return buildKartStats(rows);
  },

  getKartStatsBySessions(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) return [];
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT kart, pilot, lap_time, ts,
        (${LAP_SEC_EXPR}) as lap_sec
      FROM laps
      WHERE session_id IN (${placeholders}) AND ${VALID_LAP}
      ORDER BY kart, lap_sec
    `).all(...sessionIds);
    return buildKartStats(rows);
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

  getLapsByKart(kartNumber, fromDate, toDate) {
    return stmts.getLapsByKart.all(kartNumber, fromDate, toDate);
  },

  getKartSessionCounts(kartNumber) {
    const dates = db.prepare('SELECT DISTINCT date FROM sessions ORDER BY date').all().map(r => r.date);
    const result = [];
    for (const date of dates) {
      const sessions = this.getSessionsByDate(date);
      let count = 0;
      for (const s of sessions) {
        if (!s.end_time || (s.end_time - s.start_time) < 60000) continue;
        const ids = s.merged_session_ids || [s.id];
        const placeholders = ids.map(() => '?').join(',');
        const hasKart = db.prepare(`SELECT 1 FROM laps WHERE kart = ? AND session_id IN (${placeholders}) AND ${VALID_LAP} LIMIT 1`).get(kartNumber, ...ids);
        if (hasKart) count++;
      }
      if (count > 0) result.push({ date, count });
    }
    return result;
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
  cleanupPolls(daysToKeep = 5) {
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

  /** Поточний ID треку */
  getCurrentTrackId() { return _currentTrackId; },

  /** Змінити поточний трек */
  setCurrentTrackId(trackId) {
    _currentTrackId = trackId;
    stmts.setState.run('current_track_id', String(trackId), Date.now());
  },

  /** Закрити БД */
  close() {
    db.close();
  },

  /** Отримати системний стан */
  getSystemState(key) {
    const row = stmts.getState.get(key);
    return row?.value || null;
  },

  /** Зберегти системний стан */
  setSystemState(key, value) {
    stmts.setState.run(key, value, Date.now());
  },

  // ============================================================
  // Competitions CRUD
  // ============================================================

  createCompetition({ id, name, format, date, sessions, results, uploaded_results, status }) {
    stmts.insertCompetition.run(
      id, name, format || null, date || null,
      JSON.stringify(sessions || []),
      results ? JSON.stringify(results) : null,
      uploaded_results ? JSON.stringify(uploaded_results) : null,
      status || 'live',
    );
  },

  updateCompetition(id, fields) {
    const existing = stmts.getCompetition.get(id);
    if (!existing) return false;
    const parsed = parseCompetitionRow(existing);
    stmts.updateCompetition.run(
      fields.name ?? parsed.name,
      fields.format !== undefined ? fields.format : parsed.format,
      fields.date !== undefined ? fields.date : parsed.date,
      fields.sessions !== undefined ? JSON.stringify(fields.sessions) : JSON.stringify(parsed.sessions),
      fields.results !== undefined ? JSON.stringify(fields.results) : (parsed.results ? JSON.stringify(parsed.results) : null),
      fields.uploaded_results !== undefined ? JSON.stringify(fields.uploaded_results) : (parsed.uploaded_results ? JSON.stringify(parsed.uploaded_results) : null),
      fields.status !== undefined ? fields.status : (parsed.status || 'live'),
      id,
    );
    return true;
  },

  getCompetition(id) {
    const row = stmts.getCompetition.get(id);
    return row ? parseCompetitionRow(row) : null;
  },

  getCompetitions(format) {
    const rows = format ? stmts.getCompetitionsByFormat.all(format) : stmts.getAllCompetitions.all();
    return rows.map(parseCompetitionRow);
  },

  deleteCompetition(id) {
    return stmts.deleteCompetition.run(id).changes > 0;
  },

  getSessionCompetition(sessionId) {
    const comps = stmts.getAllCompetitions.all();
    for (const row of comps) {
      const comp = parseCompetitionRow(row);
      const entry = comp.sessions.find(s => s.sessionId === sessionId);
      if (entry) return { competitionId: comp.id, competitionName: comp.name, format: comp.format, phase: entry.phase, status: comp.status };
    }
    return null;
  },

  getSessionCompetitionMap() {
    const comps = stmts.getAllCompetitions.all().map(parseCompetitionRow);
    const map = new Map();
    for (const comp of comps) {
      for (const s of comp.sessions) {
        map.set(s.sessionId, { competitionId: comp.id, competitionName: comp.name, format: comp.format, phase: s.phase, status: comp.status });
      }
    }
    return map;
  },

  autoLinkSessionToActiveCompetition(sessionId) {
    const FORMAT_MAX_GROUPS = { gonzales: 1, light_league: 3, champions_league: 2, sprint: 3, marathon: 1 };
    const FULL_PHASES = {
      gonzales: Array.from({ length: 12 }, (_, i) => `round_${i + 1}`),
      light_league: ['qualifying_1', 'qualifying_2', 'qualifying_3', 'qualifying_4', 'race_1_group_3', 'race_1_group_2', 'race_1_group_1', 'race_2_group_3', 'race_2_group_2', 'race_2_group_1'],
      champions_league: ['qualifying_1', 'qualifying_2', 'race_1_group_2', 'race_1_group_1', 'race_2_group_2', 'race_2_group_1', 'race_3_group_2', 'race_3_group_1'],
      sprint: [
        'qualifying_1_group_3', 'qualifying_1_group_2', 'qualifying_1_group_1',
        'race_1_group_3', 'race_1_group_2', 'race_1_group_1',
        'qualifying_2_group_3', 'qualifying_2_group_2', 'qualifying_2_group_1',
        'race_2_group_3', 'race_2_group_2', 'race_2_group_1',
        'final_group_3', 'final_group_2', 'final_group_1',
      ],
      marathon: ['race'],
    };

    const comps = stmts.getAllCompetitions.all().map(parseCompetitionRow);
    const liveComp = comps.find(c => c.status === 'live');
    if (!liveComp) return null;

    const results = liveComp.results || {};
    let groupCount = results.groupCountOverride || null;

    // Auto-detect groups by pilot overlap if not manually set
    if (!groupCount && (liveComp.format === 'light_league' || liveComp.format === 'champions_league' || liveComp.format === 'sprint')) {
      const linkedSessions = liveComp.sessions.filter(s => s.phase?.startsWith('qualifying'));
      if (linkedSessions.length > 0) {
        const cumulativePilots = new Set();
        for (const ls of linkedSessions) {
          const laps = stmts.getLaps.all(ls.sessionId);
          for (const l of laps) cumulativePilots.add(l.pilot);
        }
        // Check if new session has significant overlap with existing pilots
        const newLaps = stmts.getLaps.all(sessionId);
        const newPilots = new Set(newLaps.map(l => l.pilot));
        if (newPilots.size > 0 && cumulativePilots.size > 0) {
          let overlap = 0;
          for (const p of newPilots) { if (cumulativePilots.has(p)) overlap++; }
          const overlapRatio = overlap / newPilots.size;
          if (overlapRatio >= 0.5) {
            groupCount = linkedSessions.length;
            const maxGroups = FORMAT_MAX_GROUPS[liveComp.format] || 3;
            groupCount = Math.min(Math.max(groupCount, 1), maxGroups);
            this.updateCompetition(liveComp.id, { results: { ...results, groupCountOverride: groupCount } });
            console.log(`🔍 Detected ${groupCount} groups (${Math.round(overlapRatio * 100)}% overlap)`);
          }
        }
      }
    }

    const filterPhases = (phases, gc, format) => {
      if (!gc) return phases;
      return phases.filter(p => {
        if (format !== 'sprint' && p.startsWith('qualifying_')) return parseInt(p.split('_')[1]) <= gc;
        const gm = p.match(/group_(\d+)/);
        if (gm) return parseInt(gm[1]) <= gc;
        return true;
      });
    };

    const allPhases = FULL_PHASES[liveComp.format] || [];
    const phases = filterPhases(allPhases, groupCount, liveComp.format);
    const usedPhases = liveComp.sessions.map(s => s.phase);
    let lastUsedIdx = -1;
    for (const p of usedPhases) {
      const idx = phases.indexOf(p);
      if (idx > lastUsedIdx) lastUsedIdx = idx;
    }
    const nextPhase = lastUsedIdx < phases.length - 1 ? phases[lastUsedIdx + 1] : null;
    if (!nextPhase) return null;
    const sessions = [...liveComp.sessions, { sessionId, phase: nextPhase }];
    this.updateCompetition(liveComp.id, { sessions });
    console.log(`🏁 Auto-linked session ${sessionId} → ${liveComp.name} · ${nextPhase}`);
    return { competitionId: liveComp.id, phase: nextPhase };
  },

  recheckSessionPhase(sessionId) {
    const comps = stmts.getAllCompetitions.all().map(parseCompetitionRow);
    const comp = comps.find(c => c.sessions.some(s => s.sessionId === sessionId));
    if (!comp || comp.status !== 'live') return;
    if (comp.format !== 'light_league' && comp.format !== 'champions_league' && comp.format !== 'sprint') return;

    const results = comp.results || {};
    if (results.groupCountOverride) return;

    const entry = comp.sessions.find(s => s.sessionId === sessionId);
    if (!entry || !entry.phase?.startsWith('qualifying_')) return;

    const qualiSessions = comp.sessions.filter(s => s.phase?.startsWith('qualifying_') && s.sessionId !== sessionId);
    if (qualiSessions.length === 0) return;

    const cumulativePilots = new Set();
    for (const qs of qualiSessions) {
      const laps = stmts.getLaps.all(qs.sessionId);
      for (const l of laps) cumulativePilots.add(l.pilot);
    }

    const newLaps = stmts.getLaps.all(sessionId);
    const newPilots = new Set(newLaps.map(l => l.pilot));
    if (newPilots.size < 3 || cumulativePilots.size === 0) return;

    let overlap = 0;
    for (const p of newPilots) { if (cumulativePilots.has(p)) overlap++; }
    const overlapRatio = overlap / newPilots.size;

    if (overlapRatio < 0.5) return;

    const groupCount = Math.min(qualiSessions.length, { light_league: 3, champions_league: 2, sprint: 3 }[comp.format] || 3);
    console.log(`🔍 Session ${sessionId}: ${Math.round(overlapRatio * 100)}% overlap → detected ${groupCount} groups, reassigning phase`);

    const filterPhases = (phases, gc, fmt) => phases.filter(p => {
      if (fmt !== 'sprint' && p.startsWith('qualifying_')) return parseInt(p.split('_')[1]) <= gc;
      const gm = p.match(/group_(\d+)/);
      if (gm) return parseInt(gm[1]) <= gc;
      return true;
    });

    const FULL_PHASES = {
      light_league: ['qualifying_1', 'qualifying_2', 'qualifying_3', 'qualifying_4', 'race_1_group_3', 'race_1_group_2', 'race_1_group_1', 'race_2_group_3', 'race_2_group_2', 'race_2_group_1'],
      champions_league: ['qualifying_1', 'qualifying_2', 'race_1_group_2', 'race_1_group_1', 'race_2_group_2', 'race_2_group_1', 'race_3_group_2', 'race_3_group_1'],
      sprint: [
        'qualifying_1_group_3', 'qualifying_1_group_2', 'qualifying_1_group_1',
        'race_1_group_3', 'race_1_group_2', 'race_1_group_1',
        'qualifying_2_group_3', 'qualifying_2_group_2', 'qualifying_2_group_1',
        'race_2_group_3', 'race_2_group_2', 'race_2_group_1',
        'final_group_3', 'final_group_2', 'final_group_1',
      ],
    };
    const phases = filterPhases(FULL_PHASES[comp.format] || [], groupCount, comp.format);

    const usedPhases = comp.sessions.filter(s => s.sessionId !== sessionId).map(s => s.phase);
    let lastUsedIdx = -1;
    for (const p of usedPhases) {
      const idx = phases.indexOf(p);
      if (idx > lastUsedIdx) lastUsedIdx = idx;
    }
    const correctPhase = lastUsedIdx < phases.length - 1 ? phases[lastUsedIdx + 1] : null;

    if (correctPhase && correctPhase !== entry.phase) {
      const newSessions = comp.sessions.map(s => s.sessionId === sessionId ? { ...s, phase: correctPhase } : s);
      this.updateCompetition(comp.id, { sessions: newSessions, results: { ...results, groupCountOverride: groupCount } });
      console.log(`🔄 Reassigned ${sessionId}: ${entry.phase} → ${correctPhase}`);
    }
  },

  autoUnlinkSession(sessionId) {
    const comps = stmts.getAllCompetitions.all().map(parseCompetitionRow);
    for (const comp of comps) {
      const entry = comp.sessions.find(s => s.sessionId === sessionId);
      if (entry) {
        const sessions = comp.sessions.filter(s => s.sessionId !== sessionId);
        this.updateCompetition(comp.id, { sessions });
        console.log(`🗑️ Auto-unlinked short session ${sessionId} from ${comp.name} · ${entry.phase}`);
        return true;
      }
    }
    return false;
  },

  getScoring() {
    const raw = this.getSystemState('scoring');
    return raw ? JSON.parse(raw) : null;
  },

  setScoring(data) {
    this.setSystemState('scoring', JSON.stringify(data));
  },

  getViewDefaults() {
    const raw = this.getSystemState('view_defaults');
    return raw ? JSON.parse(raw) : null;
  },

  setViewDefaults(data) {
    this.setSystemState('view_defaults', JSON.stringify(data));
  },

  updateSessionsTrack(sessionIds, trackId) {
    if (!sessionIds || sessionIds.length === 0) return 0;
    const placeholders = sessionIds.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE sessions SET track_id = ? WHERE id IN (${placeholders})`);
    const result = stmt.run(trackId, ...sessionIds);
    return result.changes;
  },

  renamePilot(sessionId, oldName, newName) {
    const updLaps = db.prepare('UPDATE laps SET pilot = ? WHERE session_id = ? AND pilot = ?');
    const result = updLaps.run(newName, sessionId, oldName);
    console.log(`✏️ Renamed "${oldName}" → "${newName}" in ${sessionId}: ${result.changes} laps`);
    return result.changes;
  },
};

console.log(`💾 SQLite DB: ${DB_PATH}`);
