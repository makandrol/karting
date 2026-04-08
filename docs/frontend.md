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
| `/admin` | → `/admin/access` | Redirects to access settings |
| `/admin/access` | `AccessSettings.tsx` | Moderators, custom accounts, page visibility, table defaults (drag-reorder sections) |
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

**Internal structure:** Manages replay logic (animation loop, `getEntriesAtTime`, pilotTimelines, pilotCumLapMs for GAP, scrubber). Renders `<TimingTable>` internally with computed entries. Passes `isCompetitionRace` to TimingTable.

**Key internal data structures:**
- `pilotTimelines` — `Map<string, number[]>`: per-pilot absolute completion timestamps, reconstructed from `firstTs - firstLapSec * 1000` + cumulative lap times. Used for replay animation (completedLaps, progress) and S1 gap reference points.
- `pilotCumLapMs` — `Map<string, number[]>`: per-pilot cumulative lap time sums in ms (built from raw lap data, independent of poll timestamps). Used for precise finish-line GAP calculation.
- `pilotS1Events` — `Map<string, S1Event[]>`: per-pilot S1 sector events with real timestamps. Used for mid-lap GAP updates.
- `snapshotPositions` — `Map<string, number>`: latest position snapshot before current replay time. Ground truth from timing system, highest priority in race sort.

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
- `isCompetitionRace?` — when true, shows Квала/Гонка toggle; when false/undefined, hides it

**Table columns:**
- `#` — current position
- `Start` — pilot name at start position (race mode only, with start data)
- `↔` (arrows) — SVG Bezier curved arrows from start to finish position (race mode only)
- `Δ` — position change vs start (race mode only, green ↑ / red ↓)
- Pilot name (with progress bar — bordered outline, full-width, yellow fill)
- `P` — race points: position + overtake (race mode + competition only)
- Kart number (blue — `KART_COLOR` constant from `utils/timing.ts`)
- `Gap` — precise time distance to pilot ahead (race mode only):
  - Same lap: cumulative lap time difference (format: `+X.XX`)
  - Different laps: `+NL`
  - No data: "—"
- Last lap, S1, S2, Best lap, Best S1, Best S2
- `TB` — theoretical best (bestS1 + bestS2)
- `Loss` — difference between best lap and TB (how much slower than theoretical)
- `L` — lap count

**Column order:**
- Qualifying: `Start, Arrows, Δ, Pilot, P, Kart, Gap, Last, S1, S2, Best, B.S1, B.S2, TB, Loss, L` (DEFAULT_ORDER)
- Race: `Start, Arrows, Δ, P, Pilot, L, Gap, Kart, Last, S1, S2, Best, B.S1, B.S2, TB, Loss` (RACE_ORDER)

**Column visibility system ("Вид:"):**
- `Все` — all columns visible (race mode uses `RACE_ORDER`, qualifying uses `DEFAULT_ORDER`)
- `Осн` — main columns only:
  - **Qualifying**: Start, arrows, Δ, Pilot, P, Kart, Last, Best, L (hides S1, S2, bestS1, bestS2, TB, Loss, Gap)
  - **Race**: Δ, Pilot, P, Kart, Gap, Last, Best, L (hides Start, arrows, S1, S2, bestS1, bestS2, TB, Loss)
- `Своє` — custom: draggable column pills, click to toggle on/off, persisted per sort mode in localStorage
  - Default order inherits from mode-specific order (`RACE_ORDER` for race, `DEFAULT_ORDER` for qualifying)
  - `Start` and `arrows` toggle together as a group, only shown when start data exists
  - `Gap` pill hidden in qualifying mode (race-only column)
  - `start` and `arrows` columns are fixed-position (always first, not draggable)

**Sort mode buttons:** Квала / Гонка toggle — only visible when `isCompetitionRace` is true

**Arrow rendering:** SVG Bezier curves in a `<td rowSpan={n}>` on the first row. Uses `ResizeObserver` on tbody for dynamic height. Colors: green shades (gained positions), red shades (lost), gray (same).

