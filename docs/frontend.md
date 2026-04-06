# Frontend Documentation

## Overview
React 18 SPA with TypeScript, Vite, Tailwind CSS. Firebase Auth for Google Sign-In.

**Location**: project root (`src/`)
**Dev server**: `npm run dev` → localhost:5173

## Page Structure

### Public Pages
| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Timing.tsx` | Live timing with SessionReplay + TrackMap + LapsByPilots |
| `/onboard` | `Onboard.tsx` | Fullscreen kart timing for phone on kart (landscape) |
| `/onboard/:kartId` | `Onboard.tsx` | Onboard for specific kart |
| `/sessions` | `SessionsList.tsx` | Date navigator + sortable session list |
| `/sessions/:id` | `SessionDetail.tsx` | Replay + laps grid + track map |
| `/info/karts` | `Karts.tsx` | Kart stats with multi-date filtering |
| `/info/karts/:id` | `KartDetail.tsx` | Per-kart sessions table |
| `/info/tracks` | `Tracks.tsx` | Track configurations |
| `/info/videos` | `Videos.tsx` | Videos |
| `/results` | `CompetitionPage.tsx` | Unified competition list (all types, date navigator, filters) |
| `/results/current` | `CurrentRace.tsx` | Redirects to active live competition |
| `/results/:type` | `CompetitionPage.tsx` | Pre-filtered competition list for format |
| `/results/:type/:eventId` | `CompetitionPage.tsx` | Competition detail with Live/Final tabs |
| `/pilots/:name` | `PilotProfile.tsx` | Pilot profile (placeholder) |
| `/login` | `Login.tsx` | Google Sign-In |

### Admin Pages (owner only)
| Route | Component | Description |
|-------|-----------|-------------|
| `/admin` | `AdminPanel.tsx` | Moderator management |
| `/admin/pages` | `PageSettings.tsx` | Toggle page visibility for users/admins |
| `/admin/db` | `DatabaseStats.tsx` | SQLite DB stats from collector |
| `/admin/monitoring` | `Monitoring.tsx` | Server CPU/RAM/disk, analytics |
| `/admin/collector-log` | `CollectorLog.tsx` | Raw session log from collector |
| `/admin/competitions` | `CompetitionManager.tsx` | Competition CRUD + session linking |
| `/admin/scoring` | `ScoringSettings.tsx` | View/edit scoring tables |

## Key Components

### `SessionReplay` (`components/Timing/SessionReplay.tsx`)
The core replay component used on Timing (live), SessionDetail (replay), and CompetitionPage (live, `showScrubber=false`).

**Props:**
- `laps` — lap data array with pilot, kart, lapNumber, lapTime, s1, s2, position, ts
- `durationSec` — total duration for scrubber
- `sessionStartTime?` — unix ms, enables timestamp-based positioning
- `isLive?` — pins scrubber at end, shows LIVE button
- `liveEntries?` — live timing entries (updates every 1s)
- `s1Events?` — S1 sector events for mid-lap S1 display
- `snapshots?` — position snapshots for race sort (from all event types)
- `startPositions?` — start grid positions (from competition or first snapshot)
- `raceGroup?` — group number (1/2/3) for points calculation
- `totalQualifiedPilots?` — for position points scoring table
- `defaultSortMode?` — `'qualifying'` or `'race'` (auto-set from competition phase)
- `showScrubber?` — `true` (default) or `false` (competition page hides scrubber)
- `autoPlay?`, `raceNumber?`, `onTimeUpdate?`, `onEntriesUpdate?`, `renderScrubber?`
- `columnFilter?`, `onColumnFilterChange?` — controlled column filter mode

**Exported utilities:**
- `S1Event` interface
- `SnapshotPosition` interface
- `ReplaySortMode` type
- `parseSessionEvents(rawEvents)` — parses all event types into s1Events + position timeline

**Internal structure:** Manages replay logic (animation loop, `getEntriesAtTime`, pilotTimelines, scrubber). Renders `<TimingTable>` internally with computed entries.

### `TimingTable` (`components/Timing/TimingTable.tsx`)
Standalone reusable timing table extracted from SessionReplay. Used in ALL places where a timing table appears (timing page, session detail, competition live session).

**Props:**
- `entries: TimingEntry[]` — pre-computed entries to display
- `sortMode: SortMode` — `'qualifying'` or `'race'`
- `onSortModeChange` — callback to switch sort mode
- `columnFilter?` / `onColumnFilterChange?` — controlled/uncontrolled column filter
- `startPositions?` — `Map<string, number>` for race start data
- `startGrid?` — `Map<number, string>` for Start column display
- `raceGroup?` / `totalQualifiedPilots?` — for points calculation

**Table columns:**
- `#` — current position
- `Start` — pilot name at start position (race mode only, with start data)
- `↔` (arrows) — SVG Bezier curved arrows from start to finish position (race mode only)
- `Δ` — position change vs start (race mode only, green ↑ / red ↓)
- Pilot name (with progress bar — bordered outline, full-width, yellow fill)
- `P` — race points: position + overtake (race mode + competition only)
- Kart, Last lap, S1, S2, Best lap, Best S1, Best S2, TB (theoretical best = bestS1 + bestS2), L (lap count)

