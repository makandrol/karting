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

## Current State (v0.9.x)

### Working Features
- **Live timing**: real-time data from karting timing API with 1s polling
- **Session replay**: scrubber, kart positions on track map, qualifying/race sort modes
- **Sessions list**: date navigation, merged sessions, best lap/pilot, sortable
- **Session detail**: replay, laps-by-pilots grid (with S1/S2), live updates
- **Onboard page**: fullscreen kart timing for phone on kart mount (landscape)
- **Kart statistics**: per-kart top laps, multi-date filtering
- **Day timeline**: scrollable 6h window, 3 colors (offline/idle/session)
- **Competition system**: full CRUD, session linking with auto-numbering of phases
- **Competition results**: live scoring for LL/CL, Gonzales table
  - Position points, overtake points (progressive), speed points — all auto-calculated
  - Live positions from timing API (2s polling) for real-time overtake tracking
  - Start positions pre-filled for next race from current race results
  - Manual override: Start, Finish, Penalties (owner only)
  - Pilot rename (per-session, updates DB directly)
  - Exclude/include pilots (persisted to server)
  - Live toggle (pause/resume live updates)
  - Active session pilot highlighting
- **Session type management**: dropdown to assign sessions to competitions
- **Admin**: page visibility, collector log, monitoring, competitions CRUD, scoring settings
- **Position tracking**: positions extracted from all event types (snapshot, lap, s1, update)

### Data Flow
- Collector polls timing API every 1s when online
- Events stored: snapshot (session start only), lap, s1, update (incl. position changes), pilot_join/leave
- Frontend replay uses events for exact S1 timing and position changes
- Live competition results poll every 2-3s

### Data Filtering
- Laps < 38 seconds filtered from all statistics (SQL level)
- S1/S2 < 10 seconds filtered from best calculations and display
- S1/S2 displayed to hundredths (e.g., "18.08")
- `shortName()` doesn't truncate names <= 10 chars or "Карт X" patterns

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
