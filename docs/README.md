# Karting "Жага Швидкості" — Project Documentation

## Quick Links

| Document | Description |
|----------|-------------|
| [Architecture](./architecture.md) | System overview, data flow, tech stack |
| [Collector](./collector.md) | Backend collector: API, database, polling |
| [Frontend](./frontend.md) | React app: pages, components, services |
| [Deployment](./deployment.md) | How to deploy collector and frontend |
| [Development](./development.md) | Dev setup, conventions, versioning |

## Project Overview

A real-time karting timing dashboard for the "Жага Швидкості" karting track. Collects live timing data, stores it in SQLite, and provides a web interface for viewing sessions, replays, kart statistics, and managing competitions.

## Current State (v0.10.30)

### Working Features
- **Live timing**: real-time data from karting timing API with 1s polling
- **Session replay**: scrubber, progress bars, kart positions on track map
- **Sessions list**: date navigation, merged sessions, best lap/pilot
- **Session detail**: replay, laps grid, live updates for active sessions
- **Kart statistics**: per-kart top laps, session-based filtering
- **Day timeline**: scrollable 6h window, 3 colors (offline/idle/session)
- **Admin**: page visibility, collector log, monitoring, competitions CRUD
- **Competition system**: SQLite table with CRUD API (sessions + results)

### Not Yet Implemented
- Competition results auto-calculation from timing data
- Pilot profiles (placeholder page)
- Results pages for specific competition types (placeholder pages)
- Public competition standings/leaderboards

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
- **Merge flow**: dev → main (no-ff merge)
