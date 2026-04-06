# Karting "Жага Швидкості" — Project Documentation

## Quick Links

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System overview, data flow, tech stack |
| [Collector](./collector.md) | Backend collector: API, database, polling |
| [Frontend](./frontend.md) | React app: pages, components, services |
| [Deployment](./deployment.md) | How to deploy collector and frontend |
| [Development](./development.md) | Dev setup, conventions, versioning |
| [Competition Rules](./competition-rules.md) | Formal rules for Gonzales, LL, CL |

## Project Overview

A real-time karting timing dashboard for the "Жага Швидкості" karting track. Collects live timing data, stores it in SQLite, and provides a web interface for viewing sessions, replays, kart statistics, and managing competitions with live scoring.

## Current State (v0.9.222)

### Recent Changes (v0.9.196 → v0.9.222)

#### Auth & Header fixes (v0.9.209–0.9.212)
- Fixed logout on localhost (added `localhostLoggedOut` flag in `auth.tsx`)
- Fixed `UserDropdown` — rewritten to click-only (removed hover conflicts with `position: fixed`)
- Fixed header dropdown click handling with `data-dropdown` attribute on fixed popups

#### Admin AccessSettings (v0.9.213)
- Fixed drag-and-drop reorder in "Дефолтні настройки таблиць" (added `wasDragged` ref)

#### Track selector unification (v0.9.214)
- All pages (competition, timing, session detail) now use same bordered frame style with flag icon + dropdown

#### TimingTable columns (v0.9.205–0.9.208, v0.9.215)
- Pilot column: `min-w-[150px]`, arrows: `min-w-[100px]`
- Split `TB` into `TB` (theoretical best) + `Loss` (best lap minus TB)
- Added `Gap` column (race mode only: diff in best lap to pilot ahead)
- `Start` toggle in "Вид: Своє" — toggles start+arrows together
- Race mode "Осн": shows Gap, hides Start/arrows

#### LapsByPilots improvements (v0.9.216–0.9.221)
- `compactName()` for pilot names (max 10 chars, surname >7 → truncate)
- Pencil button: fixed (`onPointerDown`), moved after kart number
- Added "Вид: Все / Осн" toggle (Осн hides sectors)
- All columns uniform width `min-w-[100px]`

#### Unified kart color (v0.9.220, v0.9.222)
- `KART_COLOR` constant (`text-blue-400`) applied across ALL tables

### Previous Changes (v0.9.161 → v0.9.195)

#### TimingTable extraction (v0.9.191)
- Extracted reusable `TimingTable` component from `SessionReplay`
- Standalone table with sort modes (Квала/Гонка), Вид: bar (Все/Осн/Своє), draggable column pills
- New columns: `Start` (pilot name at start position) and `arrows` (SVG Bezier curved paths from start to finish)
- `SessionReplay` now uses `TimingTable` internally; retains replay logic
- Column visibility persisted per sort mode in localStorage

#### Competition page rewrite (v0.9.191)
- Replaced old `QualifyingLiveTable`/`RaceLiveTable` with `SessionReplay(showScrubber=false)`
- Full "Вид:" column selector available in live timing on competition page
- `LiveSessionTable` fetches events, computes start positions, passes to `SessionReplay`
- All 4 page-level sections wired up: Таймлайн, Заїзд, Результати, Список заїздів

#### UI improvements (v0.9.192–0.9.194)
- Column labels: `Start` (was "Старт"), `Δ` (was "+/-")
- Narrower Δ column and pilot column
- Progress bar: bordered outline, full-width
- Arrows fixed in custom column mode (always first, not draggable)
- Competition timeline: only session name is a link (not time)
- Track icon: finish flag (was globe)
- LeagueResults: Сорт: first row, Вид: second row

#### Layout prefs bugfix (v0.9.195)
- Fixed `toggleSection` not working when server defaults unavailable
- `updateLocal` now falls back to `HARDCODED_DEFAULTS` version

#### Scoring Module (v0.9.119→v0.9.161)
- Extracted scoring logic from LeagueResults into `src/utils/scoring.ts`
- Pure functions: `parseLapSec()`, `getOvertakeRate()`, `calcOvertakePoints()`, `getPositionPoints()`
- `computeStandings(params)` — main function computing full competition scoring (qualifying, groups, races, points)
- `rowsToStandings(rows, excludedPilots)` — converts PilotRow[] to CompetitionStandings for storage
- Types exported: `SessionLap`, `CompSession`, `ScoringData`, `PilotQualiData`, `PilotRaceData`, `PilotRow`, `ManualEdits`, `StandingsPilot`, `CompetitionStandings`, `ComputeStandingsParams`
- Used by LeagueResults, will be used by future Onboard scoring

