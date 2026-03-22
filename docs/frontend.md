# Frontend Documentation

## Overview
React 18 SPA with TypeScript, Vite, Tailwind CSS. Firebase Auth for Google Sign-In.

**Location**: project root (`src/`)
**Dev server**: `npm run dev` → localhost:5173

## Page Structure

### Public Pages
| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `Timing.tsx` | Live timing with SessionReplay + TrackMap |
| `/sessions` | `SessionsList.tsx` | Date navigator + session list from collector |
| `/sessions/:id` | `SessionDetail.tsx` | Replay + laps grid for a session |
| `/info/karts` | `Karts.tsx` | Kart stats with session-based filtering |
| `/info/karts/:id` | `KartDetail.tsx` | Per-kart pilot leaderboard + top laps |
| `/info/tracks` | `Tracks.tsx` | Track configurations |
| `/info/videos` | `Videos.tsx` | Videos |
| `/results/*` | Various | Competition results (placeholder) |
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

## Key Components

### `SessionReplay` (`components/Timing/SessionReplay.tsx`)
The core replay component used on both Timing (live) and SessionDetail pages.

**Props:**
- `laps` — array of `{pilot, kart, lapNumber, lapTime, s1, s2, position, ts?}`
- `durationSec` — total duration for scrubber
- `sessionStartTime?` — unix ms, enables real timestamp-based positioning
- `isLive?` — hides max time, shows LIVE button
- `raceNumber?` — displayed as "Заїзд №X"
- `autoPlay?` — starts playing immediately
- `onEntriesUpdate?` — callback with TimingEntry[] for TrackMap sync

**How it works:**
1. Builds per-pilot timelines from lap timestamps
2. At any scrubber position, calculates each pilot's progress around the track
3. For finished laps, estimates current position based on average lap time
4. Renders timing board with progress bars, S1/S2/lap colors
5. TrackMap uses `static` mode — positions from `progress` field

### `DayTimeline` (`components/Timing/DayTimeline.tsx`)
Scrollable timeline showing session activity for a day.

**Features:**
- 6-hour visible window, draggable
- 3 colors: red (offline), yellow (idle), green (session)
- Race numbers on green segments
- Day navigation with ← → buttons
- Session counts from API

### `DateNavigator` (`components/Sessions/DateNavigator.tsx`)
Shared date picker used on Sessions, Karts, and KartDetail pages.

**Structure:**
- This week (Mon-today)
- Previous week (collapsible)
- Years → Months → Weeks (expandable tree)
- Session counts under each date
- Inactive dates without sessions

### `TrackMap` (`components/Track/TrackMap.tsx`)
SVG track map with animated kart positions.

**Modes:**
- `static` — positions from `entry.progress`, used with SessionReplay
- Live — wall-clock animation based on lap number changes

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

### `pageVisibility.tsx`
Manages which pages are visible per role. Stored in localStorage.
ALL_PAGES array defines all pages with group (main/competitions/other/admin).

### `config.ts`
`COLLECTOR_URL` from env var `VITE_COLLECTOR_URL` or default.

## Utilities

### `utils/timing.ts`
- `parseTime(str)` — "42.574" → 42.574, "1:02.222" → 62.222
- `toSeconds(str)` — converts any format to seconds string
- `mergePilotNames(laps)` — replaces "Карт X" with real pilot name on same kart
- `shortName(name)` — "Апанасенко Олексій" → "Апанасенко О."
- `fmtBytes(n)` — human-readable bytes

## Styling
- Dark theme with Tailwind CSS custom colors (`dark-*`, `primary-*`)
- Custom classes: `.nav-link`, `.card`, `.table-header`, `.table-row`, `.table-cell`
- `.scrollbar-none` for hidden scrollbars
- Position colors: `.position-1` (gold), `.position-2` (silver), `.position-3` (bronze)