### `LapsByPilots` (`components/Timing/LapsByPilots.tsx`)
Laps-by-pilots grid. Each cell shows lap time + S1/S2 (hundredths, green/purple only).

**Props:** `pilots`, `currentEntries?`, `isLive?`, `onRenamePilot?`, `excludedLaps?`, `onToggleLap?`, `sessionId?`, `startPositions?`
**Features:**
- Pilot name truncated via `compactName()`: max 10 chars. Surname >7 → first 10 chars (no initial). Surname ≤7 → "Surname F." format. Full name shown on hover via `title`.
- Kart label: "Карт X" (left-aligned), in blue (`KART_COLOR`)
- ✎ rename button after kart number (owner only, uses `onPointerDown` + `setTimeout(…, 10)` with IIFE closure for reliable click handling — survives React re-renders from `currentEntries` updates)
- **View mode ("Вид: Осн / Все")**: "Осн" (default) hides S1/S2 sector rows, "Все" shows sectors under each lap
- **Sort mode ("Сорт: Час / Поз")**: only shown for race sessions when `startPositions` present
  - "Час" (default): sorts pilots by best lap time
  - "Поз": sorts pilots by last lap's position field
- Toolbar order: Вид first, then Сорт
- **Position change arrows** (competition race only, when `startPositions` present):
  - Green ▲N next to lap time when pilot gained N positions vs previous lap
  - Red ▼N when pilot lost positions
  - First lap compares to `startPositions`, subsequent laps compare to previous lap's `position` field
  - Uses `posDelta = prevPos - lap.position` calculation
- S1/S2 in text-[8px] below lap time (in "Все" mode only), space-separated, green (PB) or purple (overall best)
- Current lap highlight (ring) during replay
- ✕/↩ lap exclusion buttons on hover (owner only, when session belongs to competition)
- All pilot columns uniform width: `min-w-[100px]`

**LapData interface:** `{ lapNumber, lapTime, s1, s2, bestLap, kart, ts, position?: number | null }`

### `LeagueResults` (`components/Results/LeagueResults.tsx`)
Full scoring table for Light League / Champions League / Sprint competitions. Uses shared `scoring.ts` module for all calculations. Dispatches to `computeStandings()` (LL/CL) or `computeSprintStandings()` (Sprint) based on format.

**Props:** format, competitionId, sessions, sessionLaps, liveSessionId, livePositions, livePilots, liveEnabled, onToggleLive, initialExcludedPilots, initialEdits, onSaveResults

**Features:**
- Scoring logic delegated to `src/utils/scoring.ts` (`computeStandings()` / `computeSprintStandings()`)
- Auto-calculates: speed points (top-5), position points, overtake points (progressive, LL/CL only)
- Live timing positions override DB positions for active session (2s updates)
- Start positions pre-filled for next race before it starts
- `● LIVE` toggle button — pause/resume live updates
- Active session pilots highlighted (green tint)
- Sort preference persisted per competition in localStorage
- Editable fields (owner): Start, Finish, Penalties (keep focus during live re-renders)
- ✎ rename pilot (updates DB for ALL competition sessions)
- ✕ exclude/include pilot
- 3-row header: Race → columns + "Бали" sub-header
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

