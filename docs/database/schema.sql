-- ============================================================
-- Karting "Жага Швидкості" — Database Schema
-- Target: Supabase (PostgreSQL)
-- ============================================================

-- 1. ПІЛОТИ
CREATE TABLE pilots (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  full_name     TEXT,
  country       TEXT,
  license_id    TEXT,
  email         TEXT UNIQUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. КАРТИ
CREATE TABLE karts (
  number        INTEGER PRIMARY KEY,
  status        TEXT DEFAULT 'unknown',
  notes         TEXT
);

-- 3. КОНФІГУРАЦІЇ ТРАС
CREATE TABLE track_configs (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  length_m      INTEGER,
  turns         INTEGER,
  image_url     TEXT,
  svg_path      TEXT,
  s1_point      JSONB,
  speed_profile JSONB,
  reference_lap_time REAL,
  grid_positions JSONB,
  pit_positions  JSONB
);

-- 4. ЗАЇЗДИ
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  date          DATE NOT NULL,
  session_number INTEGER NOT NULL,
  track_config_id INTEGER REFERENCES track_configs(id),
  start_time    TIMESTAMPTZ,
  end_time      TIMESTAMPTZ,
  type          TEXT NOT NULL,
  competition_event_id TEXT,
  phase_name    TEXT,
  is_competition BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ЛОГ ПОДІЙ (для реплеїв)
CREATE TABLE session_events (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  ts            BIGINT NOT NULL,
  data          JSONB
);
CREATE INDEX idx_events_session_ts ON session_events(session_id, ts);
CREATE INDEX idx_events_type ON session_events(event_type);

-- 6. КОМПАКТНІ КОЛА
CREATE TABLE laps (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id),
  pilot_id      TEXT NOT NULL REFERENCES pilots(id),
  kart_number   INTEGER NOT NULL,
  lap_number    INTEGER NOT NULL,
  lap_time_ms   INTEGER NOT NULL,
  s1_ms         INTEGER,
  s2_ms         INTEGER,
  is_valid      BOOLEAN DEFAULT TRUE,
  recorded_at   TIMESTAMPTZ NOT NULL,
  UNIQUE(session_id, pilot_id, lap_number)
);
CREATE INDEX idx_laps_session ON laps(session_id);
CREATE INDEX idx_laps_pilot ON laps(pilot_id);
CREATE INDEX idx_laps_kart ON laps(kart_number);
CREATE INDEX idx_laps_valid_time ON laps(lap_time_ms) WHERE is_valid;

-- 7. ЗМАГАННЯ
CREATE TABLE competitions (
  id            TEXT PRIMARY KEY,
  format        TEXT NOT NULL,
  name          TEXT NOT NULL,
  season        TEXT
);

-- 8. ПОДІЇ ЗМАГАНЬ
CREATE TABLE competition_events (
  id            TEXT PRIMARY KEY,
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  date          DATE NOT NULL,
  track_config_id INTEGER REFERENCES track_configs(id),
  name          TEXT,
  total_pilots  INTEGER
);

-- 9. ФАЗИ ЗМАГАНЬ
CREATE TABLE competition_phases (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES competition_events(id),
  type          TEXT NOT NULL,
  name          TEXT NOT NULL,
  phase_order   INTEGER NOT NULL,
  session_id    TEXT REFERENCES sessions(id)
);

-- 10. РЕЗУЛЬТАТИ ЗМАГАНЬ
CREATE TABLE competition_results (
  id            BIGSERIAL PRIMARY KEY,
  phase_id      TEXT NOT NULL REFERENCES competition_phases(id),
  pilot_id      TEXT NOT NULL REFERENCES pilots(id),
  kart_number   INTEGER,
  group_number  INTEGER,
  start_position INTEGER,
  finish_position INTEGER,
  best_lap_ms   INTEGER,
  position_points  REAL DEFAULT 0,
  overtake_points  REAL DEFAULT 0,
  speed_points     REAL DEFAULT 0,
  penalty_points   REAL DEFAULT 0,
  qualifying_points REAL DEFAULT 0,
  extra_weight     REAL DEFAULT 0,
  UNIQUE(phase_id, pilot_id)
);

-- 11. РЕКОРДИ КАРТІВ
CREATE TABLE kart_records (
  id            BIGSERIAL PRIMARY KEY,
  kart_number   INTEGER NOT NULL REFERENCES karts(number),
  pilot_id      TEXT NOT NULL REFERENCES pilots(id),
  lap_time_ms   INTEGER NOT NULL,
  track_config_id INTEGER,
  recorded_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_kart_records_time ON kart_records(kart_number, lap_time_ms);

-- 12. КОРИСТУВАЧІ
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  photo_url     TEXT,
  role          TEXT DEFAULT 'user',
  pilot_id      TEXT REFERENCES pilots(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE moderator_permissions (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL,
  PRIMARY KEY(user_id, permission)
);

-- 13. СИСТЕМНИЙ СТАН
CREATE TABLE system_state (
  key           TEXT PRIMARY KEY,
  value         JSONB,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 14. ДІАПАЗОНИ ПОРОЖНІХ ПОЛІВ (компактний формат POLL_OK)
CREATE TABLE poll_ranges (
  id            BIGSERIAL PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  start_ts      BIGINT NOT NULL,
  end_ts        BIGINT NOT NULL,
  poll_count    INTEGER NOT NULL
);