#### Standings Storage
- LeagueResults pushes computed standings to collector via `onSaveResults({ standings })` every 10s (debounced)
- Standings stored in competition's `results.standings` field on collector
- Format: `{ updatedAt, pilots: [{ pilot, totalPoints, qualiTime, qualiKart, qualiSpeedPoints, group, races: [...] }] }`
- Competition list reads standings to show top-3 pilots next to each competition

#### Competition Page Redesign
- "Змагання" in header: changed from dropdown to direct Link to `/results`
- `/results` shows ALL competitions (unified page) with:
  - Date navigator (this week selected by default, previous week collapsible, year/month sections)
  - Type filter buttons: Все | Гонзалес | ЛЛ | ЛЧ | Спринти | Марафони
  - Sort button (date ascending/descending)
  - "+X" buttons to select all dates in a period
  - Days show competition short names (ЛЧ, ЛЛ, Гонз) or "–" if none
  - Top-3 pilots with points shown next to each competition
- Competition date derived from first session timestamp (not stored date field)
- "Тр." expanded to "Траса" in display names
- Old URLs `/results/:type` still work (pre-filtered)
- `pageVisibility`: competitions moved from dropdown group to main nav

#### LeagueResults View Modes
- View modes: Все/Бали/Час/Поз/Ред/Своє — unified column visibility system
- "Своє" (custom): draggable group pills (Квала, Гонка N) with sub-group toggles
- Clicking group headers toggles all sub-columns
- Custom column set persisted per user+competition in localStorage
- Added tap-to-select pilot rows (stays highlighted until tapped again)

#### Mobile Fixes
- `html, body { overflow-x: hidden }` prevents horizontal page scroll
- Header nav uses `overflow-x-auto scrollbar-none` for horizontal scrolling
- All dropdowns use `position: fixed` with parent-level ref for positioning (no flicker)
- `UserDropdown` extracted as separate component
- Tailwind `hoverOnlyWhenSupported: true` — hover styles only on devices with pointer
- `-webkit-tap-highlight-color: transparent` on body
- `active:bg-dark-700/30` for touch feedback on table rows
- Today's date highlighted green (`bg-green-600/20`) on all date navigators

#### Settings & Persistence
- Filter settings (competitions + karts dates) expire at end of day
- `loadWithExpiry(storage, key)` / `saveWithExpiry(storage, key, value)` utility functions
- Next day opens with default selections (current week for competitions, today for karts)
- Competition type filters, date selection, sort direction all persisted with expiry

### Working Features
- **Live timing**: real-time data from karting timing API with 1s polling
- **Session replay**: scrubber (starts at end by default), kart positions on track map, qualifying/race sort modes
- **Sessions list**: date navigation, merged sessions, best lap/pilot, sortable, filters sessions < 3min
- **Session detail**: replay, laps-by-pilots grid (with S1/S2), live updates, lap exclusion for competitions
- **Onboard page**: fullscreen kart timing for phone on kart mount (landscape)
- **Kart statistics**: per-kart top laps, multi-date filtering with end-of-day expiry
- **Day timeline**: scrollable 6h window, 3 colors (offline/idle/session), unified `isValidSession()` filter
- **Competition system**: full CRUD, session linking with auto-numbering of phases
- **Competition results**: live scoring for LL/CL, Gonzales table
  - Position points, overtake points (progressive, separate tables for LL/CL), speed points — all auto-calculated
  - Scoring logic extracted to shared `src/utils/scoring.ts` module
  - Standings pushed to collector every 10s (debounced) for persistence
  - Live positions from timing API (2s polling) for real-time overtake tracking
  - Start positions always pre-filled for next race (even during live)
  - Manual override: Start, Finish, Penalties (owner/moderator with manage_results)
  - Pilot rename (per-session, updates DB directly)
  - Exclude/include pilots (persisted to server)
  - Exclude/restore individual laps from scoring (per competition, persisted)
  - Position change indicator (▲N green / ▼N red) next to Finish
  - Penalties displayed as negative (-5) in red
  - Live toggle (pause/resume live updates) on competition timeline
  - Active session pilot highlighting (green tint)
  - Edit audit log (timestamp, user, pilot, action)