**Sprint-specific features:**
- `raceCount = 3` (Гонка 1, Гонка 2, Фінал), `qualiCount = 2` (Кв1, Кв2)
- **Column order in "Бали" sub-header**: Швидк, Штрафи, Позиція, Сума (Sprint-specific order)
- **Cumulative sums**: Race 2 "Сума" = cumulative total (q1_speed + r1_total + q2_speed + r2_total); Final "Сума" = `row.totalPoints` (total competition points)
- **Sort buttons** ("Сорт:"): Сума, Кв1, Г1, Кв2, Г2, Г2 сума, Фінал
- **"Г2 сума" sort key** (`race_2_cumsum`): sorts by cumulative points after Race 2
- **Sort column highlighting**: active sort column highlighted with `bg-primary-600/10` via `sortColId` useMemo + `isSortCol()` helper. Applied to both header `th` and data `td` cells across both table rendering paths
- **Clickable column headers**: Час (asc first click), Позиція (desc first), Сума (desc first) — all clickable to sort. Uses `colSortInfo()` mapping column IDs to sort keys + default directions, `handleColClick()` handler, `sortableCursor()` for cursor-pointer
- **Two table rendering paths**: First table uses generic `cellForCol` function (compact view with `RACE_COLS_H`); Second table uses explicit `cv()`/`colVisible()` checks (expanded view). Both paths must be kept in sync for any column changes.

**Type `SortKey`**: `'total' | 'quali_time' | \`race_${number}_time\` | \`race_${number}_points\` | \`race_${number}_pos_pts\` | \`quali_${number}_time\` | 'race_2_cumsum'`

**IMPORTANT — React hooks ordering**: The `sortColId` useMemo (and `isSortCol`, `SORT_HL` constants) MUST be defined BEFORE any early returns (e.g. `if (!scoring) return ...`). Moving them after early returns causes "Rendered more hooks than during the previous render" error.

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
- Localhost auto-grants owner role via `IS_LOCALHOST` check
- **Localhost logout**: `localhostLoggedOut` state flag — logout sets `true` (user becomes null), `loginWithGoogle` resets to `false` (user returns to auto-owner)
- `useAuth()` hook: returns `user`, `isOwner`, `hasPermission(permission)`, `loginWithGoogle()`, `logout()`

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

### `utils/scoring.ts` (shared scoring module)
Pure functions extracted from LeagueResults for reuse:
- `parseLapSec(lapTime)` — parse lap time string to seconds
- `getOvertakeRate(scoring, group, position, isCL)` — get overtake multiplier for a position
- `calcOvertakePoints(scoring, group, startPos, finishPos, isCL)` — calculate progressive overtake points
- `getPositionPoints(scoring, totalPilots, group, finishPos)` — look up position points from scoring table
- `computeStandings(params: ComputeStandingsParams)` — main function for LL/CL: builds qualifying data, splits groups, computes race results with all points
- `getSprintPositionPoints(finishPos)` — Sprint race position points (40/37/35/33/31... scale, -2 per position)
- `getSprintFinalPoints(finishPos, precedingPilots)` — Sprint final points (starts at 180, -3 per position across all groups)
- `computeSprintStandings(params: ComputeStandingsParams)` — Sprint scoring: 2 qualis, 2 races, final with tiered sequential grouping
- `sprintAwareSort(a, b, format?)` — sort with Sprint-specific tiebreakers (q1 time → r1 points → ...)
- `rowsToStandings(rows, excludedPilots, format?)` — converts PilotRow[] to CompetitionStandings for storage on collector

**Sprint scoring details:**
- No overtake points — only position points + speed points
- Speed points: 1pt for fastest in each group per qualifying and per race (not top-5 like LL/CL)
- Position points: 40/37/35/33/31/29/27/... (getSprintPositionPoints)
- Final: sequential tiered grouping (best → Pro, middle → Gold, rest → Light) based on cumulative Race 1+2 points
- Final position points: continuous scale starting at 180, -3 per position across all groups (Pro gets highest, then Gold, then Light)
- Group splitting for races 1-2: snake/round-robin via `splitIntoGroupsSprint`
- Group splitting for final: sequential tiered via inline logic in `computeSprintStandings`

**Types exported:** `SessionLap`, `CompSession`, `ScoringData`, `PilotQualiData`, `PilotRaceData`, `PilotRow`, `ManualEdits`, `StandingsPilot`, `CompetitionStandings`, `ComputeStandingsParams`

