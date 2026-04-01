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

## Current State (v0.9.119)

### Recent Changes (Session with Agent)
- **Scoring persistence**: Scoring data now stored on collector (GET/POST `/scoring`) instead of static file
- **Track sync**: Track changes from timing page sync to collector and update all sessions
- **Competition track**: Track changes on competition page update all linked sessions
- **Live results default**: Competition pages always open "Live результати" tab by default, preference saved per user
- **Laps-by-pilots alignment**: Table aligned left instead of center, narrower columns (60px), smaller fonts
- **Competition params UI redesign**:
  - Separate "А" (Auto) buttons for pilots and groups (red background when active)
  - Pilots and groups use input fields (not dropdowns)
  - Auto-detected values shown when auto is on (disabled input)
  - Manual input when auto is off
  - Track selector narrower (w-10), no label
  - Icons: 👥 for pilots, 🎯 for groups
  - Bordered boxes for visual grouping

### Working Features
- **Live timing**: real-time data from karting timing API with 1s polling
- **Session replay**: scrubber (starts at end by default), kart positions on track map, qualifying/race sort modes
- **Sessions list**: date navigation, merged sessions, best lap/pilot, sortable, filters sessions < 3min
- **Session detail**: replay, laps-by-pilots grid (with S1/S2), live updates, lap exclusion for competitions
- **Onboard page**: fullscreen kart timing for phone on kart mount (landscape)
- **Kart statistics**: per-kart top laps, multi-date filtering
- **Day timeline**: scrollable 6h window, 3 colors (offline/idle/session), unified `isValidSession()` filter
- **Competition system**: full CRUD, session linking with auto-numbering of phases
- **Competition results**: live scoring for LL/CL, Gonzales table
  - Position points, overtake points (progressive, separate tables for LL/CL), speed points — all auto-calculated
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
- **Competition timeline**: horizontal scrubber from first to last session
  - Green = session (with phase labels like "1-2"), yellow = idle gap
  - Click/drag to scrub through time — table recalculates with data up to that point
  - Phase label + time clickable to navigate to session detail
  - LIVE button: always visible (green when live, grey when finished, blue when scrubbing)
- **Competition header**: name (stripped "Тр. X"), track dropdown, pilot count, group count
  - Track: editable dropdown (admin), readonly for users
  - Pilot count: editable with lock/unlock (admin), auto-determined from qualifying data
  - Group count: dropdown (авто/1/2/3), auto-detected from qualifying session count
- **View modes**: Все/Бали/Ред. toggle group for table columns
  - Все: all columns (Карт, Час, Швидк., Група, Старт, Фініш, all points)
  - Бали: speed + position/overtake/penalties/sum per race, quali speed points
  - Ред.: Start, Finish, Penalties, Sum only
  - Квала/Г1/Г2/Г3 individual toggles
- **Toolbar**: 3 rows — title, "Сорт:" buttons, "Вид:" toggles
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

### Data Flow
- Collector polls timing API every 1s when online
- Events stored: snapshot (session start only), lap, s1, update (incl. position changes), pilot_join/leave
- Frontend replay uses events for exact S1 timing and position changes
- Live competition results poll every 2-3s
- Competition timeline scrubber filters sessionLaps by timestamp

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
- **APP_VERSION**: auto-read from package.json (displayed in footer)
