# Collector Documentation

## Overview
The collector is a Node.js HTTP server that polls the karting timing API, stores data in SQLite, and serves it to the frontend.

**Location**: `collector/` directory
**Runtime**: Node.js 20, no framework (plain `http` module)
**Database**: SQLite via `better-sqlite3` at `collector/data/karting.db`

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | HTTP server, all API endpoints, CORS |
| `src/poller.js` | `TimingPoller` — core polling engine, session management, auto-link to competitions |
| `src/parser.js` | Parses raw JSON from timing API, defines volatile fields |
| `src/detector.js` | `CompetitionDetector` — auto-detects competitions by schedule |
| `src/schedule.js` | Weekly competition schedule (Mon=Gonzales, Tue=LL, Wed=CL) |
| `src/storage.js` | SQLite schema, prepared statements, CRUD, session merging, competition linking |

## Database Schema

### sessions
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,           -- "session-{timestamp}"
    start_time INTEGER NOT NULL,   -- unix ms
    end_time INTEGER,              -- unix ms (null if active)
    pilot_count INTEGER DEFAULT 0, -- initial count at session start
    track_id INTEGER DEFAULT 1,
    race_number INTEGER,           -- from timing API
    is_race INTEGER DEFAULT 0,
    date TEXT NOT NULL              -- "YYYY-MM-DD"
);
```

### events
```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,       -- snapshot, lap, s1, pilot_join, pilot_leave, update, poll_ok
    ts INTEGER NOT NULL,            -- unix ms
    data TEXT                       -- JSON
);
```

### laps
```sql
CREATE TABLE laps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    pilot TEXT NOT NULL,
    kart INTEGER NOT NULL,
    lap_number INTEGER NOT NULL,
    lap_time TEXT,                  -- "39.800" or "1:02.222"
    s1 TEXT, s2 TEXT,
    best_lap TEXT,
    position INTEGER,
    ts INTEGER NOT NULL
);
```

### competitions
```sql
CREATE TABLE competitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,             -- "ЛЛ, 24.03.26, Тр. 1"
    format TEXT,                    -- light_league, champions_league, gonzales, sprint, marathon
    date TEXT,
    sessions TEXT NOT NULL DEFAULT '[]',  -- JSON: [{sessionId, phase}]
    results TEXT,                   -- JSON: {excludedPilots:[], edits:{}}
    uploaded_results TEXT,          -- JSON: manually uploaded final results
    status TEXT NOT NULL DEFAULT 'live'  -- 'live' or 'finished'
);
```

**sessions format**: `[{sessionId: "session-123", phase: "qualifying_1"}]`
Migration: old format `["session-123"]` auto-converted on read.

**results format**: `{excludedPilots: ["Механік"], edits: {"pilot|1": {startPos: 5, finishPos: 3, penalties: 0}}}`

### Other tables
- `page_views` — analytics page views
- `visitor_sessions` — analytics visitor sessions
- `db_stats` — key-value system state (current_track_id, active_competition)

## API Endpoints

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| GET | `/status` | Poller status + DB stats |
| GET | `/timing` | Current timing data + competition state |
| GET | `/track` | Current track ID |
| GET | `/events?session=&since=` | Event log |
| GET | `/sessions` | In-memory session list |
| GET | `/db/sessions?date=` | Sessions from DB (merged, with stats, competition info) |
| GET | `/db/laps?session=` | Laps for a session |
| GET | `/db/laps?kart=&from=&to=` | Laps for a kart in date range |
| GET | `/db/events?session=&since=` | Events from DB |
| GET | `/db/session-counts?from=&to=` | Session counts per date (merged+filtered) |
| GET | `/db/kart-stats?from=&to=` | Kart stats by date range |
| POST | `/db/kart-stats` | Kart stats by session IDs `{sessionIds:[]}` |
| GET | `/db/kart-session-counts?kart=` | Per-date session counts for specific kart |
| GET | `/db/session-competition?session=` | Competition info for a session |
| GET | `/competitions` | List all competitions |
| GET | `/competitions/:id` | Get single competition |
| GET | `/competition` | Live competition detector state |
| POST | `/analytics` | Track page view |

### Admin (requires Bearer token)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/track` | Change track `{trackId}` |
| GET | `/system` | Server CPU/RAM/disk stats |
| GET | `/analytics?days=` | Visitor analytics |
| GET | `/db/collector-log?limit=` | Recent sessions (raw) |
| POST | `/competitions` | Create competition |
| PATCH | `/competitions/:id` | Update competition (name, format, date, sessions, results, status) |
| DELETE | `/competitions/:id` | Delete competition |
| POST | `/competitions/:id/link-session` | Link session to phase `{sessionId, phase}` |
| POST | `/competitions/:id/unlink-session` | Unlink session `{sessionId}` |
| POST | `/competition/start` | Manual competition start |
| POST | `/competition/stop` | Stop competition |
| POST | `/competition/phase` | Mark phase |
| POST | `/competition/reset` | Reset detection |

### Auth
Admin endpoints require `Authorization: Bearer {ADMIN_TOKEN}` header. Token set via `ADMIN_TOKEN` env var on collector. If ADMIN_TOKEN is empty, all requests pass (dev mode).

## Session Merging Logic
When returning sessions via `/db/sessions?date=`, the collector:
1. Enriches sessions with best_lap_pilot, best_lap_kart, competition info
2. Merges sessions with same `race_number` within 5-minute gap
3. Adds `day_order` (1-based position within day)
4. Returns `merged_session_ids` array for merged sessions
5. Filters laps >= 38s for best lap calculation

## Competition Auto-Linking
In `poller.js`, when a new session starts:
1. Calls `storage.autoLinkSessionToActiveCompetition(sessionId)`
2. Finds the live competition, determines the next phase after the last used one
3. Links the session to that phase
4. On session end < 60s: calls `storage.autoUnlinkSession(sessionId)` to free the phase

## Data Filtering (SQL level)
`MIN_LAP_SEC = 38` applied to all statistical queries via SQL expressions:
- `getSessionsWithStats` — best lap time
- `getKartStats` / `getKartStatsBySessions` — kart statistics
- `getLapsByKart` — kart detail laps
- `getKartSessionCounts` — per-kart session counts