### `utils/timing.ts`
- `parseTime(str)` — "42.574" → 42.574, "1:02.222" → 62.222
- `toSeconds(str)` — converts to seconds string (3 decimals)
- `toHundredths(str)` — converts to seconds string (2 decimals, for S1/S2)
- `getTimeColor(value, personalBest, overallBest)` — purple/green/yellow/none
- `COLOR_CLASSES` — maps TimeColor to Tailwind classes
- `KART_COLOR` — unified kart number color (`'text-blue-400'`), used across all tables (TimingTable, TimingBoard, LapsByPilots, SessionDetail, CompetitionPage, LeagueResults, ResultsTable)
- `mergePilotNames(laps)` — replaces "Карт X" with real name on same kart
- `shortName(name)` — "Апанасенко Олексій" → "Апанасенко О." (used in TimingTable pilot column)
- `fmtBytes(n)` — human-readable bytes
- `fetchRaceStartPositions(collectorUrl, competitionId, phase, format)` — computes start positions from qualifying/previous race, returns `{positions, totalQualified}`. For Sprint finals (`final_group_N`), computes cumulative points from all previous phases (qualis + races), sorts, and does tiered sequential split into groups.
- `isValidSession(session)` — returns false for sessions < 3 minutes (MIN_SESSION_DURATION_MS = 180000). Used across all pages for filtering.
- `loadWithExpiry(storage, key)` — load value from storage, returns null if expired (end of day)
- `saveWithExpiry(storage, key, value)` — save value to storage with end-of-day expiry timestamp

### `utils/session.ts`
- `buildReplayLaps(dbLaps)` — converts `DbLap[]` to `ReplayLap[]` format for SessionReplay (includes `position` field)
- `extractCompetitionReplayProps(phase)` — extracts `raceGroup` and `isRace` from phase string. Shared function used by SessionDetail, CompetitionPage, and Timing to determine if session is a competition race.

### `data/competitions.ts`
Competition format configs with `PHASE_CONFIGS`, `splitIntoGroups()`, `splitIntoGroupsSprint()`, `getPhaseLabel()`, `getPhaseShortLabel()`, `getPhasesForFormat(format, groupCount)`.
- `getPhasesForFormat()` — filters phases by group count (e.g. with 2 groups, skips qualifying_3/4 and group_3 phases)
- `splitIntoGroups(pilots, maxGroups)` — LL/CL group split (top pilots in group 1)
- `splitIntoGroupsSprint(pilots, maxGroups)` — Sprint snake/round-robin split for races 1-2 (balanced groups)
- `getPhaseLabel(format, phaseId)` — full Ukrainian label for a phase (e.g. "Кваліфікація 1 · Група 1")
- `getPhaseShortLabel(format, phaseId)` — short label (e.g. "Кв1 · Г1")

### `data/changelog.ts`
`APP_VERSION` — auto-imported from package.json.

## Styling
- Dark theme with Tailwind CSS custom colors (`dark-*`, `primary-*`)
- Header: NOT sticky (scrolls with page)
- Footer: version + links only (no logo)
- SessionReplay table: tight padding (`px-0.5 py-0.5`), narrow pilot column (`w-[140px]`), bordered progress bar (full-width, border-dark-600/50, yellow fill)
- TimingTable: sort mode toggle (Квала/Гонка), Вид: bar (Все/Осн/Своє), draggable column pills in custom mode
- LapsByPilots: Вид: bar (Все/Осн), uniform column width (`min-w-[100px]`), centered kart+pencil row
- Color coding: `text-purple-400` (overall best), `text-green-400` (PB), `text-yellow-400` (slower)
- Kart numbers: `KART_COLOR` (`text-blue-400`) — unified constant across all tables
- Track selector: bordered frame with flag icon + dropdown, same style on competition, timing, and session detail pages

## Recent Changes (v0.9.240–v0.9.265)

### Sprint results table improvements (v0.9.260–v0.9.265)

