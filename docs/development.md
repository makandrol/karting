# Development Guide

## CRITICAL RULES

### Merging
- **NEVER merge to `main` unless the user explicitly asks**
- Always work on `dev` branch
- Merge to `main` only with `git merge dev --no-ff` when requested
- Push both branches after merge: `git push origin dev && git push origin main`

### Versioning
- **Increment version with EVERY change** (even small fixes)
- Frontend version in `package.json` — format `0.11.X` (increment X)
- Collector version in `collector/package.json` — format `0.3.X`
- Current: frontend `0.11.x`, collector `0.3.x`

## Branches
- `main` — production, deployed to Netlify automatically
- `dev` — active development

## Workflow
1. Work on `dev` branch
2. Commit with descriptive message
3. Push to dev: `git push origin dev`
4. Deploy collector if backend changes: `scp + pm2 restart`
5. **Only merge to main when user explicitly asks**

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
- Reuse shared components: `SessionsTable`, `LapsByPilots`, `DateNavigator`, `SessionTypeChanger`

### Collector
- Plain Node.js HTTP server (no Express)
- SQLite with prepared statements
- All write endpoints require Bearer token auth
- CORS: `Access-Control-Allow-Origin: *`
- Body limit: 512KB
- Session merging in `getSessionsByDate()` — always returns merged data with `day_order`
- Competition auto-linking in `poller.js` on session start/end

### Shared Patterns
- `SessionsTable` — used everywhere for session lists (same format across all pages)
- `DateNavigator` — single-select (Sessions) or multi-select (Karts, KartDetail)
- `SessionReplay` — used on Timing (live) and SessionDetail (replay)
- `LapsByPilots` — used on Timing (isLive, no highlight) and SessionDetail (with highlight)
- `SessionTypeChanger` — used on Timing and SessionDetail
- `TrackMap` with `static` prop for replay, without for live animation
- `mergePilotNames()` applied per-session to avoid cross-session name leaks
- `useViewPrefs()` for persistent show/hide of UI sections

## Important Rules
1. **Never delete real data** — mock data was removed, real data stays forever
2. **Always deploy collector after backend changes** — scp + pm2 restart
3. **Test after deploy** — `curl localhost:3001/healthz`
4. **Session IDs format**: `session-{unix_timestamp_ms}`
5. **Lap times**: stored as strings "42.574" or "1:02.222", always use `parseTime()` to convert
6. **Dates**: always use local date (not UTC) — `getFullYear/getMonth/getDate`, never `toISOString().split('T')[0]`
7. **Min valid lap**: 38 seconds (filtered at SQL level)
8. **Min valid S1/S2**: 10 seconds (filtered at display level)
9. **Competition sessions format**: `[{sessionId, phase}]` — NOT plain string array
10. **Scoring data**: in `public/data/scoring.json`, editable via `/admin/scoring`

## File Structure
```
karting/
├── collector/
│   ├── src/
│   │   ├── index.js        # HTTP server + API endpoints (incl. competition link/unlink)
│   │   ├── poller.js        # Timing API polling + auto-link to competitions
│   │   ├── parser.js        # JSON parser + volatile fields
│   │   ├── storage.js       # SQLite schema + CRUD + merging + competition methods
│   │   ├── detector.js      # Competition auto-detection by schedule
│   │   └── schedule.js      # Weekly competition schedule
│   ├── data/                # SQLite DB (not in git)
│   ├── package.json
│   └── Dockerfile
├── src/
│   ├── components/
│   │   ├── Layout/          # Header (with live competition indicator), Footer, Layout
│   │   ├── Timing/          # SessionReplay, DayTimeline, CompetitionControl,
│   │   │                    #   LapsByPilots, SessionTypeChanger
│   │   ├── Track/           # TrackMap
│   │   ├── Sessions/        # DateNavigator, SessionsTable, SessionRows
│   │   └── Results/         # LeagueResults (LL/CL scoring table)
│   ├── pages/
│   │   ├── Info/            # Timing, Karts, KartDetail, Tracks, Videos
│   │   ├── Sessions/        # SessionsList, SessionDetail
│   │   ├── Auth/            # Login, AdminPanel, PageSettings, DatabaseStats,
│   │   │                    #   Monitoring, CollectorLog, CompetitionManager, ScoringSettings
│   │   ├── Results/         # CompetitionPage (list + detail + Gonzales table), CurrentRace
│   │   └── Pilots/          # PilotProfile (placeholder)
│   ├── services/
│   │   ├── auth.tsx         # Firebase Auth + roles
│   │   ├── timingPoller.ts  # Live timing hook
│   │   ├── viewPrefs.ts     # Per-user view preferences persistence
│   │   ├── pageVisibility.tsx # Page visibility config
│   │   ├── config.ts        # Collector URL
│   │   └── firebase.ts      # Firebase init
│   ├── utils/
│   │   └── timing.ts        # parseTime, toSeconds, getTimeColor, mergePilotNames, shortName
│   ├── data/
│   │   ├── tracks.ts        # Track configurations
│   │   └── competitions.ts  # Competition configs + PHASE_CONFIGS + scoring helpers
│   ├── types/
│   │   └── index.ts         # TypeScript interfaces (MIN_VALID_LAP_SECONDS = 38)
│   ├── App.tsx              # Routes
│   ├── main.tsx             # Entry point
│   └── index.css            # Tailwind + custom styles
├── public/
│   └── data/
│       ├── scoring.json     # Scoring rules (editable via /admin/scoring)
│       └── ...              # Static JSON (2025 competition results)
├── docs/
│   ├── README.md            # This documentation
│   ├── architecture.md      # System overview
│   ├── collector.md         # Backend documentation
│   ├── frontend.md          # Frontend documentation
│   ├── deployment.md        # Deployment guide
│   ├── development.md       # Development conventions
│   └── competition-rules.md # Formal competition rules (Gonzales, LL, CL)
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── netlify.toml
```
