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
| `/sessions` | `SessionsList.tsx` | Date navigator + sortable session list |
| `/sessions/:id` | `SessionDetail.tsx` | Replay + laps grid + track map (all hideable) |
| `/info/karts` | `Karts.tsx` | Kart stats with multi-date filtering |
| `/info/karts/:id` | `KartDetail.tsx` | Per-kart sessions table with kart-specific counts |
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
| `/admin/scoring` | `ScoringSettings.tsx` | View/edit scoring tables (position/overtake/speed points) |

## Key Components

### `SessionReplay` (`components/Timing/SessionReplay.tsx`)
The core replay component used on both Timing (live) and SessionDetail pages.

**Props:**
- `laps` — array of `{pilot, kart, lapNumber, lapTime, s1, s2, position, ts?}`
- `durationSec` — total duration for scrubber
- `sessionStartTime?` — unix ms, enables real timestamp-based positioning
- `isLive?` — pins scrubber at end (`atLive` mode), shows LIVE button
- `liveEntries?` — live timing entries for real-time S1 display
- `raceNumber?` — displayed as "Заїзд №X"
- `autoPlay?` — starts playing immediately
- `onEntriesUpdate?` — callback with TimingEntry[] for TrackMap sync

**Key behaviors:**
- Scrubber pinned at end in live mode (`atLive` state), user can drag to scrub back
- durationSec stored in ref to avoid RAF restart on changes
- Live S1 shown only when different from previous lap's S1 (new sector pass)
- S1/S2 < 10s filtered from display and best calculations

### `SessionsTable` (`components/Sessions/SessionsTable.tsx`)
Shared session list component used on SessionsList, Karts, KartDetail, Timing, CompetitionPage.

**Shows per row:** day_order, time, duration/LIVE, pilots, type (Прокат X / ЛЛ · Квала 1), track, best lap
**Props:** `sessions`, `showDate?`, `maxHeight?`
**Features:** entire row clickable, competition sessions highlighted in purple

### `SessionTypeChanger` (`components/Timing/SessionTypeChanger.tsx`)
Dropdown for assigning sessions to competitions. Used on Timing and SessionDetail.

**When unlinked (Прокат):** format → competition (or create new) → phase selection → auto-link surrounding sessions
**When linked:** split into two buttons:
- Competition name (links to results page)
- Phase dropdown (change phase all/single, unlink, delete competition)

**Auto-link logic:** finds free sessions before and after current, assigns phases in order.

### `LapsByPilots` (`components/Timing/LapsByPilots.tsx`)
Shared laps-by-pilots grid. Used on Timing (live, no highlight) and SessionDetail (with current lap highlight).

### `LeagueResults` (`components/Results/LeagueResults.tsx`)
Full scoring table for Light League / Champions League competitions.

**Features:**
- Auto-calculates: speed points (top-5), position points, overtake points
- Start positions: reverse order from previous race/qualifying times
- Groups: auto-split by qualifying rank
- Editable fields (owner only): Start, Finish, Penalties — saved to server
- Exclude/include pilots (owner only) — saved to server
- Collapsible column groups (Qualifying, Race 1, Race 2, Race 3)
- Multiple sort options (Total, Qualifying time, Race N time/points)
- Max qualified pilots: LL=36, CL=24 (others get "X")

### `DateNavigator` (`components/Sessions/DateNavigator.tsx`)
Shared date picker with multi-select mode.

**Multi-select mode** (Karts, KartDetail): toggle dates, period "+" buttons, selected/total counts
**Single-select mode** (Sessions): click to select date
**Props:** `selectedDates?`, `onToggleDate?`, `onSelectDates?`, `overrideCounts?`
Auto-expands previous week if selected dates are there.

### `DayTimeline` (`components/Timing/DayTimeline.tsx`)
Scrollable timeline showing session activity for a day.

### `TrackMap` (`components/Track/TrackMap.tsx`)
SVG track map with animated kart positions.

## Services

### `timingPoller.ts`
React hook `useTimingPoller()` — polls collector `/status` and `/timing`.
Returns: entries, mode (live/idle/connecting), collectorStatus.

### `auth.tsx`
Firebase Auth with role system:
- **Owner**: `makandrol@gmail.com` (hardcoded)
- **Moderator**: emails in localStorage
- **User**: anyone else
- Localhost auto-grants owner role

### `viewPrefs.ts`
Persists view preferences (show/hide track, laps-by-pilots, league tables).
Key: `karting_view_prefs_{email}` or `karting_view_prefs_anon`.

### `pageVisibility.tsx`
Manages which pages are visible per role. Stored in localStorage.
Navigation groups: main, competitions, other, admin.

### `config.ts`
`COLLECTOR_URL` from env var `VITE_COLLECTOR_URL` or default.

## Data

### `data/competitions.ts`
Competition format configs with `PHASE_CONFIGS` defining phases per format:
- **Gonzales**: 12 rounds
- **Light League**: 4 qualifying + 7 race phases (3 groups × 2 races + qualifying × 4)
- **Champions League**: 2 qualifying + 6 race phases (2 groups × 3 races)

Includes `shortName` per format (ЛЛ, ЛЧ, Гонз), `getPhaseLabel()`, `getPhaseShortLabel()`.

### `public/data/scoring.json`
Scoring rules for leagues:
- `positionPoints`: 5 categories by pilot count, up to 3 groups each
- `overtakePoints`: per-overtake rates by group and start position
- `speedPoints`: [2.5, 2.0, 1.5, 1.0, 0.5] for top-5 fastest

## Utilities

### `utils/timing.ts`
- `parseTime(str)` — "42.574" → 42.574, "1:02.222" → 62.222
- `toSeconds(str)` — converts any format to seconds string
- `getTimeColor(value, personalBest, overallBest)` — purple/green/yellow/none
- `mergePilotNames(laps)` — replaces "Карт X" with real pilot name on same kart
- `shortName(name)` — "Апанасенко Олексій" → "Апанасенко О." (keeps names ≤10 chars and "Карт X")
- `fmtBytes(n)` — human-readable bytes

## Styling
- Dark theme with Tailwind CSS custom colors (`dark-*`, `primary-*`)
- Custom classes: `.nav-link`, `.card`, `.table-header`, `.table-row`, `.table-cell`
- `.scrollbar-none` for hidden scrollbars
- `.table-cell` uses `px-2.5 py-2` padding
- Header: `sticky top-0 z-[100]`
