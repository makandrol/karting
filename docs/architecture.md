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
   - On session START: auto-links to active competition's next phase
   - On session END (< 60s): auto-unlinks from competition

3. **Frontend** polls collector via HTTP:
   - `/status` every 1-5s (live timing state)
   - `/timing` when online (current entries)
   - `/db/sessions`, `/db/laps` for historical data
   - `/db/session-competition` for competition info per session

## Key Design Decisions

### Session Merging
The timing API sometimes briefly drops (1-30s), creating multiple DB sessions for one real race. The collector merges sessions with the same `race_number` within 5 minutes when returning data via `/db/sessions?date=`. Merged sessions include `merged_session_ids` array. `day_order` field added to each session (1-based position within day).

### Pilot Name Merging
The timing system sometimes shows "Карт X" for initial laps before the real pilot name appears. The frontend `mergePilotNames()` utility replaces "Карт X" with the real name found on the same kart number. Applied per-session in KartDetail to avoid cross-session name leaks.

### Volatile Fields
Fields that change every poll (totalOnTrack, secondsFromPit, timeFromLassPassing) are ignored during diff comparison. Only meaningful changes (lap completion, S1 sector, pilot join/leave, pit status change) generate events.

### Data Filtering
- Laps < 38 seconds filtered at SQL level (`MIN_LAP_SEC = 38` in storage.js)
- S1/S2 < 10 seconds filtered in frontend display and best calculations
- `shortName()` doesn't truncate names <= 10 chars or "Карт X" patterns

### Live S1 Display
S1 from the timing API represents the LAST COMPLETED lap's S1. On the current unrecorded lap, live S1 is shown only when it differs from the previous lap's S1 (indicating the pilot actually passed the S1 sector on the new lap).

### Scrubber in Live Mode
In live mode, the scrubber (range input) is pinned at the end (`atLive` state). User can drag to scrub back, pressing LIVE returns to pinned mode. Animation loop continues independently for smooth track/progress animations.

### Competition Auto-Linking
When a new session starts and there's an active (live) competition, the session is automatically assigned to the next phase after the last used one. If the session ends in < 60s, it's automatically unlinked (so the next real session can take that phase).

### Cleanup
- `poll_ok` events deleted after 5 days
- Full event log kept for all sessions (for replays)
- No data is ever deleted from sessions/laps tables

### View Preferences
User view preferences (show/hide track, laps-by-pilots, league tables) persisted in localStorage. Key is based on user email (if logged in) or anonymous fallback.
