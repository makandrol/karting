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
    participant TT as TimingTable
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
        SR->>TT: entries, sortMode, columnFilter, startPositions, startGrid
        SR->>Track: entries with positions + progress
    end
```

### TimingTable Component
Standalone reusable timing table with full column management:
- Квала/Гонка sort mode toggle (hidden when not a competition race via `isCompetitionRace` prop)
- Вид: (Все/Осн/Своє) column visibility bar with draggable pills
- Separate "Осн" presets per mode: `MAIN_QUAL_VISIBLE` (with Start/arrows), `MAIN_RACE_VISIBLE` (with Gap, without Start/arrows)
- Separate column order per mode: `DEFAULT_ORDER` (qualifying), `RACE_ORDER` (race: Δ, P, Pilot, L, GAP, Kart, ...)
- "Своє" custom view inherits the mode-specific order as default
- Start column + SVG Bezier curved arrows (race mode only, toggleable as group)
- `Gap` column — precise time distance to pilot ahead (race mode only, in `RACE_ONLY_COLS`):
  - Same lap: cumulative lap time difference
  - Different laps: `+NL`
  - Mid-lap: S1 timestamp gap
  - Format: `+X.XX` (hundredths)
- `TB` (theoretical best = bestS1+bestS2) and `Loss` (best lap minus TB) as separate columns
- `Δ` column for position change
- Pilot progress bar with bordered outline
- Kart number in blue (`KART_COLOR` from `utils/timing.ts`)
- Column order/visibility persisted per sort mode in localStorage
- `start` and `arrows` columns are fixed-position, auto-shown/hidden based on race data

### Sort Modes

**Qualifying** (default): sorted by best lap time
**Race**: sorted by:
1. Lap count (desc)
2. Snapshot positions — ground truth from timing system (lower = ahead)
3. Last recorded position from completed lap
4. Track progress (desc, if diff > 0.01)
5. Start positions (fallback)

### GAP Calculation (Race Mode)

GAP shows the precise time distance between consecutive pilots:
- **Different laps**: `+NL` (e.g., `+2L`)
- **Same lap, both passed S1**: gap computed from S1 event timestamps (`pilotS1Events`)
- **Same lap, finish line**: gap = cumulative lap time difference (`sum(lapTimes_B) - sum(lapTimes_A)`)
  - Uses cumulative lap time sums, NOT poll timestamps — gives precise relative gap independent of polling frequency
- **No data**: `null` (displays as "—")
- Format: `+X.XX` (hundredths, always positive with `+` prefix, uses `Math.abs`)
- Computed in `getEntriesAtTime()` after sorting, stored in `TimingEntry.gap` field
- `pilotTimelines` (reconstructed from `firstTs - firstLapSec * 1000`) used for replay animation and S1 gap reference points
- `pilotCumLapMs` (cumulative lap time sums from raw lap data) used for finish-line gap — avoids poll timestamp artifacts

## Competition Scoring Flow

```mermaid
sequenceDiagram
    participant LR as LiveResults
    participant API as Collector API
    participant League as LeagueResults
    participant Scoring as scoring.ts

    loop Every 3s (slow poll)
        LR->>API: GET /competitions/:id
        LR->>API: GET /db/laps (per session)
        LR-->>League: competition + sessionLaps
    end

    loop Every 2s (fast poll)
        LR->>API: GET /status + /timing
        LR-->>League: liveSessionId + livePositions + livePilots
    end

    League->>Scoring: computeStandings(params)
    Scoring->>Scoring: Build qualifying data (best times, speed points)
    Scoring->>Scoring: Split into groups (1-3)
    loop For each race
        Scoring->>Scoring: Compute start positions (reverse prev race/quali)
        Scoring->>Scoring: Compute finish positions (race mode + live positions)
        Scoring->>Scoring: Calculate points (position + overtakes progressive)
    end
    Scoring-->>League: PilotRow[] with all computed data

    loop Every 10s (debounced)
        League->>League: rowsToStandings(rows, excludedPilots)
        League->>API: onSaveResults({ standings })
        API->>API: Store in competition results.standings
    end
