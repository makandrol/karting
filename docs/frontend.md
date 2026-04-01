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
| `/results/current` | `CurrentRace.tsx` | Redirects to active live competition |
| `/results/:type` | `CompetitionPage.tsx` | Competition list for format |
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
The core replay component used on both Timing (live) and SessionDetail pages.

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
- `autoPlay?`, `raceNumber?`, `onTimeUpdate?`, `onEntriesUpdate?`, `renderScrubber?`

**Exported utilities:**
- `S1Event` interface
- `SnapshotPosition` interface
- `ReplaySortMode` type
- `parseSessionEvents(rawEvents)` — parses all event types into s1Events + position timeline

**Table columns:**
- `#` — current position
- Pilot name (with progress bar)
- `+/-` — position change vs start (race mode only, green ↑ / red ↓)
- `P` — race points: position + overtake (race mode + competition only)
- Kart, Last lap, S1, S2, Best lap, Best S1, Best S2, TB (theoretical best = bestS1 + bestS2), L (lap count)
- Onboard link (camera icon)

**Sort modes (toggle in scrubber bar):**
- **Квала**: by best lap time
- **Гонка**: by laps desc → progress → recorded position → snapshot position → start position

### `LapsByPilots` (`components/Timing/LapsByPilots.tsx`)
Laps-by-pilots grid. Each cell shows lap time + S1/S2 (hundredths, green/purple only).

**Props:** `pilots`, `currentEntries?`, `isLive?`, `onRenamePilot?`
**Features:**
- Kart number shown under pilot name in header
- ✎ rename button (owner only, calls onRenamePilot callback)
- S1/S2 in text-[8px] below lap time, space-separated, green (PB) or purple (overall best)
- Current lap highlight (ring) during replay

### `LeagueResults` (`components/Results/LeagueResults.tsx`)
Full scoring table for Light League / Champions League competitions.

**Props:** format, competitionId, sessions, sessionLaps, liveSessionId, livePositions, livePilots, liveEnabled, onToggleLive, initialExcludedPilots, initialEdits

**Features:**
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
- `DateNavigator` — single-select (Sessions) or multi-select (Karts)
- `TrackMap` — SVG track map with animated kart positions
- `DayTimeline` — scrollable session activity timeline
- `CompetitionControl` — inline competition detector controls
- `CompetitionTimeline` (`components/Results/CompetitionTimeline.tsx`) — horizontal scrubber for competition page, shows sessions as green segments with phase labels, click to navigate to session detail
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

### `pageVisibility.tsx`
Manages which pages are visible per role. Groups: main, competitions, other, admin.

### `config.ts`
`COLLECTOR_URL` from env var `VITE_COLLECTOR_URL` or default.

## Utilities

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

### `data/competitions.ts`
Competition format configs with `PHASE_CONFIGS`, `splitIntoGroups()`, `getPhaseLabel()`, `getPhasesForFormat(format, groupCount)`.
- `getPhasesForFormat()` — filters phases by group count (e.g. with 2 groups, skips qualifying_3/4 and group_3 phases)

### `data/changelog.ts`
`APP_VERSION` — auto-imported from package.json.

## Styling
- Dark theme with Tailwind CSS custom colors (`dark-*`, `primary-*`)
- Header: NOT sticky (scrolls with page)
- Footer: version + links only (no logo)
- SessionReplay table: tight padding (`px-0.5 py-0.5`), narrow pilot column, thin progress bar
- Color coding: `text-purple-400` (overall best), `text-green-400` (PB), `text-yellow-400` (slower)