**Column visibility system ("Вид:"):**
- `Все` — all columns visible
- `Осн` — main columns only (hides S1, S2, bestS1, bestS2, TB)
- `Своє` — custom: draggable column pills, click to toggle on/off, persisted per sort mode in localStorage
- `start` and `arrows` columns are fixed-position (always first, not draggable) and only visible when `sortMode === 'race'` AND start data exists

**Sort mode buttons:** Квала / Гонка toggle

**Arrow rendering:** SVG Bezier curves in a `<td rowSpan={n}>` on the first row. Uses `ResizeObserver` on tbody for dynamic height. Colors: green shades (gained positions), red shades (lost), gray (same).

### `LapsByPilots` (`components/Timing/LapsByPilots.tsx`)
Laps-by-pilots grid. Each cell shows lap time + S1/S2 (hundredths, green/purple only).

**Props:** `pilots`, `currentEntries?`, `isLive?`, `onRenamePilot?`
**Features:**
- Kart number shown under pilot name in header
- ✎ rename button (owner only, calls onRenamePilot callback)
- S1/S2 in text-[8px] below lap time, space-separated, green (PB) or purple (overall best)
- Current lap highlight (ring) during replay

### `LeagueResults` (`components/Results/LeagueResults.tsx`)
Full scoring table for Light League / Champions League competitions. Uses shared `scoring.ts` module for all calculations.

**Props:** format, competitionId, sessions, sessionLaps, liveSessionId, livePositions, livePilots, liveEnabled, onToggleLive, initialExcludedPilots, initialEdits, onSaveResults

**Features:**
- Scoring logic delegated to `src/utils/scoring.ts` (`computeStandings()`)
- Auto-calculates: speed points (top-5), position points, overtake points (progressive)
- Live timing positions override DB positions for active session (2s updates)
- Start positions pre-filled for next race before it starts
- `● LIVE` toggle button — pause/resume live updates
- Active session pilots highlighted (green tint)
- Sort preference persisted per competition in localStorage
- Editable fields (owner): Start, Finish, Penalties (keep focus during live re-renders)
- ✎ rename pilot (updates DB for ALL competition sessions)
- ✕ exclude/include pilot
- 3-row header: Race → columns + "Бали" sub-header (Позиція, Обгони, Штрафи, Сума)
- Speed points column after Час
- Points highlighted green, penalties red
- **Standings push**: calls `onSaveResults({ standings })` every 10s (debounced) to persist standings on collector
- **View modes** (Все/Бали/Час/Поз/Ред/Своє): unified column visibility via `PRESET_COLS`
  - "Своє" (custom): draggable group pills, click to toggle groups/sub-groups
  - Clicking group headers (Квала, Гонка N) toggles all sub-columns
  - Clicking sub-groups (Поз, Час, Швидк, Бали) toggles individual columns
  - Custom column set persisted per user+competition in localStorage
- **Toolbar layout**: "Сорт:" (first row), "Вид:" (second row)
- **Tap-to-select**: pilot rows stay highlighted until tapped again
- **Touch feedback**: `active:bg-dark-700/30` on table rows

### `Onboard` (`pages/Info/Onboard.tsx`)
Fullscreen kart timing page designed for phone mounted on kart (landscape).

**Features:**
- Large last lap time (clamp 4-10rem) with color coding
- S1 / S2 with colors (hundredths)
- Position: `4/10` during competition (computed from all qualifying/race sessions), `4` otherwise
- Kart number button top-left → dropdown with all karts + pilots
- Left/right arrow buttons to switch karts
- 🔒 orientation lock button
- ← Таймінг link, LIVE indicator
- Competition-aware: fetches related sessions, builds cross-session ranking

### `TimingBoard` (`components/Timing/TimingBoard.tsx`)
Simple timing board with qualifying/race sort toggle. Used when SessionReplay has no data.
Includes onboard link (camera icon) per kart row.

