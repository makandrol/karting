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

## Current State (v0.11.x)

### Working Features
- **Live timing**: real-time data from karting timing API with 1s polling
- **Session replay**: scrubber (pinned in live mode), progress bars, kart positions on track map
- **Sessions list**: date navigation, merged sessions, best lap/pilot, sortable (time/best lap)
- **Session detail**: replay, laps-by-pilots grid, live updates, hideable track/laps sections
- **Kart statistics**: per-kart top laps, multi-date filtering, kart-specific session counts
- **Day timeline**: scrollable 6h window, 3 colors (offline/idle/session)
- **Competition system**: full CRUD, session linking with auto-numbering of phases
- **Competition results**: live scoring for LL/CL (position, overtake, speed points), Gonzales table
- **Session type management**: dropdown to assign sessions to competitions, auto-link surrounding sessions
- **Admin**: page visibility, collector log, monitoring, competitions CRUD, scoring settings
- **View preferences**: per-user (by email) persistence of track/laps visibility

### Competition Features
- **Gonzales**: live table with Pilot | Kart 1..12 | Average, auto-calculated from timing
- **Light League / Champions League**: full scoring table with qualifying, races, groups
  - Position points, overtake points, speed points — all auto-calculated
  - Manual override: Start, Finish, Penalties (owner only)
  - Exclude/include pilots (persisted to server)
  - Collapsible column groups, multiple sort options
- **Auto-link**: new sessions auto-assigned to active competition's next phase
- **Auto-unlink**: sessions < 60s automatically removed from competition

### Data Filtering
- Laps < 38 seconds filtered from all statistics (SQL level)
- S1/S2 < 10 seconds filtered from best calculations and display
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