```

## Scoring Module (`src/utils/scoring.ts`)

Shared pure-function module extracted from LeagueResults for reuse across components.

### Exported Functions
| Function | Purpose |
|----------|---------|
| `parseLapSec(lapTime)` | Parse lap time string to seconds |
| `getOvertakeRate(position, format)` | Get overtake multiplier for a position |
| `calcOvertakePoints(startPos, finishPos, format)` | Calculate progressive overtake points |
| `getPositionPoints(position, totalPilots, scoring)` | Look up position points from scoring table |
| `computeStandings(params)` | Main function: full scoring computation |
| `rowsToStandings(rows, excludedPilots)` | Convert PilotRow[] to CompetitionStandings for storage |

### Exported Types
`SessionLap`, `CompSession`, `ScoringData`, `PilotQualiData`, `PilotRaceData`, `PilotRow`, `ManualEdits`, `StandingsPilot`, `CompetitionStandings`, `ComputeStandingsParams`

## Standings Storage

```mermaid
sequenceDiagram
    participant LR as LeagueResults
    participant API as Collector
    participant List as Competition List

    LR->>LR: computeStandings() every render
    LR->>LR: rowsToStandings(rows, excludedPilots)
    LR->>API: onSaveResults({ standings }) [debounced 10s]
    API->>API: Store in competition.results.standings
    List->>API: GET /competitions
    API-->>List: competitions with results.standings
    List->>List: Display top-3 pilots with points
```

### Standings Format
```json
{
  "updatedAt": 1712000000000,
  "pilots": [
    {
      "pilot": "Апанасенко Олексій",
      "totalPoints": 42.5,
      "qualiTime": "40.823",
      "qualiKart": 7,
      "qualiSpeedPoints": 2.5,
      "group": 1,
      "races": [
        { "startPos": 12, "finishPos": 1, "positionPoints": 12, "overtakePoints": 8.5, "speedPoints": 2.5, "penalties": 0 }
      ]
    }
  ]
}
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
- `extractCompetitionReplayProps(phase)` — shared function: extracts `raceGroup` and `isRace` from competition phase string (e.g., `race_1_group_2`). Used by SessionDetail, CompetitionPage, and Timing to determine if session is a competition race.

### Live Competition Updates
- `● LIVE` toggle button: pause/resume live polling
- Active session pilots highlighted (green tint)
- EditableCell keeps focus during re-renders (skips value sync while focused)
- Overtake points use progressive calculation (each position has own rate)
- Standings auto-pushed to collector every 10s (debounced) via `onSaveResults({ standings })`

### View Modes (LeagueResults)
- Все/Бали/Час/Поз/Ред/Своє — unified column visibility system
- "Своє" (custom): draggable group pills, click to toggle groups/sub-columns
- Custom column set persisted per user+competition in localStorage
- Tap-to-select pilot rows (stays highlighted until tapped again)
- Toolbar: "Сорт:" first row, "Вид:" second row

### View Preferences & Layout Prefs
- `layoutPrefs.tsx` — page-level section visibility (Таймлайн, Заїзд, Результати, Список заїздів)
- `TableLayoutBar` — draggable section pills with toggle
- Server defaults from collector `/view-defaults` with version-based override
- Fallback to `HARDCODED_DEFAULTS` when server unreachable
- `updateLocal()` correctly uses `serverDefaults || HARDCODED_DEFAULTS` for version

### Competition Page (Unified)
- Single `/results` route shows ALL competitions
- Date navigator with this week default, previous week collapsible
- Type filter buttons (Все | Гонзалес | ЛЛ | ЛЧ | Спринти | Марафони)
- Competition date derived from first session timestamp
- Top-3 pilots with points shown (from stored standings)
- "Змагання" moved from dropdown to direct Link in header nav

### Mobile Optimizations
- `html, body { overflow-x: hidden }` prevents horizontal page scroll
- Header nav: `overflow-x-auto scrollbar-none` for horizontal scrolling
- All dropdowns: `position: fixed` with parent-level ref (no flicker)
- `UserDropdown` as separate component
- Tailwind `hoverOnlyWhenSupported: true` — hover only on pointer devices
- `-webkit-tap-highlight-color: transparent` on body
- `active:bg-dark-700/30` for touch feedback on table rows
- Today's date highlighted green (`bg-green-600/20`) on date navigators

### Settings Persistence
- Filter settings (competitions + karts dates) expire at end of day
- `loadWithExpiry(storage, key)` / `saveWithExpiry(storage, key, value)` utility functions
- Next day opens with default selections (current week for competitions, today for karts)
- Competition type filters, date selection, sort direction all persisted with expiry

### View Preferences
User view preferences (show/hide track, laps-by-pilots, league tables) persisted in localStorage by user email.

### Layout Preferences (`layoutPrefs.tsx`)
Page-level section visibility system with server defaults + local overrides:
- `LayoutPrefsProvider` wraps the app, provides `useLayoutPrefs()` hook
- `toggleSection(pageId, sectionId)` — flip visibility, persist to localStorage
- `reorderSections(pageId, fromIdx, toIdx)` — drag to reorder sections
- Server defaults fetched from collector `GET /view-defaults` with version numbers
- When server bumps version, local overrides reset to server defaults
- `HARDCODED_DEFAULTS` fallback when server unreachable (competition version: 2)
- Competition sections: timeline, liveSession, leaguePoints, sessions (default: sessions hidden)
