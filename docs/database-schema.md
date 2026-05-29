# Database Schema

SQLite database через `better-sqlite3`. Файл: `collector/data/karting.db` (локально, не в git) або `/home/ubuntu/collector/data/karting.db` (production).

Schema створюється автоматично при старті collector через `db.exec(...)` у `collector/src/storage.js`.

---

## sessions

```sql
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,        -- "session-{unix_ms}"
  start_time    INTEGER NOT NULL,        -- unix ms
  end_time      INTEGER,                 -- unix ms (null = ще активна)
  pilot_count   INTEGER DEFAULT 0,
  track_id      INTEGER DEFAULT 1,
  race_number   INTEGER,
  is_race       INTEGER DEFAULT 0,       -- 1 для гонок змагань (для merge)
  date          TEXT NOT NULL            -- "YYYY-MM-DD" (local date)
);
```

## events (event log)

```sql
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  event_type   TEXT NOT NULL,            -- snapshot | lap | s1 | update | pilot_join | pilot_leave | poll_ok
  ts           INTEGER NOT NULL,         -- unix ms
  data         TEXT,                     -- JSON (depends on type)
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_events_session_ts ON events(session_id, ts);
CREATE INDEX idx_events_ts ON events(ts);
```

`snapshot` — лише на старті сесії. Усі інші — diff-події. Деталі формату — `docs/architecture.md`.

## laps

```sql
CREATE TABLE laps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  pilot        TEXT NOT NULL,
  kart         INTEGER NOT NULL,
  lap_number   INTEGER NOT NULL,
  lap_time     TEXT,                     -- "42.574" або "1:02.222"
  s1           TEXT,
  s2           TEXT,
  best_lap     TEXT,
  position     INTEGER,
  ts           INTEGER NOT NULL,         -- unix ms
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_laps_session ON laps(session_id);
CREATE INDEX idx_laps_pilot ON laps(pilot);
```

Filtering: `MIN_LAP_SEC = 38` — кола < 38с фільтруються в SQL queries для всіх агрегатів.

## competitions

```sql
CREATE TABLE competitions (
  id              TEXT PRIMARY KEY,      -- {format}-{date}-{ts}
  name            TEXT NOT NULL,
  format          TEXT,                  -- gonzales | light_league | champions_league | sprint | marathon
  date            TEXT,
  sessions        TEXT NOT NULL DEFAULT '[]',
                                          -- JSON: [{sessionId, phase}]
  results         TEXT,
                                          -- JSON: { excludedPilots, edits, excludedLaps,
                                          --         editLog, standings, groupCountOverride,
                                          --         totalPilotsOverride, totalPilotsLocked,
                                          --         racePilotCount, ... }
  uploaded_results TEXT,                  -- legacy: imported xlsx data
  status          TEXT NOT NULL DEFAULT 'live'  -- live | finished
);
```

### `results` JSON структура (приклад)

```json
{
  "excludedPilots": ["Іванов І."],
  "excludedLaps": ["session-1700000000|Петренко П.|1700000123456"],
  "edits": {
    "1": { "Сидоров С.": { "startPos": 5, "finishPos": 3, "penalties": 2 } }
  },
  "editLog": [
    { "pilot": "Сидоров С.", "action": "set finishPos", "detail": "5 → 3", "user": "owner@email", "ts": 1700000000000 }
  ],
  "standings": {
    "updatedAt": 1700000000000,
    "pilots": [
      {
        "pilot": "Апанасенко О.",
        "totalPoints": 42.5,
        "qualiTime": "40.823",
        "qualiKart": 7,
        "qualiSpeedPoints": 2.5,
        "group": 1,
        "races": [
          { "startPos": 12, "finishPos": 1, "positionPoints": 12,
            "overtakePoints": 8.5, "speedPoints": 2.5, "penalties": 0 }
        ]
      }
    ]
  },
  "groupCountOverride": 2,
  "totalPilotsOverride": null,
  "totalPilotsLocked": false,
  "racePilotCount": 24
}
```

## db_stats (key-value)

```sql
CREATE TABLE db_stats (
  key         TEXT PRIMARY KEY,
  value       TEXT,                     -- JSON для composite values
  updated_at  INTEGER
);
```

Використовується для:
- `current_track_id` — поточний трек
- `scoring` — scoring rules JSON (fallback з `public/data/scoring.json`)
- `view_defaults` — layout prefs з версіонуванням
- `page_visibility` — server-side page visibility
- `moderators` — список модераторів

## Analytics

```sql
CREATE TABLE page_views (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  date       TEXT NOT NULL,
  path       TEXT NOT NULL,
  session_id TEXT,
  user_email TEXT,
  user_name  TEXT,
  user_agent TEXT,
  ip         TEXT
);
CREATE INDEX idx_pv_date ON page_views(date);
CREATE INDEX idx_pv_email ON page_views(user_email);

CREATE TABLE visitor_sessions (
  session_id  TEXT PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  page_count  INTEGER DEFAULT 1,
  user_email  TEXT,
  user_name   TEXT,
  date        TEXT NOT NULL
);
CREATE INDEX idx_vs_date ON visitor_sessions(date);
```

## Migrations

У `storage.js` після `CREATE TABLE` ідуть idempotent migrations через `try/catch`:

```js
try { db.exec('ALTER TABLE sessions ADD COLUMN track_id INTEGER DEFAULT 1'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN race_number INTEGER'); } catch {}
try { db.exec('ALTER TABLE sessions ADD COLUMN is_race INTEGER DEFAULT 0'); } catch {}
try { db.exec("ALTER TABLE competitions ADD COLUMN status TEXT NOT NULL DEFAULT 'live'"); } catch {}
```

При додаванні нової колонки — додай свій `try/catch` ALTER, а не пиши міграції окремо.

## Backup

Backup БД на сервері — через cron, файли вантажаться в `backups/` (gitignored). Цей репо не керує backup-логікою.