### Other Components
- `SessionsTable` — shared session list (used on Sessions, Karts, KartDetail, Timing, CompetitionPage)
- `SessionTypeChanger` — dropdown for assigning sessions to competitions, auto-links surrounding sessions, detects group count by pilot overlap
- `DateNavigator` — single-select (Sessions) or multi-select (Karts); today's date highlighted green (`bg-green-600/20`)
- `TrackMap` — SVG track map with animated kart positions
- `DayTimeline` — scrollable session activity timeline
- `CompetitionControl` — inline competition detector controls
- `CompetitionTimeline` (`components/Results/CompetitionTimeline.tsx`) — horizontal scrubber for competition page, shows sessions as green segments with phase labels, click to navigate to session detail. Session name is a clickable link; time display is plain text.
- `CompetitionList` / `CompetitionListItem` (`pages/Results/CompetitionPage.tsx`) — unified list with date navigator, type filters, sort, top-3 pilots from stored standings
- `TableLayoutBar` (`components/TableLayoutBar.tsx`) — "Вид:" bar for page-level section visibility (drag to reorder, click to toggle). Used on timing, session detail, competition pages.
- `UserDropdown` (`components/Layout/Header.tsx`) — extracted user menu dropdown component with `position: fixed` positioning
- `EditableCell` (`components/Results/LeagueResults.tsx`, top-level function) — input with focus protection, prefix support (for penalties "-"), MUST stay outside LeagueResults to prevent remount
- `EditLog` (`components/Results/LeagueResults.tsx`) — shows audit log of all manual edits

## Services

### `timingPoller.ts`
Hook `useTimingPoller()` — polls collector `/status` and `/timing`.
- Tracks bestS1/bestS2 per pilot across polls (ref-based)
- Converts kart to Number (API returns string)
- Clears bests on session change
- Returns: entries, snapshots, mode, lastUpdate, error, collectorStatus

### `auth.tsx`
Firebase Auth with role system:
- **Owner**: `makandrol@gmail.com` (hardcoded)
- **Moderator**: emails in localStorage
- **User**: anyone else
- Localhost auto-grants owner role

### `viewPrefs.ts`
Persists view preferences per user email in localStorage.

### `layoutPrefs.tsx`
Page-level section visibility and ordering system.
- `LayoutPrefsProvider` — React context provider
- `useLayoutPrefs()` — hook returning `isSectionVisible`, `toggleSection`, `reorderSections`, `resetPage`
- `PAGE_SECTIONS` — definitions for each page: timing, sessionDetail, competition
- Competition sections: Таймлайн, Заїзд, Результати, Список заїздів
- Merges server defaults (from collector `/view-defaults`) with local overrides in localStorage
- Version-based override: server can bump version to force reset user customizations
- `HARDCODED_DEFAULTS` — fallback when server unreachable (competition version: 2)

### `pageVisibility.tsx`
Manages which pages are visible per role. Groups: main, other, admin. Competitions moved from dropdown group to main nav as a direct Link to `/results`.

### `config.ts`
`COLLECTOR_URL` from env var `VITE_COLLECTOR_URL` or default.

## Utilities

### `utils/scoring.ts` (NEW — shared scoring module)
Pure functions extracted from LeagueResults for reuse:
- `parseLapSec(lapTime)` — parse lap time string to seconds
- `getOvertakeRate(position, format)` — get overtake multiplier for a position
- `calcOvertakePoints(startPos, finishPos, format)` — calculate progressive overtake points
- `getPositionPoints(position, totalPilots, scoring)` — look up position points from scoring table
- `computeStandings(params: ComputeStandingsParams)` — main function: builds qualifying data, splits groups, computes race results with all points
- `rowsToStandings(rows, excludedPilots)` — converts PilotRow[] to CompetitionStandings for storage on collector

**Types exported:** `SessionLap`, `CompSession`, `ScoringData`, `PilotQualiData`, `PilotRaceData`, `PilotRow`, `ManualEdits`, `StandingsPilot`, `CompetitionStandings`, `ComputeStandingsParams`

### `utils/timing.ts`
- `parseTime(str)` — "42.574" → 42.574, "1:02.222" → 62.222
- `toSeconds(str)` — converts to seconds string (3 decimals)
- `toHundredths(str)` — converts to seconds string (2 decimals, for S1/S2)
- `getTimeColor(value, personalBest, overallBest)` — purple/green/yellow/none
- `mergePilotNames(laps)` — replaces "Карт X" with real name on same kart
- `shortName(name)` — "Апанасенко Олексій" → "Апанасенко О."
- `fmtBytes(n)` — human-readable bytes
- `fetchRaceStartPositions(collectorUrl, competitionId, phase, format)` — computes start positions from qualifying/previous race, returns `{positions, totalQualified}`
- `isValidSession(session)` — returns false for sessions < 3 minutes (MIN_SESSION_DURATION_MS = 180000). Used across all pages for filtering.
- `loadWithExpiry(storage, key)` — load value from storage, returns null if expired (end of day)
- `saveWithExpiry(storage, key, value)` — save value to storage with end-of-day expiry timestamp