- **Competition list**: unified `/results` page with date navigator, type filters, sort, top-3 pilots display
- **Competition timeline**: horizontal scrubber from first to last session
  - Green = session (with phase labels like "1-2"), yellow = idle gap
  - Click/drag to scrub through time — table recalculates with data up to that point
  - Phase label + time clickable to navigate to session detail
  - LIVE button: always visible (green when live, grey when finished, blue when scrubbing)
- **Competition header**: name (stripped "Тр. X"), track dropdown, pilot count, group count
  - Track: editable dropdown (admin), readonly for users
  - Pilot count: editable with lock/unlock (admin), auto-determined from qualifying data
  - Group count: dropdown (авто/1/2/3), auto-detected from qualifying session count
- **View modes**: Все/Бали/Час/Поз/Ред/Своє toggle group for table columns
  - Все: all columns (Карт, Час, Швидк., Група, Старт, Фініш, all points)
  - Бали: speed + position/overtake/penalties/sum per race, quali speed points
  - Час/Поз: time/position focused views
  - Ред: edit mode for manual start/finish/penalties
  - Своє (custom): draggable group pills with sub-group toggles, persisted per user+competition
  - Clicking group headers (Квала, Гонка N) toggles all sub-columns
  - Clicking "Бали" sub-header toggles all 4 point columns
  - Tap-to-select pilot rows (highlighted until tapped again)
- **Toolbar**: 2 rows — "Сорт:" buttons (first), "Вид:" toggles (second)
- **Sort**: by total, quali time, race times; tiebreaker by qualifying time
- **Session type management**: dropdown to assign sessions to competitions
  - "Змінити етап (цей і далі)" — relinks current + subsequent sessions
  - Auto-detect group count by pilot overlap (≥50% = race, not qualifying)
  - Phase filtering by group count via `getPhasesForFormat()`
- **Auto-linking** (collector): detects groups during live by checking pilot overlap after first lap
- **Session filtering**: unified `isValidSession()` — sessions < 3min filtered everywhere
- **Admin**: page visibility, collector log, monitoring, competitions CRUD, scoring settings
- **Scoring settings**: separate overtake tables for LL/CL, position points by pilot count (9 categories)
- **Position tracking**: positions extracted from all event types (snapshot, lap, s1, update)
- **View preferences**: all settings persisted per user+competition in localStorage
- **Mobile-optimized**: no horizontal scroll, fixed dropdowns, touch feedback, hover-only on pointer devices

### Data Flow
- Collector polls timing API every 1s when online
- Events stored: snapshot (session start only), lap, s1, update (incl. position changes), pilot_join/leave
- Frontend replay uses events for exact S1 timing and position changes
- Live competition results poll every 2-3s
- Competition timeline scrubber filters sessionLaps by timestamp
- Standings pushed to collector every 10s (debounced) and stored in `results.standings`
- Competition list reads stored standings for top-3 display

### Data Filtering
- Laps < 38 seconds filtered from all statistics (SQL level)
- S1/S2 < 10 seconds filtered from best calculations and display
- S1/S2 displayed to hundredths (e.g., "18.08")
- Sessions < 3 minutes filtered from all lists and timelines (`isValidSession()`)
- `shortName()` doesn't truncate names <= 10 chars or "Карт X" patterns
- Excluded laps (per competition) filtered from scoring calculations

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend (Collector) | Node.js 20, plain HTTP, SQLite via better-sqlite3 |
| Auth | Firebase Google Sign-In |
| Hosting (Frontend) | Netlify |
| Hosting (Collector) | Oracle VPS (150.230.157.143), PM2 |
| Timing API | nfs.playwar.com:3333/getmaininfo.json |

## Repository

- **GitHub**: makandrol/karting
- **Branches**: `main` (production), `dev` (development)
- **Merge flow**: dev → main (no-ff merge) **ONLY when user explicitly asks**
- **Versions**: Frontend `0.9.x` in package.json, Collector `0.3.x` in collector/package.json
- **Current**: Frontend `0.9.222`, Collector `0.3.6`
- **APP_VERSION**: auto-read from package.json (displayed in footer)
