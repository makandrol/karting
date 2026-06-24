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
import {
  buildFullPhases,
  filterPhases as filterPhasesUtil,
  findNextPhase,
  allPhasesFilled,
  isGonzalesQualifying,
  detectGroupCountFromOverlap,
  capGroupCount,
  getScheduledFormat,
  isCompetitionTime,
  buildAutoCompetitionId,
  buildAutoCompetitionName,
  getKyivIsoDate,
  COMPETITION_SCHEDULE,
} from './competition-link-utils.js';
import { parseCompetitionRow, mergeSessions, parseLapTimeSec, buildKartStats, MERGE_GAP_MS, remapKartNamesToPilots } from './storage-utils.js';

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
  CREATE INDEX IF NOT EXISTS idx_laps_kart ON laps(kart);
  CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
  CREATE INDEX IF NOT EXISTS idx_sessions_date_race ON sessions(date, race_number);

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

// Кеш Set виключених кіл (lazy, інвалідовується при toggle).
let _excludedLapsCache = null;

// Кеш розпарсених змагань (lazy). parseCompetitionRow важкий (JSON.parse
// results.standings), а getAllCompetitions викликається у багатьох гарячих
// шляхах. Інвалідовується при будь-якому write у competitions.
let _competitionsCache = null;

// ============================================================
// Prepared statements
// ============================================================

const MIN_LAP_SEC = 38;
const LAP_SEC_EXPR = `CASE WHEN lap_time LIKE '%:%' THEN CAST(SUBSTR(lap_time, 1, INSTR(lap_time, ':') - 1) AS REAL) * 60 + CAST(SUBSTR(lap_time, INSTR(lap_time, ':') + 1) AS REAL) ELSE CAST(lap_time AS REAL) END`;
const LAP_SEC_EXPR_L = LAP_SEC_EXPR.replace(/lap_time/g, 'l.lap_time');
const VALID_LAP = `lap_time IS NOT NULL AND (${LAP_SEC_EXPR}) >= ${MIN_LAP_SEC}`;
const VALID_LAP_L = `l.lap_time IS NOT NULL AND (${LAP_SEC_EXPR_L}) >= ${MIN_LAP_SEC}`;

