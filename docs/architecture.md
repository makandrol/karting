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

```mermaid
sequenceDiagram
    participant API as Timing API
    participant Poller as Collector Poller
    participant DB as SQLite
    participant FE as Frontend

    loop Every 1s (when online)
        Poller->>API: GET /getmaininfo.json
        API-->>Poller: JSON (teams, entries, meta)
        Poller->>Poller: diff(prev, current)
        alt New session
            Poller->>DB: INSERT session + snapshot event
        end
        alt Lap completed
            Poller->>DB: INSERT lap event + lap record
        end
        alt S1 changed (mid-lap)
            Poller->>DB: INSERT s1 event
        end
        alt Position/field changed
            Poller->>DB: INSERT update event (with team.position)
        end
    end

    FE->>DB: GET /db/sessions?date=
    FE->>DB: GET /db/laps?session=
    FE->>DB: GET /db/events?session=
    FE->>FE: parseSessionEvents() → s1Events + position timeline

    loop Live timing (every 1s via poller hook)
        FE->>Poller: GET /status + /timing
        Poller-->>FE: current entries with positions
    end

    loop Live competition (every 2-3s)
        FE->>DB: GET /competitions/:id
        FE->>DB: GET /db/laps (all sessions)
        FE->>Poller: GET /timing (live positions)
        FE->>FE: Compute scoring table
    end
```

## Adaptive Polling

```mermaid
stateDiagram-v2
    [*] --> Offline
    Offline --> Idle: API responds, no pilots
    Offline --> Online: API responds, pilots on track
    Idle --> Online: Pilots appear
    Online --> Idle: Pilots disappear
    Idle --> Offline: API unreachable
    Online --> Offline: API unreachable

    Offline: Poll every 60s
    Idle: Poll every 10s
    Online: Poll every 1s
```

## Event System

The collector stores events in the `events` table. Each event has `session_id`, `event_type`, `ts` (unix ms), and `data` (JSON).

### Event Types

| Type | When | Data |
|------|------|------|
| `snapshot` | Session start only | `{ entries, teams, meta }` — full state |
| `lap` | Pilot crosses finish | `{ pilot, kart, lapNumber, lastLap, s1, s2, bestLap, position, team }` |
| `s1` | Pilot passes S1 sector (mid-lap) | `{ pilot, kart, s1, team }` |
| `update` | Non-volatile field change (position, pit status) | `{ pilot, kart, team }` |
| `pilot_join` | New pilot appears | `{ pilot, kart }` |
| `pilot_leave` | Pilot disappears | `{ pilot }` |
| `poll_ok` | No changes detected | `null` |

### Position Tracking

Positions are tracked through ALL event types that include `team.position`:
- `snapshot` → `entries[].position`
- `lap` → `data.position` + `data.team.position`
- `s1` → `data.team.position`
- `update` → `data.team.position` (fires when position changes)

Frontend's `parseSessionEvents()` builds an incremental position timeline from all events, giving per-second accuracy for replay.

## Session Replay Architecture

```mermaid
sequenceDiagram
    participant Page as Session Page
    participant SR as SessionReplay
    participant Track as TrackMap

    Page->>Page: Fetch laps + events
    Page->>Page: parseSessionEvents() → s1Events, snapshots
    Page->>Page: fetchRaceStartPositions() (if competition)
    Page->>SR: laps, s1Events, snapshots, startPositions, defaultSortMode

    loop Animation (requestAnimationFrame)
        SR->>SR: getEntriesAtTime(currentTime)
        Note over SR: 1. Count completedLaps from pilotTimelines
        Note over SR: 2. Calculate progress (0..1) on current lap
        Note over SR: 3. Display S1: prevLap.s1 or mid-lap s1Event
        Note over SR: 4. Display S2, lastLap from data/live
        Note over SR: 5. Sort (qualifying=bestLap, race=laps+progress+positions)
        SR->>Track: entries with positions + progress
    end
```

### Sort Modes

**Qualifying** (default): sorted by best lap time
**Race**: sorted by:
1. Lap count (desc)
2. Track progress (desc, if diff > 0.01)
3. Last recorded position from timing
4. Snapshot/event position (from position timeline)
5. Start positions (fallback)

## Competition Scoring Flow

```mermaid
sequenceDiagram
    participant LR as LiveResults
    participant API as Collector API
    participant League as LeagueResults

    loop Every 3s (slow poll)
        LR->>API: GET /competitions/:id
        LR->>API: GET /db/laps (per session)
        LR-->>League: competition + sessionLaps
    end

    loop Every 2s (fast poll)
        LR->>API: GET /status + /timing
        LR-->>League: liveSessionId + livePositions + livePilots
    end

    League->>League: Build qualifying data (best times)
    League->>League: Split into groups (1-3)
    loop For each race
        League->>League: Compute start positions (reverse prev race/quali)
        League->>League: Compute finish positions (race mode + live positions)
        League->>League: Calculate points (position + overtakes progressive)
    end
    League->>League: Pre-fill start positions for next race
```

## Key Design Decisions

### Session Merging
The timing API sometimes briefly drops (1-30s), creating multiple DB sessions for one real race. The collector merges sessions with the same `race_number` within 5 minutes via `/db/sessions?date=`.

### Pilot Name Merging
The timing system sometimes shows "Карт X" for initial laps. `mergePilotNames()` replaces with real names per-session. Manual rename via `/db/rename-pilot` for competition accuracy.

### Start Positions
- **Competition race**: computed from qualifying/previous race (via `fetchRaceStartPositions()`)
- **Regular session (race mode)**: from first snapshot event
- Start positions shown even before race starts (pre-filled from previous phase)

### Live Competition Updates
- `● LIVE` toggle button: pause/resume live polling
- Active session pilots highlighted (green tint)
- EditableCell keeps focus during re-renders (skips value sync while focused)
- Overtake points use progressive calculation (each position has own rate)

### View Preferences
User view preferences (show/hide track, laps-by-pilots, league tables) persisted in localStorage by user email.