#### Column order swap (v0.9.260)
- Sprint "Бали" sub-header column order changed to: Швидк, Штрафи, Позиція, Сума (was: Швидк, Позиція, Штрафи, Сума)
- Required changes in ~10 locations across both table rendering paths: `RACE_COLS_H`, `RACE_COLS`, `SUB_GROUPS`, `PRESET_COLS`, `ptsCols`, `allSubCols`, explicit `th` headers, `td` data cells

#### Sprint cumulative sums (v0.9.260)
- Race 2 "Сума" column: shows cumulative total = q1_speed + r1_total + q2_speed + r2_total (not just race 2 total)
- Final "Сума" column: shows `row.totalPoints` (total competition points)
- Same logic implemented in both table rendering paths (cellForCol and explicit cv() cells)

#### isSprint scope fix (v0.9.260)
- Fixed `isSprint is not defined` error when clicking timeline
- `isSprint` was defined inside a `useMemo` callback in `LiveSessionTable` (CompetitionPage.tsx) but used outside it
- Fixed by adding `const isSprint = competition.format === 'sprint';` at the component level

#### Sprint final start positions (v0.9.261)
- Finals now treated as Sprint races with start/finish position display and ▲/▼ arrows
- Added full Sprint final start position computation in two locations:
  1. `CompetitionPage.tsx` `LiveSessionTable`'s `startPositions` useMemo — for live timing view
  2. `utils/timing.ts` `fetchRaceStartPositions` — for individual session pages
- Both compute: best times per pilot from each quali, race finish order per group, speed points per group, cumulative points, sort by cumulative (tiebreak: q1 best time), tiered sequential split into groups
- `SessionDetail.tsx`: condition extended to trigger `fetchRaceStartPositions` for `final_` phases
- `Timing.tsx`: condition extended to show start positions for `final_` phases

#### "Г2 сума" sort button (v0.9.262)
- New sort key `race_2_cumsum` — sorts by cumulative points through Race 2
- SortBtn added after "Г2" in Sprint sort buttons bar

#### Sort column highlighting (v0.9.263–v0.9.264)
- Active sort column highlighted with `bg-primary-600/10` (for ALL competition formats, not just Sprint)
- `sortColId` useMemo maps `sortKey` → column ID (e.g. `'race_1_time'` → `'r1_time'`)
- `isSortCol(colId)` checks if column matches current sort
- `SORT_HL = 'bg-primary-600/10'` applied to both `th` headers and `td` data cells
- **v0.9.264 critical fix**: moved `sortColId` useMemo BEFORE early returns to fix "Rendered more hooks than during the previous render" error

#### Clickable column headers (v0.9.265)
- Clicking "Час" header sorts ascending (first click), "Позиція" sorts descending, "Сума" sorts descending
- `colSortInfo(colId)` maps column IDs to sort keys + default directions
- `handleColClick(colId)` triggers sort with correct direction
- `sortableCursor(colId)` adds `cursor-pointer hover:text-white` to sortable headers
- Sprint "Сума" for Race 2 maps to `race_2_cumsum`, for Final maps to `total`
- Both sort buttons bar AND clickable headers coexist

## Previous Changes (v0.9.223–0.9.238)

### Session detail track dropdown (v0.9.223)
- Replaced static track text with dropdown selector (same pattern as Timing/CompetitionPage)
- Uses `isReverseTrack`/`baseTrackId` for sorting, `handleChangeTrack` with `POST /db/update-sessions-track`

### LapsByPilots enhancements (v0.9.224–0.9.228)
- Kart label: "КХ" → "Карт Х", left-aligned
- Pencil rename: `onPointerDown` + `setTimeout(…, 10)` with IIFE closure (fix for React re-render losing handler)
- Default view: "Осн" (was "Все")
- Position change arrows (▲/▼) for competition races: green for gained, red for lost, using `position` from lap data and `startPositions`
- Sort toggle "Сорт: Час/Поз" (race sessions only): sorts by best time or last lap position
- Toolbar order: Вид first, Сорт second