### `utils/session.ts`
- `buildReplayLaps(dbLaps)` — converts `DbLap[]` to `ReplayLap[]` format for SessionReplay
- `extractCompetitionReplayProps(phase)` — extracts `raceGroup` and `isRace` from phase string

### `data/competitions.ts`
Competition format configs with `PHASE_CONFIGS`, `splitIntoGroups()`, `getPhaseLabel()`, `getPhasesForFormat(format, groupCount)`.
- `getPhasesForFormat()` — filters phases by group count (e.g. with 2 groups, skips qualifying_3/4 and group_3 phases)

### `data/changelog.ts`
`APP_VERSION` — auto-imported from package.json.

## Styling
- Dark theme with Tailwind CSS custom colors (`dark-*`, `primary-*`)
- Header: NOT sticky (scrolls with page)
- Footer: version + links only (no logo)
- SessionReplay table: tight padding (`px-0.5 py-0.5`), narrow pilot column (`w-[140px]`), bordered progress bar (full-width, border-dark-600/50, yellow fill)
- TimingTable: sort mode toggle (Квала/Гонка), Вид: bar (Все/Осн/Своє), draggable column pills in custom mode
- Color coding: `text-purple-400` (overall best), `text-green-400` (PB), `text-yellow-400` (slower)

## Recent Changes (v0.9.191–0.9.195)

### TimingTable extraction (v0.9.191)
- Extracted reusable `TimingTable` component from `SessionReplay` (~280 lines)
- Contains: sort mode buttons, Вид: bar (Все/Осн/Своє), draggable column pills, column persistence
- New columns: `Start` (pilot name at start position) and `arrows` (SVG Bezier curved paths)
- `RACE_ONLY_COLS = new Set(['start', 'arrows'])` — only shown in race mode with start data
- `SessionReplay` now renders `<TimingTable>` internally instead of inline table JSX
- Added `startGrid` memo to compute `Map<number, string>` from `startPositions`

### Competition page rewrite (v0.9.191)
- Replaced old `QualifyingLiveTable` and `RaceLiveTable` with `SessionReplay(showScrubber=false)`
- `LiveSessionTable` fetches events (s1/snapshots) for active session on 3s interval
- Computes `startPositions` from qualifying/previous race data inline
- Converts laps via `buildReplayLaps()`, passes to `SessionReplay`
- Full "Вид:" column selector now available in live timing on competition page

### UI improvements (v0.9.192–0.9.194)
- `Start` column header (was "Старт")
- `Δ` column label (was "+/-") — both in column header and Вид pills
- `Δ` column narrower (`w-5`, `px-0.5`)
- Pilot column narrower (`w-[140px] max-w-[200px]`)
- Progress bar: bordered outline (`border border-dark-600/50`), full-width, 2px height
- Arrows stay in fixed position in custom (Своє) column mode — not draggable, always first
- Competition timeline: only session name is a clickable link, time is plain text
- Track selector icon changed from globe to finish flag
- LeagueResults toolbar: Сорт: first row, Вид: second row (swapped)

### Competition page sections (v0.9.193)
- Added `sessions` section to live competition layout (was only in admin view)
- All 4 pills in Вид bar now work: Таймлайн, Заїзд, Результати, Список заїздів

### Layout prefs bugfix (v0.9.195)
- Fixed `toggleSection` not persisting when server defaults unavailable
- `updateLocal` now falls back to `HARDCODED_DEFAULTS` version when `serverDefaults` is empty
- Previously: `basedOnVersion` was set to 0 (server empty), but hardcoded defaults had version 2, so `mergeDefaults` always ignored user's override

## Previous Changes (v0.9.119)

### Scoring
- Scoring data now loaded from collector API (`GET /scoring`) with fallback to static file
- `ScoringSettings` saves to collector via `POST /scoring`
- `LeagueResults` loads from collector API

### Track Management
- `trackContext` now sends track changes to collector via `POST /track`
- Track selector on competition page narrower (w-10), no label
- Track changes update all linked sessions via `POST /competitions/:id/update-track`

### Competition Page
- Always opens "Live результати" tab by default
- Tab preference (live/final) saved to localStorage (auth users) or sessionStorage (anon)
- Competition params redesigned:
  - Separate "А" (Auto) buttons for pilots and groups
  - Pilots and groups use input fields (not dropdowns)
  - Auto-detected values shown when auto is on (disabled input)
  - Icons: 👥 for pilots, 🎯 for groups
  - Bordered boxes for visual grouping

### Laps-by-Pilots
- Table aligned left instead of center
- Column width reduced to 60px
- Pilot name font: `text-[9px]`
- Kart number font: `text-[10px]`
- Rename button font: `text-[8px]`
