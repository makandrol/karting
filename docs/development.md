# Development Guide

## Branches
- `main` — production, deployed to Netlify automatically
- `dev` — active development

## Workflow
1. Work on `dev` branch
2. Commit with descriptive message
3. Merge to `main` with `git merge dev --no-ff`
4. Push both branches: `git push origin dev && git push origin main`

## Versioning
- Frontend version in `package.json` — format `0.X.Y`
- Collector version in `collector/package.json` — format `0.X.Y`
- **Increment version with every change** (even small fixes)
- Current: frontend `0.10.30`, collector `0.3.0`

## Code Conventions

### General
- TypeScript for frontend, plain JavaScript for collector
- No comments that just narrate code
- Ukrainian language for UI text
- No emojis in code (emojis in UI only where explicitly set)

### Frontend
- Tailwind CSS for styling (no CSS modules)
- Dark theme: `bg-dark-900`, `text-dark-300`, `border-dark-800`
- Components in `src/components/`, pages in `src/pages/`
- Services in `src/services/`, utilities in `src/utils/`
- Lazy loading for all pages via `React.lazy()`
- All time display: use `toSeconds()` from utils (converts "1:02.222" → "62.222")

### Collector
- Plain Node.js HTTP server (no Express)
- SQLite with prepared statements
- All write endpoints require Bearer token auth
- CORS: `Access-Control-Allow-Origin: *`
- Body limit: 512KB
- Session merging in `getSessionsByDate()` — always returns merged data

### Shared Patterns
- `DateNavigator` component used on Sessions, Karts, KartDetail pages
- `SessionReplay` used on Timing (live) and SessionDetail (replay) pages
- `TrackMap` with `static` prop for replay, without for live animation
- `mergePilotNames()` applied to all lap data before display

## Important Rules
1. **Never delete real data** — mock data was removed, real data stays forever
2. **Always deploy collector after backend changes** — scp + pm2 restart
3. **Test after deploy** — `curl localhost:3001/healthz`
4. **Session IDs format**: `session-{unix_timestamp_ms}`
5. **Lap times**: stored as strings "42.574" or "1:02.222", always use `parseTime()` to convert
6. **Dates**: always use local date (not UTC) — `getFullYear/getMonth/getDate`, never `toISOString().split('T')[0]`

## File Structure
```
karting/
├── collector/
│   ├── src/
│   │   ├── index.js        # HTTP server + API endpoints
│   │   ├── poller.js        # Timing API polling engine
│   │   ├── parser.js        # JSON parser + volatile fields
│   │   ├── storage.js       # SQLite schema + CRUD + merging
│   │   ├── detector.js      # Competition auto-detection
│   │   └── schedule.js      # Weekly competition schedule
│   ├── data/                # SQLite DB (not in git)
│   ├── package.json
│   └── Dockerfile
├── src/
│   ├── components/
│   │   ├── Layout/          # Header, Footer, Layout
│   │   ├── Timing/          # TimingBoard, SessionReplay, DayTimeline, CompetitionControl
│   │   ├── Track/           # TrackMap
│   │   └── Sessions/        # DateNavigator, SessionRows
│   ├── pages/
│   │   ├── Info/            # Timing, Karts, KartDetail, Tracks, Videos
│   │   ├── Sessions/        # SessionsList, SessionDetail
│   │   ├── Auth/            # Login, AdminPanel, PageSettings, DatabaseStats,
│   │   │                    #   Monitoring, CollectorLog, CompetitionManager
│   │   ├── Results/         # CompetitionPage, Gonzales, etc. (placeholders)
│   │   └── Pilots/          # PilotProfile (placeholder)
│   ├── services/
│   │   ├── auth.tsx         # Firebase Auth + roles
│   │   ├── timingPoller.ts  # Live timing hook
│   │   ├── pageVisibility.tsx # Page visibility config
│   │   ├── config.ts        # Collector URL
│   │   └── firebase.ts      # Firebase init
│   ├── utils/
│   │   └── timing.ts        # parseTime, toSeconds, mergePilotNames, etc.
│   ├── data/
│   │   ├── tracks.ts        # Track configurations
│   │   └── competitions.ts  # Competition format configs
│   ├── types/
│   │   └── index.ts         # TypeScript interfaces
│   ├── App.tsx              # Routes
│   ├── main.tsx             # Entry point
│   └── index.css            # Tailwind + custom styles
├── public/
│   └── data/                # Static JSON (2025 competition results)
├── docs/                    # This documentation
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── netlify.toml
```
