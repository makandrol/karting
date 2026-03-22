# Architecture

## System Overview

```
┌─────────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Timing API          │     │  Collector        │     │  Frontend (React)  │
│  nfs.playwar.com     │────→│  Node.js + SQLite │←───→│  Vite + Tailwind   │
│  :3333               │poll │  :3001            │HTTP │  :5173 (dev)       │
└─────────────────────┘     └──────────────────┘     └───────────────────┘
                                    │
                            ┌───────┴────────┐
                            │  SQLite DB      │
                            │  karting.db     │
                            │                 │
                            │  sessions       │
                            │  events         │
                            │  laps           │
                            │  competitions   │
                            │  page_views     │
                            │  visitor_sessions│
                            │  db_stats       │
                            └─────────────────┘
```

## Data Flow

1. **Collector** polls `nfs.playwar.com:3333/getmaininfo.json` with adaptive intervals:
   - Offline (API unreachable): every 60s
   - Idle (API reachable, no pilots): every 10s
   - Online (pilots on track): every 1s

2. **Poller** detects session boundaries by `raceNumber` changes:
   - New session created when pilots appear
   - Session closed when pilots disappear or raceNumber changes
   - Events logged: `snapshot`, `lap`, `s1`, `pilot_join`, `pilot_leave`, `update`, `poll_ok`

3. **Frontend** polls collector via HTTP:
   - `/status` every 1-5s (live timing state)
   - `/timing` when online (current entries)
   - `/db/sessions`, `/db/laps` for historical data

## Key Design Decisions

### Session Merging
The timing API sometimes briefly drops (1-30s), creating multiple DB sessions for one real race. The collector merges sessions with the same `race_number` within 5 minutes when returning data via `/db/sessions?date=`.

### Pilot Name Merging
The timing system sometimes shows "Карт X" for initial laps before the real pilot name appears. The frontend `mergePilotNames()` utility replaces "Карт X" with the real name found on the same kart number.

### Volatile Fields
Fields that change every poll (totalOnTrack, secondsFromPit, timeFromLassPassing) are ignored during diff comparison. Only meaningful changes (lap completion, S1 sector, pilot join/leave, pit status change) generate events.

### Cleanup
- `poll_ok` events deleted after 5 days
- Full event log kept for all sessions (for replays)
- No data is ever deleted from sessions/laps tables

### Page Visibility
Owner can configure which pages are visible to users vs admins. Stored in localStorage (`karting_page_visibility_v1`). Pages with `always: true` cannot be disabled.
