# Collector Documentation

## Overview
The collector is a Node.js HTTP server that polls the karting timing API, stores data in SQLite, and serves it to the frontend.

**Location**: `collector/` directory
**Runtime**: Node.js 20, no framework (plain `http` module)
**Database**: SQLite via `better-sqlite3` at `collector/data/karting.db`
**Current version**: 0.3.3

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | HTTP server, all API endpoints, CORS |
| `src/poller.js` | `TimingPoller` — core polling engine, session management, event diffing |
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
    pilot_count INTEGER DEFAULT 0,
    track_id INTEGER DEFAULT 1,
    race_number INTEGER,
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
    lap_time TEXT,
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
    name TEXT NOT NULL,
    format TEXT,                    -- light_league, champions_league, gonzales, sprint, marathon
    date TEXT,
    sessions TEXT NOT NULL DEFAULT '[]',  -- JSON: [{sessionId, phase}]
    results TEXT,                   -- JSON: {excludedPilots:[], edits:{}}
    uploaded_results TEXT,
    status TEXT NOT NULL DEFAULT 'live'
);
```

### Other tables
- `page_views` — analytics
- `visitor_sessions` — analytics
- `db_stats` — key-value system state

## API Endpoints

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| GET | `/status` | Poller status + DB stats |
| GET | `/timing` | Current timing data + competition state |
| GET | `/track` | Current track ID |
| GET | `/events?session=&since=` | Event log (in-memory) |
| GET | `/sessions` | In-memory session list |
| GET | `/db/sessions?date=` | Sessions from DB (merged, with stats) |
| GET | `/db/laps?session=` | Laps for a session |
| GET | `/db/laps?kart=&from=&to=` | Laps for a kart in date range |
| GET | `/db/events?session=&since=` | Events from DB |
| GET | `/db/session-counts?from=&to=` | Session counts per date |
| GET | `/db/kart-stats?from=&to=` | Kart stats by date range |
| POST | `/db/kart-stats` | Kart stats by session IDs |
| GET | `/db/kart-session-counts?kart=` | Per-kart session counts |
| GET | `/db/session-competition?session=` | Competition info for a session |
| GET | `/competitions` | List all competitions |
| GET | `/competitions/:id` | Get single competition |
| GET | `/competition` | Live competition detector state |
| POST | `/analytics` | Track page view |

### Admin (requires Bearer token)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/track` | Change track |
| GET | `/system` | Server CPU/RAM/disk stats |
| GET | `/analytics?days=` | Visitor analytics |
| GET | `/db/collector-log?limit=` | Recent sessions (raw) |
| POST | `/competitions` | Create competition |
| PATCH | `/competitions/:id` | Update competition |
| DELETE | `/competitions/:id` | Delete competition |
| POST | `/competitions/:id/link-session` | Link session to phase |
| POST | `/competitions/:id/unlink-session` | Unlink session |
| POST | `/competition/start` | Manual competition start |
| POST | `/competition/stop` | Stop competition |
| POST | `/competition/phase` | Mark phase |
| POST | `/competition/reset` | Reset detection |
| POST | `/db/rename-pilot` | Rename pilot in session laps `{sessionId, oldName, newName}` |

## Event Diffing Logic (`poller.js`)

The `#diff()` method compares previous and current timing data:

1. **New pilot**: `pilot_join` event
2. **Lap completed** (lapCount increased): `lap` event (includes position, s1, s2, team data)
3. **S1 changed** (same lapCount): `s1` event (includes team with position)
4. **Non-volatile field changed** (position, pit status, etc.): `update` event
5. **Pilot gone**: `pilot_leave` event
6. **No changes**: `poll_ok` event

**Volatile fields** (ignored in diff): `totalOnTrack`, `secondsFromPit`, `timeFromLassPassing`, `lastPitMainTime`

**Important**: Snapshots are only emitted at session start (not periodic). All position changes are captured via `update` events.

## Session Merging Logic
When returning sessions via `/db/sessions?date=`:
1. Enriches sessions with best_lap_pilot, competition info
2. Merges sessions with same `race_number` within 5-minute gap
3. Adds `day_order` (1-based position within day)
4. Filters laps >= 38s for best lap calculation

## Competition Auto-Linking
In `poller.js`, when a new session starts:
1. `storage.autoLinkSessionToActiveCompetition(sessionId)` — links to next phase
   - Respects `groupCountOverride` from competition results
   - Filters phases via format-specific phase list (skips group_3 if 2 groups)
2. After first lap: `storage.recheckSessionPhase(sessionId)` — detects group count
   - Compares new session pilots with all previous qualifying pilots
   - If ≥50% overlap → this is a race, not another qualifying
   - Sets `groupCountOverride` and reassigns phase accordingly
3. On session end < 60s: `storage.autoUnlinkSession(sessionId)`

## Data Filtering (SQL level)
`MIN_LAP_SEC = 38` applied to all statistical queries.