const stmts = {
  insertSession: db.prepare('INSERT OR IGNORE INTO sessions (id, start_time, pilot_count, track_id, race_number, is_race, date) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  endSession: db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?'),
  insertEvent: db.prepare('INSERT INTO events (session_id, event_type, ts, data) VALUES (?, ?, ?, ?)'),
  insertLap: db.prepare('INSERT INTO laps (session_id, pilot, kart, lap_number, lap_time, s1, s2, best_lap, position, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  getSessions: db.prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?'),
  getSessionsByDate: db.prepare('SELECT * FROM sessions WHERE date = ? ORDER BY start_time'),
  getLapsByDate: db.prepare(`
    SELECT l.* FROM laps l JOIN sessions s ON s.id = l.session_id WHERE s.date = ?
  `),
  getSessionTimeRow: db.prepare('SELECT start_time, end_time, race_number, date FROM sessions WHERE id = ?'),
  getSessionEndTime: db.prepare('SELECT end_time FROM sessions WHERE id = ?'),
  getSiblingsByRace: db.prepare('SELECT id, start_time, end_time FROM sessions WHERE date = ? AND race_number = ? AND id != ? ORDER BY start_time'),
  getEvents: db.prepare('SELECT * FROM events WHERE session_id = ? AND ts >= ? ORDER BY ts LIMIT 10000'),
  getSessionCountsByDateRange: db.prepare('SELECT date, COUNT(*) as count FROM sessions WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date'),
  getKartStats: db.prepare(`
    SELECT l.session_id, l.kart, l.pilot, l.lap_time, l.s1, l.s2, l.ts,
      (${LAP_SEC_EXPR_L}) as lap_sec
    FROM laps l
    JOIN sessions s ON s.id = l.session_id
    WHERE s.date >= ? AND s.date <= ? AND ${VALID_LAP_L}
    ORDER BY l.kart, lap_sec
  `),
  getKartStatsBySessions: db.prepare(`
    SELECT session_id, kart, pilot, lap_time, s1, s2, ts,
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
    const rows = stmts.getSessionsByDate.all(date);
    const compMap = this.getSessionCompetitionMap();

    // Один запит усіх кіл дня (~30ms) замість важкого per-session SQL-підзапиту
    // з CAST/ORDER BY (раніше ~600ms). real_pilot_count + best_lap рахуємо в JS.
    const allLaps = remapKartNamesToPilots(stmts.getLapsByDate.all(date));
    const lapsBySession = new Map();
    for (const l of allLaps) {
      if (!lapsBySession.has(l.session_id)) lapsBySession.set(l.session_id, []);
      lapsBySession.get(l.session_id).push(l);
    }

    const enriched = rows.map(r => {
      const laps = lapsBySession.get(r.id) || [];
      const pilots = new Set();
      let best_lap_time = null, best_lap_pilot = null, best_lap_kart = null, bestSec = Infinity;
      for (const l of laps) {
        const sec = parseLapTimeSec(l.lap_time);
        if (sec === null || sec <= 0) continue;
        const canonical = l.resolved_pilot ?? l.pilot;
        pilots.add(canonical);
        if (sec < bestSec) { bestSec = sec; best_lap_time = l.lap_time; best_lap_pilot = canonical; best_lap_kart = l.kart; }
      }
      const real_pilot_count = pilots.size || null;
      const comp = compMap.get(r.id) || null;
      return {
        ...r, real_pilot_count, best_lap_time, best_lap_pilot, best_lap_kart,
        pilot_count: real_pilot_count || r.pilot_count,
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

  getSessionCounts(fromDate, toDate, opts = {}) {
    const rawCounts = stmts.getSessionCountsByDateRange.all(fromDate, toDate);
    // light=true → лише сирий count без merge/tracks (швидко, для дерева дат).
    if (opts.light) {
      return rawCounts.map(({ date, count }) => ({ date, count }));
    }
    return rawCounts.map(({ date }) => {
      const raw = stmts.getSessionsByDate.all(date);
      const merged = mergeSessions(raw);
      const filtered = merged.filter(s => !s.end_time || (s.end_time - s.start_time) >= 60000);
      // Розбивка по трасах — для фронтового фільтра по трасах.
      const tracks = {};
      for (const s of filtered) {
        const tid = s.track_id || 1;
        tracks[tid] = (tracks[tid] || 0) + 1;
      }
      return { date, count: filtered.length, tracks };
    });
  },

  getKartStats(fromDate, toDate) {
    const rows = stmts.getKartStats.all(fromDate, toDate);
    return buildKartStats(remapKartNamesToPilots(rows), this.getExcludedLaps());
  },

  getKartStatsBySessions(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) return [];
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT session_id, kart, pilot, lap_time, s1, s2, ts,
        (${LAP_SEC_EXPR}) as lap_sec
      FROM laps
      WHERE session_id IN (${placeholders}) AND ${VALID_LAP}
      ORDER BY kart, lap_sec
    `).all(...sessionIds);
    return buildKartStats(remapKartNamesToPilots(rows), this.getExcludedLaps());
  },

  /** Отримати події (враховує merged sessions) */
  getEvents(sessionId, since = 0) {
    if (sessionId) {
      const ids = this._getMergedIds(sessionId);
      if (ids) {
        const allEvents = [];
        for (const subId of ids) {
          allEvents.push(...stmts.getEvents.all(subId, since));
        }
        allEvents.sort((a, b) => a.ts - b.ts);
        return allEvents.map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
      }
      return stmts.getEvents.all(sessionId, since).map(r => ({
        ...r, data: r.data ? JSON.parse(r.data) : null
      }));
    }
    return stmts.getAllEvents.all(since).map(r => ({
      ...r, data: r.data ? JSON.parse(r.data) : null
    }));
  },

  /** Отримати кола за сесію (враховує merged sessions, ремапить "Карт N" → real names) */
  getLaps(sessionId) {
    const ids = this._getMergedIds(sessionId);
    if (!ids) return remapKartNamesToPilots(stmts.getLaps.all(sessionId));

    const allLaps = [];
    for (const subId of ids) {
      allLaps.push(...stmts.getLaps.all(subId));
    }
    allLaps.sort((a, b) => a.ts - b.ts);
    return remapKartNamesToPilots(allLaps);
  },

  /** Знайти merged_session_ids для батьківської сесії (лёгкий SQL-запит) */
  _getMergedIds(sessionId) {
    const row = stmts.getSessionTimeRow.get(sessionId);
    if (!row || row.race_number === null) return null;

    // Сусіди одразу з start_time/end_time — без окремого запиту на кожного.
    const siblings = stmts.getSiblingsByRace.all(row.date, row.race_number, sessionId);
    if (siblings.length === 0) return null;

    const ids = [sessionId];
    const start = row.start_time;
    const end = row.end_time || row.start_time;

    for (const sRow of siblings) {
      const sEnd = sRow.end_time || sRow.start_time;
      const gap = Math.min(
        Math.abs(sRow.start_time - end),
        Math.abs(start - sEnd)
      );
      if (gap < MERGE_GAP_MS) ids.push(sRow.id);
    }

    return ids.length > 1 ? ids : null;
  },

  getLapsByKart(kartNumber, fromDate, toDate) {
    return remapKartNamesToPilots(stmts.getLapsByKart.all(kartNumber, fromDate, toDate));
  },

  getKartSessionCounts(kartNumber) {
    // Скільки сесій за день містили кола цього карта. Один SQL-запит
    // (раніше тут був getSessionsByDate на кожну дату — ~4.5с для карта).
    // Рахуємо distinct session_id з валідними колами карта, групуємо по даті.
    const rows = db.prepare(`
      SELECT s.date as date, COUNT(DISTINCT l.session_id) as count
      FROM laps l
      JOIN sessions s ON s.id = l.session_id
      WHERE l.kart = ? AND ${VALID_LAP_L}
      GROUP BY s.date
      HAVING count > 0
      ORDER BY s.date
    `).all(kartNumber);
    return rows;
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

  /** Скинути in-memory кеші (для тестів, що чистять БД напряму). */
  _clearCaches() {
    _competitionsCache = null;
    _excludedLapsCache = null;
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
  // Excluded laps (глобально — для karts/гонки/прокату)
  // ============================================================
  // Зберігаються як JSON-масив ключів "sessionId|pilot|ts" у system_state.
  // Кешуємо Set в пам'яті для O(1) перевірки без парсингу JSON щоразу.

  getExcludedLaps() {
    if (_excludedLapsCache === null) {
      const raw = this.getSystemState('excluded_laps');
      let arr = [];
      try { arr = raw ? JSON.parse(raw) : []; } catch { arr = []; }
      _excludedLapsCache = new Set(arr);
    }
    return _excludedLapsCache;
  },

  /** Toggle одного кола за ключем "sessionId|pilot|ts". @returns {boolean} excluded after toggle */
  toggleExcludedLap(lapKey) {
    const set = this.getExcludedLaps();
    let excluded;
    if (set.has(lapKey)) { set.delete(lapKey); excluded = false; }
    else { set.add(lapKey); excluded = true; }
    this.setSystemState('excluded_laps', JSON.stringify([...set]));
    return excluded;
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
    _competitionsCache = null;
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
    _competitionsCache = null;
    return true;
  },

  /**
   * Усі змагання, розпарсені, з кешу. parseCompetitionRow важкий (JSON.parse
   * results), тож кешуємо результат і повторно використовуємо у всіх гарячих
   * шляхах (getSessionsByDate, auto-link, finalize, ...). Кеш скидається при
   * будь-якому write у competitions.
   */
  getAllCompetitionsParsed() {
    if (_competitionsCache === null) {
      _competitionsCache = stmts.getAllCompetitions.all().map(parseCompetitionRow);
    }
    return _competitionsCache;
  },

  getCompetition(id) {
    const comp = this.getAllCompetitionsParsed().find(c => c.id === id);
    return comp ? this._withGlobalExcludedLaps(comp) : null;
  },

  getCompetitions(format) {
    const all = this.getAllCompetitionsParsed();
    const filtered = format ? all.filter(c => c.format === format) : all;
    return filtered.map(c => this._withGlobalExcludedLaps(c));
  },

  /**
   * Домішує глобально виключені кола у results.excludedLaps змагання, щоб
   * фронт (гонка/standings) враховував їх без окремого запиту. Глобальне
   * сховище — джерело правди; legacy comp.results.excludedLaps зберігається.
   */
  _withGlobalExcludedLaps(comp) {
    if (!comp) return comp;
    const global = this.getExcludedLaps();
    if (global.size === 0) return comp;
    const results = comp.results || {};
    const merged = new Set([...(results.excludedLaps || []), ...global]);
    return { ...comp, results: { ...results, excludedLaps: [...merged] } };
  },

  deleteCompetition(id) {
    const changed = stmts.deleteCompetition.run(id).changes > 0;
    if (changed) _competitionsCache = null;
    return changed;
  },

  getSessionCompetition(sessionId) {
    for (const comp of this.getAllCompetitionsParsed()) {
      const entry = comp.sessions.find(s => s.sessionId === sessionId);
      if (entry) return { competitionId: comp.id, competitionName: comp.name, format: comp.format, phase: entry.phase, status: comp.status };
    }
    return null;
  },

  getSessionCompetitionMap() {
    const map = new Map();
    for (const comp of this.getAllCompetitionsParsed()) {
      for (const s of comp.sessions) {
        map.set(s.sessionId, { competitionId: comp.id, competitionName: comp.name, format: comp.format, phase: s.phase, status: comp.status });
      }
    }
    return map;
  },

  /**
   * If `now` falls inside a scheduled competition window for the day and
   * no live competition exists yet, create a new live competition.
   *
   * Idempotent: if a live (or finished) competition of the scheduled format
   * already exists for the day, returns it untouched.
   *
   * @param {number} now unix-ms
   * @returns {object|null} created/existing competition row, or null
   */
  autoStartCompetitionIfTime(now) {
    const format = getScheduledFormat(now);
    if (!format) return null;
    if (!isCompetitionTime(now)) return null;

    const date = getKyivIsoDate(now);
    const sameDay = this.getAllCompetitionsParsed()
      .find(c => c.format === format && c.date === date);
    if (sameDay) return sameDay;

    const id = buildAutoCompetitionId(format, now);
    const trackId = _currentTrackId;
    const name = buildAutoCompetitionName(format, now, trackId);

    this.createCompetition({
      id, name, format, date,
      sessions: [],
      results: null,
      uploaded_results: null,
      status: 'live',
    });
    console.log(`🆕 Auto-started competition: ${name}`);
    return this.getCompetition(id);
  },

  /**
   * Recompute `gonzalesRoundCount` for a Gonzales competition from the number
   * of distinct pilots across ALL its qualifying sessions.
   *
   * Кількість раундів = MAX(12, пілотів). Карти завжди 12; зайві пілоти додають
   * раунди для повної ротації. "Карт N" рахуються як валідні пілоти (timing
   * іноді не виставляє реальні імена, але це справжні учасники).
   *
   * Зберігає лише якщо нове значення БІЛЬШЕ за поточне — щоб не "вкорочувати"
   * змагання, якщо в пізнішій сесії менше пілотів (хтось зійшов).
   *
   * @param {object} comp parsed competition row
   * @returns {number|null} the round count now stored, or null if not gonzales
   */
  recomputeGonzalesRoundCount(comp) {
    if (!comp || comp.format !== 'gonzales') return null;

    const qualiSessions = comp.sessions.filter(s => s.phase?.startsWith('qualifying'));
    if (qualiSessions.length === 0) return null;

    const pilots = new Set();
    for (const qs of qualiSessions) {
      const laps = this.getLaps(qs.sessionId);
      for (const l of laps) pilots.add(l.pilot);
    }
    if (pilots.size === 0) return null;

    const roundCount = Math.max(12, pilots.size);
    const current = comp.results?.gonzalesRoundCount ?? 12;
    if (roundCount > current) {
      this.updateCompetition(comp.id, { results: { ...(comp.results || {}), gonzalesRoundCount: roundCount } });
      console.log(`🔢 recomputeGonzalesRoundCount: comp ${comp.id} → ${roundCount} rounds (${pilots.size} quali pilots, was ${current})`);
    }
    return Math.max(roundCount, current);
  },

  /**
   * Lightweight auto-link на момент створення нової сесії.
   *
   * На цей момент в БД ще нема `laps` для нової сесії, тому overlap-аналіз
   * безкорисний. Просто беремо наступну вільну фазу зі списку (з фільтром
   * по `groupCount` якщо він уже відомий, інакше — з повного списку).
   *
   * Після першого кола — `finalizeSessionPhaseOnFirstLap` детектить
   * groupCount та виправляє phase якщо треба. Це і є джерело правди для
   * фінальної фази.
   *
   * @returns {{competitionId: string, phase: string}|null}
   */
  autoLinkSessionToActiveCompetition(sessionId) {
    const comps = this.getAllCompetitionsParsed();
    let liveComp = comps.find(c => c.status === 'live');

    // No live comp yet — try auto-start (Mon=Гонз, Tue=ЛЛ, Wed=ЛЧ, ≥19:45 Kyiv)
    if (!liveComp) {
      const sessionTs = parseInt(sessionId.replace('session-', '')) || Date.now();
      const created = this.autoStartCompetitionIfTime(sessionTs);
      if (!created) {
        console.log(`🔗 autoLink ${sessionId}: no live competition and not auto-start time → skip`);
        return null;
      }
      liveComp = parseCompetitionRow(stmts.getCompetition.get(created.id));
    }
    if (!liveComp) {
      console.log(`🔗 autoLink ${sessionId}: live competition lookup failed after auto-start → skip`);
      return null;
    }

    const results = liveComp.results || {};
    // Гонзалес: перерахувати кількість раундів з квалі-пілотів ПЕРЕД фільтром фаз,
    // щоб нові заїзди не блокувались дефолтним roundCount=12 (інакше all-phases-filled
    // спрацює зарано і змагання передчасно "завершиться").
    let gonzalesRoundCount = results.gonzalesRoundCount ?? 12;
    if (liveComp.format === 'gonzales') {
      const recomputed = this.recomputeGonzalesRoundCount(liveComp);
      if (recomputed != null) gonzalesRoundCount = recomputed;
    }
    const groupCount = results.groupCountOverride ?? results.autoDetectedGroups ?? null;

    const allPhases = buildFullPhases(liveComp.format, { gonzalesRoundCount });
    const phases = filterPhasesUtil(allPhases, groupCount, liveComp.format, { gonzalesRoundCount });
    const usedPhases = new Set(liveComp.sessions.map(s => s.phase));

    // All expected phases already filled — competition is effectively complete
    if (allPhasesFilled(phases, usedPhases)) {
      console.log(`⏭️ All ${phases.length} phases filled for ${liveComp.name}, skipping auto-link ${sessionId} (used: [${[...usedPhases].join(', ')}])`);
      return null;
    }

    const nextPhase = findNextPhase(phases, usedPhases);
    if (!nextPhase) {
      // findNextPhase повернув null, але allPhasesFilled === false → стейт
      // невпорядкований (usedPhases містить фази поза/після очікуваного
      // списку). Це симптом race-condition забруднення — логуємо детально.
      console.warn(`⚠️ autoLink ${sessionId}: findNextPhase=null for ${liveComp.name} (format=${liveComp.format}, groupCount=${groupCount}) — used phases out of order. phases=[${phases.join(', ')}], used=[${[...usedPhases].join(', ')}]`);
      return null;
    }
    const sessions = [...liveComp.sessions, { sessionId, phase: nextPhase }];
    this.updateCompetition(liveComp.id, { sessions });
    console.log(`🏁 Auto-linked session ${sessionId} → ${liveComp.name} · ${nextPhase} (tentative) [groupCount=${groupCount ?? 'unknown'}, ${usedPhases.size}/${phases.length} phases used]`);
    return { competitionId: liveComp.id, phase: nextPhase };
  },

  /**
   * Detect groupCount via overlap of pilots in the given session against
   * cumulative pilots from all qualifying sessions of the competition.
   * Saves to `results.autoDetectedGroups` if successful.
   *
   * Викликається на першому колі будь-якої сесії змагання — щоб правильно
   * виставити groupCount як можна раніше. На відміну від попередньої логіки
   * (overlap викликався тільки при autoLink, де laps ще нема), цей метод
   * працює тоді коли laps уже записані.
   *
   * @param {string} sessionId
   * @returns {number|null} groupCount that was detected and stored, or null
   */
  detectGroupCountIfNeeded(sessionId) {
    const comps = this.getAllCompetitionsParsed();
    const comp = comps.find(c => c.sessions.some(s => s.sessionId === sessionId));
    if (!comp || comp.status !== 'live') return null;

    const results = comp.results || {};
    // Already has groupCount — nothing to do
    if (results.groupCountOverride != null || results.autoDetectedGroups != null) return null;

    if (comp.format !== 'light_league' && comp.format !== 'champions_league' && comp.format !== 'sprint' && comp.format !== 'gonzales') return null;

    const qualiSessions = comp.sessions.filter(s => s.phase?.startsWith('qualifying') && s.sessionId !== sessionId);
    if (qualiSessions.length === 0) return null;

    const cumulativePilots = new Set();
    for (const qs of qualiSessions) {
      const laps = this.getLaps(qs.sessionId);
      for (const l of laps) cumulativePilots.add(l.pilot);
    }

    const newLaps = this.getLaps(sessionId);
    const newPilots = new Set(newLaps.map(l => l.pilot));
    if (newPilots.size === 0 || cumulativePilots.size === 0) {
      console.log(`🔍 detectGroupCount ${sessionId}: not enough data (newPilots=${newPilots.size}, qualiPilots=${cumulativePilots.size}) → skip`);
      return null;
    }

    let detectedGroupCount = null;

    if (comp.format === 'gonzales') {
      const sessionRow = stmts.getSessionsByDate.all(new Date(parseInt(sessionId.replace('session-', ''))).toISOString().slice(0, 10))
        .find(s => s.id === sessionId);
      const isFinished = !!sessionRow?.end_time;
      const lapCounts = new Map();
      for (const l of newLaps) lapCounts.set(l.pilot, (lapCounts.get(l.pilot) || 0) + 1);

      const treatAsQualifying = isGonzalesQualifying([...newPilots], lapCounts, isFinished);
      detectedGroupCount = treatAsQualifying
        ? capGroupCount(qualiSessions.length + 1, comp.format)
        : qualiSessions.length;
    } else {
      const detection = detectGroupCountFromOverlap({
        cumulativeQualifyingPilots: cumulativePilots,
        newPilots,
        qualifyingCount: qualiSessions.length,
        format: comp.format,
      });
      // Action='race' → це гонка (overlap ≥50%), groupCount = qualiCount.
      // Action='qualifying' → це нова квала, але оскільки сесія залінкована
      // як quali_(N+1) або race_*, ми не змінюємо тут — recheckSessionPhase
      // обробляє переназначення; ми лише зберігаємо знайдений groupCount
      // як підказку для autoLink наступних сесій.
      if (detection.action === 'race' && detection.groupCount != null) {
        detectedGroupCount = detection.groupCount;
      }
    }

    if (detectedGroupCount != null) {
      this.updateCompetition(comp.id, { results: { ...results, autoDetectedGroups: detectedGroupCount } });
      console.log(`🔍 detectGroupCountIfNeeded: comp ${comp.id} → ${detectedGroupCount} groups (from session ${sessionId})`);
      return detectedGroupCount;
    }
    return null;
  },

  /**
   * Фіналізує phase сесії на першому колі.
   *
   * На цей момент laps для сесії вже є → можна:
   * 1. Визначити `autoDetectedGroups` через overlap-аналіз (якщо ще немає).
   * 2. Перевірити чи поточна phase правильна для відомого groupCount.
   *    Якщо позиція сесії в комп не співпадає з очікуваною phase — реасайн.
   *
   * Це **єдиний** шлях для встановлення остаточної фази race-сесій.
   * Викликається з poller.js при першому колі.
   */
  finalizeSessionPhaseOnFirstLap(sessionId) {
    const comps = this.getAllCompetitionsParsed();
    const comp = comps.find(c => c.sessions.some(s => s.sessionId === sessionId));
    if (!comp || comp.status !== 'live') return;
    if (comp.format !== 'light_league' && comp.format !== 'champions_league' && comp.format !== 'sprint' && comp.format !== 'gonzales') return;

    const entry = comp.sessions.find(s => s.sessionId === sessionId);
    if (!entry || !entry.phase) return;

    // Спочатку детектимо groupCount (якщо ще не визначено) — це
    // допомагає і qualifying-, і race-сценарію.
    this.detectGroupCountIfNeeded(sessionId);

    // Перечитуємо comp після можливого update
    const freshComp = parseCompetitionRow(stmts.getCompetition.get(comp.id));
    const results = freshComp.results || {};
    const gonzalesRoundCount = results.gonzalesRoundCount ?? 12;
    const groupCount = results.groupCountOverride ?? results.autoDetectedGroups ?? null;

    const isQualiPhase = entry.phase.startsWith('qualifying_');

    if (isQualiPhase) {
      // ── Quali-сценарій: можливо це гонка, не квала ──
      const qualiSessions = freshComp.sessions.filter(s => s.phase?.startsWith('qualifying_') && s.sessionId !== sessionId);
      if (qualiSessions.length === 0) return;

      const newLaps = this.getLaps(sessionId);
      const newPilots = new Set(newLaps.map(l => l.pilot));
      if (newPilots.size < 3) return;

      if (comp.format === 'gonzales') {
        const sessionRow = stmts.getSessionsByDate.all(new Date(parseInt(sessionId.replace('session-', ''))).toISOString().slice(0, 10))
          .find(s => s.id === sessionId);
        const isFinished = !!sessionRow?.end_time;
        const lapCounts = new Map();
        for (const l of newLaps) lapCounts.set(l.pilot, (lapCounts.get(l.pilot) || 0) + 1);
        if (isGonzalesQualifying([...newPilots], lapCounts, isFinished)) return;
      } else {
        const cumulativePilots = new Set();
        for (const qs of qualiSessions) {
          const laps = this.getLaps(qs.sessionId);
          for (const l of laps) cumulativePilots.add(l.pilot);
        }
        const detection = detectGroupCountFromOverlap({
          cumulativeQualifyingPilots: cumulativePilots,
          newPilots,
          qualifyingCount: qualiSessions.length,
          format: comp.format,
        });
        if (detection.action !== 'race') return;
      }

      // Це гонка, не квала — переназначити
      const finalGroupCount = groupCount ?? capGroupCount(qualiSessions.length, comp.format);
      const allPhases = buildFullPhases(comp.format, { gonzalesRoundCount });
      const phases = filterPhasesUtil(allPhases, finalGroupCount, comp.format, { gonzalesRoundCount });
      const usedPhases = freshComp.sessions.filter(s => s.sessionId !== sessionId).map(s => s.phase);
      const correctPhase = findNextPhase(phases, usedPhases);

      if (correctPhase && correctPhase !== entry.phase) {
        const newSessions = freshComp.sessions.map(s => s.sessionId === sessionId ? { ...s, phase: correctPhase } : s);
        this.updateCompetition(comp.id, { sessions: newSessions, results: { ...results, autoDetectedGroups: finalGroupCount } });
        console.log(`🔄 Finalized ${sessionId}: ${entry.phase} → ${correctPhase} (quali → race) [groupCount=${finalGroupCount}]`);
      } else {
        console.log(`🔍 Finalize ${sessionId}: detected race but phase already correct (${entry.phase}), groupCount=${finalGroupCount} → no change`);
      }
      return;
    }

    // ── Race-сценарій: перевіряємо чи фаза правильна за позицією у comp ──
    if (groupCount == null) {
      console.log(`🔍 Finalize ${sessionId}: race phase ${entry.phase} but groupCount unknown → cannot verify, leaving as-is`);
      return;  // groupCount не визначено → не чіпаємо
    }

    const allPhases = buildFullPhases(comp.format, { gonzalesRoundCount });
    const phases = filterPhasesUtil(allPhases, groupCount, comp.format, { gonzalesRoundCount });

    // Знайти яка фаза має бути за порядковим положенням сесії в comp.
    // Сортуємо за timestamp (з sessionId), беремо індекс — це і є phase.
    const sessionsSorted = [...freshComp.sessions].sort((a, b) => {
      const ta = parseInt(a.sessionId.replace('session-', '')) || 0;
      const tb = parseInt(b.sessionId.replace('session-', '')) || 0;
      return ta - tb;
    });
    const indexInComp = sessionsSorted.findIndex(s => s.sessionId === sessionId);
    if (indexInComp < 0 || indexInComp >= phases.length) {
      console.warn(`⚠️ Finalize ${sessionId}: position ${indexInComp} out of phases range (${phases.length} phases for groupCount=${groupCount}) → cannot map to phase`);
      return;
    }
    const expectedPhase = phases[indexInComp];

    if (expectedPhase && expectedPhase !== entry.phase) {
      const newSessions = freshComp.sessions.map(s => s.sessionId === sessionId ? { ...s, phase: expectedPhase } : s);
      this.updateCompetition(comp.id, { sessions: newSessions });
      console.log(`🔄 Finalized ${sessionId}: ${entry.phase} → ${expectedPhase} (race phase mismatch) [groupCount=${groupCount}, position ${indexInComp}]`);
    } else {
      console.log(`🔍 Finalize ${sessionId}: race phase ${entry.phase} correct for position ${indexInComp} (groupCount=${groupCount}) → no change`);
    }
  },

  /** @deprecated використовуйте finalizeSessionPhaseOnFirstLap. */
  recheckSessionPhase(sessionId) {
    return this.finalizeSessionPhaseOnFirstLap(sessionId);
  },

  /**
   * Auto-finish live competitions where all sessions ended AND either:
   *  - all expected phases are linked (LL/CL/Sprint), OR
   *  - the last session ended >FINISH_TIMEOUT_MS ago (timeout fallback,
   *    used as the only signal for Gonzales since its phase count is fuzzy).
   *
   * Idempotent — calling twice has no extra effect (already finished comps skipped).
   *
   * @param {number} now unix-ms (defaults to Date.now())
   * @returns {string[]} ids of competitions that were finished by this call
   */
  autoFinishCompletedCompetitions(now = Date.now()) {
    const FINISH_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour after last session
    const finishedIds = [];

    const comps = this.getAllCompetitionsParsed();
    const live = comps.filter(c => c.status === 'live');

    for (const comp of live) {
      if (comp.sessions.length === 0) continue;

      const sessionMeta = comp.sessions
        .map(s => stmts.getSessionEndTime.get(s.sessionId))
        .filter(Boolean);
      if (sessionMeta.length === 0) continue;

      const allEnded = sessionMeta.every(s => s.end_time != null);
      if (!allEnded) continue;

      const lastEndTime = Math.max(...sessionMeta.map(s => s.end_time));
      const timedOut = (now - lastEndTime) > FINISH_TIMEOUT_MS;

      // Phase-based check: skipped for Gonzales (phase count fuzzy)
      let phasesComplete = false;
      if (comp.format !== 'gonzales') {
        const groupCount = comp.results?.groupCountOverride ?? comp.results?.autoDetectedGroups;
        const allPhases = buildFullPhases(comp.format);
        const phases = filterPhasesUtil(allPhases, groupCount, comp.format);
        phasesComplete = phases.length > 0 && comp.sessions.length >= phases.length;
      }

      if (phasesComplete || timedOut) {
        this.updateCompetition(comp.id, { status: 'finished' });
        finishedIds.push(comp.id);
        console.log(`🏁 Auto-finished competition: ${comp.name} (${phasesComplete ? 'all phases linked' : 'timeout'})`);
      }
    }

    return finishedIds;
  },

  autoUnlinkSession(sessionId) {
    const comps = this.getAllCompetitionsParsed();
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

  /**
   * Replay the live poller's competition-linking logic over already-recorded
   * sessions of a given day, starting at `fromTs`. Mirrors poller.js exactly:
   * for each session in chronological order — autoLink at start, finalize on
   * first lap, auto-unlink if < 60s. Used to re-link a freshly recreated
   * competition without re-running the timing poll.
   *
   * @param {string} date "YYYY-MM-DD"
   * @param {number} fromTs only sessions with start_time >= fromTs
   * @returns {{sessionId:string, action:string, phase:string|null}[]} trace
   */
  replayLinkingForDate(date, fromTs) {
    const rows = stmts.getSessionsByDate.all(date).filter(s => s.start_time >= fromTs);
    const trace = [];
    for (const s of rows) {
      const linked = this.autoLinkSessionToActiveCompetition(s.id);
      if (!linked) { trace.push({ sessionId: s.id, action: 'skip-autolink', phase: null }); continue; }
      // first lap → finalize phase (group detection + quali/race reassign)
      const laps = this.getLaps(s.id);
      if (laps.length > 0) this.finalizeSessionPhaseOnFirstLap(s.id);
      // short session → unlink (mirror poller #tryAutoUnlinkShortSession)
      if (s.end_time && (s.end_time - s.start_time) < 60000) {
        this.autoUnlinkSession(s.id);
        trace.push({ sessionId: s.id, action: 'unlink-short', phase: null });
        continue;
      }
      // re-read final phase
      const comps = this.getAllCompetitionsParsed();
      const comp = comps.find(c => c.sessions.some(x => x.sessionId === s.id));
      const phase = comp?.sessions.find(x => x.sessionId === s.id)?.phase ?? null;
      trace.push({ sessionId: s.id, action: 'linked', phase });
    }
    return trace;
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

  getPageVisibility() {
    const raw = this.getSystemState('page_visibility');
    return raw ? JSON.parse(raw) : null;
  },

  setPageVisibility(data) {
    this.setSystemState('page_visibility', JSON.stringify(data));
  },

  getModerators() {
    const raw = this.getSystemState('moderators');
    return raw ? JSON.parse(raw) : null;
  },

  setModerators(data) {
    this.setSystemState('moderators', JSON.stringify(data));
  },

  updateSessionsTrack(sessionIds, trackId) {
    if (!sessionIds || sessionIds.length === 0) return 0;
    const placeholders = sessionIds.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE sessions SET track_id = ? WHERE id IN (${placeholders})`);
    const result = stmt.run(trackId, ...sessionIds);
    return result.changes;
  },

  propagateTrack(sessionId, trackId) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return 0;
    const date = session.date;
    const startTime = session.start_time;
    if (!date || !startTime) return 0;

    const compMap = this.getSessionCompetitionMap();
    const allOnDate = db.prepare('SELECT id, start_time FROM sessions WHERE date = ? AND start_time >= ? ORDER BY start_time').all(date, startTime);
    const toUpdate = allOnDate.filter(s => !compMap.has(s.id)).map(s => s.id);
    if (toUpdate.length === 0) return 0;

    const changes = this.updateSessionsTrack(toUpdate, trackId);
    // Якщо міняємо трасу сьогоднішнього (останнього) прокату — оновлюємо й
    // поточну трасу колектора, щоб live-poller створював нові sub-сесії вже
    // на правильній трасі (інакше вони перетягують merge назад на стару).
    const todayDate = new Date().toISOString().split('T')[0];
    if (date === todayDate) {
      this.setCurrentTrackId(trackId);
      console.log(`🏁 propagateTrack ${sessionId} → ${trackId}; current track updated (today)`);
    }
    return changes;
  },

  renamePilot(sessionId, oldName, newName) {
    const updLaps = db.prepare('UPDATE laps SET pilot = ? WHERE session_id = ? AND pilot = ?');
    const result = updLaps.run(newName, sessionId, oldName);
    console.log(`✏️ Renamed "${oldName}" → "${newName}" in ${sessionId}: ${result.changes} laps`);
    return result.changes;
  },
};

console.log(`💾 SQLite DB: ${DB_PATH}`);
