# Development Guide

## CRITICAL RULES

### Merging
- **NEVER merge to `main` unless the user explicitly asks**
- Always work on `dev` branch
- Merge to `main` only with `git merge dev --no-ff` when requested
- Push both branches after merge: `git push origin dev && git push origin main`

### Versioning
- **Increment version with EVERY change** (even small fixes)
- Frontend version in `package.json` — format `0.9.X` (increment X)
- Collector version in `collector/package.json` — format `0.3.X`
- `APP_VERSION` auto-reads from package.json (no manual update needed)

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
- All time display: use `toSeconds()` for laps, `toHundredths()` for S1/S2
- Reuse shared components: `SessionsTable`, `LapsByPilots`, `DateNavigator`, `SessionTypeChanger`
- Color coding: purple (overall best), green (PB), yellow (slower), `getTimeColor()` utility

### Collector
- Plain Node.js HTTP server (no Express)
- SQLite with prepared statements
- All write endpoints require Bearer token auth via `isAuthorized(req)`
- `readBody(req)` returns string — always `JSON.parse()` it
- CORS: `Access-Control-Allow-Origin: *`
- Body limit: 512KB
- Session merging in `getSessionsByDate()`
- Competition auto-linking in `poller.js` on session start/end
- Snapshots only at session start (no periodic snapshots)

### Shared Patterns
- `SessionsTable` — used everywhere for session lists
- `DateNavigator` — single-select (Sessions) or multi-select (Karts, KartDetail)
- `SessionReplay` — used on Timing (live) and SessionDetail (replay)
- `LapsByPilots` — used on Timing (isLive) and SessionDetail (with highlight)
- `SessionTypeChanger` — used on Timing and SessionDetail
- `TrackMap` with `static` prop for replay, without for live animation
- `mergePilotNames()` applied per-session to avoid cross-session name leaks
- `useViewPrefs()` for persistent show/hide of UI sections
- `parseSessionEvents()` for extracting s1Events + position timeline from raw events

## How to Add New Features

### Adding a new page
1. Create component in `src/pages/Category/NewPage.tsx`
2. Add lazy import in `src/App.tsx`
3. Add Route inside `<Layout>` element
4. Add to `ALL_PAGES` in `src/services/pageVisibility.tsx` (with group)
5. Increment version in `package.json`

### Adding a new API endpoint
1. Add handler in `collector/src/index.js` (before the 404 catch-all)
2. Use `isAuthorized(req)` for admin endpoints
3. Parse body with `JSON.parse(await readBody(req))`
4. Add storage method in `collector/src/storage.js` if needed
5. Increment collector version in `collector/package.json`
6. Deploy: `scp + pm2 restart`

### Adding a new event type
1. Emit in `poller.js` `#diff()` method
2. Store via `storage.addEvent()`
3. Parse in frontend's `parseSessionEvents()` in `SessionReplay.tsx`
4. Use in replay via `snapshots` or `s1Events` prop

### Adding a new competition format
1. Add config in `src/data/competitions.ts` (`COMPETITION_CONFIGS`, `PHASE_CONFIGS`)
2. Add scoring in `public/data/scoring.json` if needed
3. Add rendering in `CompetitionPage.tsx` (like GonzalesLiveTable or LeagueResults)
4. Add page config in `pageVisibility.tsx`

## Important Rules
1. **Never delete real data** — mock data was removed, real data stays forever
2. **Always deploy collector after backend changes** — scp + pm2 restart
3. **Test after deploy** — `curl localhost:3001/healthz`
4. **Session IDs format**: `session-{unix_timestamp_ms}`
5. **Lap times**: stored as strings "42.574" or "1:02.222", use `parseTime()` to convert
6. **Dates**: always use local date (not UTC)
7. **Min valid lap**: 38 seconds (filtered at SQL level)
8. **Min valid S1/S2**: 10 seconds (filtered at display level)
9. **Competition sessions format**: `[{sessionId, phase}]`
10. **Scoring data**: in `public/data/scoring.json`, editable via `/admin/scoring`
11. **Position field**: API returns kart as string — poller converts to `Number()`
12. **Overtake points**: calculated progressively (each position has own rate)

## File Structure
```
karting/
├── collector/
│   ├── src/
│   │   ├── index.js        # HTTP server + API endpoints
│   │   ├── poller.js        # Timing API polling + event diffing
│   │   ├── parser.js        # JSON parser + volatile fields
│   │   ├── storage.js       # SQLite schema + CRUD + merging + rename
│   │   ├── detector.js      # Competition auto-detection
│   │   └── schedule.js      # Weekly competition schedule
│   ├── data/                # SQLite DB (not in git)
│   └── package.json         # v0.3.3
├── src/
│   ├── components/
│   │   ├── Layout/          # Header, Footer, Layout
│   │   ├── Timing/          # SessionReplay, DayTimeline, CompetitionControl,
│   │   │                    #   LapsByPilots, SessionTypeChanger, TimingBoard
│   │   ├── Track/           # TrackMap
│   │   ├── Sessions/        # DateNavigator, SessionsTable, SessionRows
│   │   └── Results/         # LeagueResults (LL/CL scoring table)
│   ├── pages/
│   │   ├── Info/            # Timing, Onboard, Karts, KartDetail, Tracks, Videos
│   │   ├── Sessions/        # SessionsList, SessionDetail
│   │   ├── Auth/            # Login, AdminPanel, PageSettings, DatabaseStats,
│   │   │                    #   Monitoring, CollectorLog, CompetitionManager, ScoringSettings
│   │   ├── Results/         # CompetitionPage (list + detail + live scoring), CurrentRace
│   │   └── Pilots/          # PilotProfile (placeholder)
│   ├── services/
│   │   ├── auth.tsx         # Firebase Auth + roles + localhost auto-owner
│   │   ├── timingPoller.ts  # Live timing hook (bestS1/S2 tracking, kart Number conversion)
│   │   ├── viewPrefs.ts     # Per-user view preferences
│   │   ├── pageVisibility.tsx # Page visibility config
│   │   ├── config.ts        # Collector URL
│   │   └── firebase.ts      # Firebase init
│   ├── utils/
│   │   └── timing.ts        # parseTime, toSeconds, toHundredths, getTimeColor,
│   │                        #   mergePilotNames, shortName, fetchRaceStartPositions
│   ├── data/
│   │   ├── tracks.ts        # Track configurations
│   │   ├── competitions.ts  # Competition configs + PHASE_CONFIGS + splitIntoGroups
│   │   └── changelog.ts     # APP_VERSION (from package.json)
│   ├── types/index.ts       # TypeScript interfaces
│   ├── App.tsx              # Routes
│   ├── main.tsx             # Entry point
│   └── index.css            # Tailwind + custom styles
├── public/data/
│   └── scoring.json         # Scoring rules (editable via /admin/scoring)
├── docs/                    # This documentation
├── package.json             # v0.9.60
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json            # resolveJsonModule enabled
└── netlify.toml
```