### TimingTable enhancements (v0.9.229–0.9.238)
- Квала/Гонка toggle hidden when not competition race (`isCompetitionRace` prop, uses shared `extractCompetitionReplayProps()`)
- GAP column: precise time distance via cumulative lap times (was best lap diff). Format: `+X.XX`, `+NL`, or "—"
- Race column order: `RACE_ORDER` = `Δ, P, Pilot, L, GAP, Kart, Last, ...`
- Custom view default order inherits from mode-specific order
- Race sort: snapshotPositions now highest priority (was progress)

### Types (v0.9.233)
- `TimingEntry.gap?: string | null` — gap to pilot ahead

## Previous Changes (v0.9.196–0.9.222)

### Auth fixes (v0.9.209–0.9.212)
- Fixed header dropdown click handling: added `data-dropdown` attribute to fixed-position popups
- Added `onMouseEnter`/`onMouseLeave` on nav dropdown popups for hover behavior
- Rewrote `UserDropdown` to click-only (removed hover open/close that conflicted with `position: fixed`)
- Fixed logout on localhost: added `localhostLoggedOut` state flag in `auth.tsx` — `IS_LOCALHOST` auto-owner now respects logout

### Admin AccessSettings drag-reorder (v0.9.213)
- Fixed drag-and-drop reorder in "Дефолтні настройки таблиць" section
- Added `wasDragged` ref to prevent click (toggle visibility) from firing after drag
- Added `onDragEnd` handler and visual feedback (opacity + ring) for dragged items

### Track selector unification (v0.9.214)
- Competition page: track frame same height as pilots/groups frames (`py-1`)
- Timing page: replaced separate "Траса" label + select with bordered frame (flag icon + dropdown) matching competition page style, positioned after status badge
- Session detail page: replaced inline "Траса X" text with bordered frame (flag icon + number)

### TimingTable column changes (v0.9.205–0.9.208, v0.9.215)
- Pilot column: `min-w-[150px]` (was fixed `w-[200px]`)
- Arrows column: `min-w-[100px] w-[100px]` with `minWidth` on td style
- Split `TB` column into two: `TB` (theoretical best = bestS1 + bestS2) and `Loss` (best lap minus TB)
- Added `Gap` column (race mode only): diff in best lap to pilot ahead, positioned after Kart before Last
- Added `Start` toggle to "Вид: Своє" — toggles `start` and `arrows` together as a group
- Race mode "Осн" view: shows Gap but hides Start/arrows
- Qualifying "Осн" view: unchanged (shows Start/arrows if data exists)
- `RACE_ONLY_COLS` now includes `gap` — auto-hidden in qualifying mode
- `MAIN_QUAL_VISIBLE` and `MAIN_RACE_VISIBLE` — separate sets for each mode

### LapsByPilots improvements (v0.9.216–0.9.219, v0.9.221)
- `compactName()` function for pilot name truncation (max 10 chars): surname >7 → first 10 chars, surname ≤7 → "Surname F."
- Full name shown on hover via `title` attribute
- Pencil (✎) button: moved after kart number, uses `onPointerDown` (was `onClick`), bigger (10px with padding)
- Kart number: centered with pencil, larger font (11px)
- All pilot columns: uniform width `min-w-[100px]`
- Added "Вид: Все / Осн" toggle: "Осн" hides sector times (S1/S2) under each lap

### Unified kart color (v0.9.220, v0.9.222)
- Added `KART_COLOR` constant in `utils/timing.ts` — `'text-blue-400'`
- Applied across all tables: TimingTable, TimingBoard, LapsByPilots, SessionDetail, CompetitionPage (Gonzales), LeagueResults, ResultsTable

## Previous Changes (v0.9.191–0.9.195)

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
- Column width: `min-w-[100px]` (uniform)
- Pilot name: `compactName()` with max 10 chars
- Kart number: centered, blue (`KART_COLOR`), `text-[11px]`
- Rename button: `text-[10px]`, after kart number, uses `onPointerDown`
- "Вид: Все / Осн" toggle for hiding sectors
