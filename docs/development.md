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
- `SessionReplay` — used on Timing (live), SessionDetail (replay), and CompetitionPage (live, `showScrubber=false`)
- `TimingTable` — standalone timing table used inside SessionReplay. Column visibility (Все/Осн/Своє), sort modes, Start+arrows columns, precise GAP, race/qualifying column orders
- `LapsByPilots` — used on Timing (isLive) and SessionDetail (with highlight, position arrows for races)
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
9. **Min valid session**: 3 minutes (`isValidSession()` in `utils/timing.ts`)
10. **Competition sessions format**: `[{sessionId, phase}]`
11. **Scoring data**: stored on collector via `GET/POST /scoring` (persisted in db_stats), fallback to `public/data/scoring.json`
12. **Position field**: API returns kart as string — poller converts to `Number()`
13. **Overtake points**: separate tables for LL (`groupI_LL`, 10+ → 1.2) and CL (`groupI_CL`, 10+ → 1.3)
14. **Excluded laps**: stored as `results.excludedLaps` array with keys `"sessionId|pilot|ts"`
15. **Edit audit log**: `results.editLog` array with `{pilot, action, detail, user, ts}`
16. **Group count**: `results.groupCountOverride` — auto-detected from qualifying session count by pilot overlap
17. **Phase filtering**: `getPhasesForFormat(format, groupCount)` filters phases by group count
18. **EditableCell**: defined OUTSIDE parent component to prevent remount on re-render (critical!)
19. **No new hooks in LeagueResults**: adding hooks causes "more hooks than previous render" error during HMR. Use `Promise.resolve().then()` for deferred state updates to parent instead of `useEffect`. ALL useMemo/useCallback/useState hooks MUST be placed BEFORE any early returns (e.g. `if (!scoring) return ...`).
20. **Track sync**: Track changes from timing page sync to collector via `POST /track`, updates all future sessions
21. **Competition track**: Track changes on competition page update all linked sessions via `POST /competitions/:id/update-track`
22. **Tab preference**: Competition page saves tab preference (live/final) to localStorage (auth users) or sessionStorage (anon)
23. **Scoring module**: All scoring logic in `src/utils/scoring.ts` — `computeStandings()`, `rowsToStandings()`, pure functions reusable by any component
24. **Standings storage**: LeagueResults pushes `results.standings` to collector every 10s (debounced). Competition list reads for top-3 display.
25. **Competition date**: Derived from first session timestamp, NOT from stored `date` field. Use `getCompRealDate(competition)`.
26. **Settings expiry**: Competition filters and kart date selections expire at end of day. Use `loadWithExpiry()`/`saveWithExpiry()`.
27. **Mobile**: `html, body { overflow-x: hidden }`, header dropdowns use `position: fixed`, Tailwind `hoverOnlyWhenSupported: true`, today highlighted green
28. **Competitions page**: `/results` shows unified list with date navigator + type filters. "Змагання" is a direct Link in header (not dropdown).
29. **TimingTable**: Reusable component in `components/Timing/TimingTable.tsx`. DO NOT inline table JSX in SessionReplay — all table rendering goes through TimingTable.
30. **Column visibility**: `start` and `arrows` columns are `RACE_ONLY_COLS` — auto-hidden when not in race mode or no start data. They are fixed-position (not draggable) in custom mode.
31. **Layout prefs**: `layoutPrefs.tsx` manages page-level section visibility. `updateLocal()` must fall back to `HARDCODED_DEFAULTS` version when `serverDefaults` is empty. See bugfix in v0.9.195.
32. **Competition live table**: Uses `SessionReplay(showScrubber=false)` with events fetched on 3s interval. Do NOT create separate live table components.
33. **LeagueResults toolbar order**: "Сорт:" first row, "Вид:" second row.
34. **CompetitionTimeline links**: Only session name is a link; time display is plain text.
35. **Kart color**: Use `KART_COLOR` constant from `utils/timing.ts` for all kart number displays. Never hardcode kart color in individual components.
36. **Track selector**: All pages (competition, timing, session detail) use the same bordered frame style with flag icon + dropdown/number.
37. **LapsByPilots pilot names**: Use `compactName()` (max 10 chars, surname >7 → truncate, ≤7 → with initial). NOT `shortName()`.
38. **TimingTable columns**: `TB` is theoretical best (bestS1+bestS2), `Loss` is best lap minus TB. `Gap` is race-mode only (precise time distance via cumulative lap times). `MAIN_RACE_VISIBLE` excludes Start/arrows but includes Gap.
39. **Localhost auth**: `auth.tsx` uses `localhostLoggedOut` state flag — `IS_LOCALHOST` auto-owner respects logout. `loginWithGoogle` resets the flag.
40. **AccessSettings drag-reorder**: Uses `wasDragged` ref to prevent click from firing after drag. Always add `onDragEnd` to reset drag state.
41. **Race sort priority**: In `getEntriesAtTime()`, race mode sorts by: lapNumber → snapshotPositions (ground truth) → pilotLastPos → progress → startPositions. Snapshot positions MUST have higher priority than progress-based sorting.
42. **GAP calculation**: Uses `pilotCumLapMs` (cumulative lap time sums from raw data) for finish-line gap — NOT `pilotTimelines` (which depend on poll timestamps). S1 gap uses real S1 event timestamps. Format: `+X.XX` (hundredths, `Math.abs`, always `+`).
43. **isCompetitionRace**: Use shared `extractCompetitionReplayProps(phase)` from `utils/session.ts` to determine if session is a competition race. Pass `isCompetitionRace` prop to TimingTable to control Квала/Гонка toggle visibility.
44. **LapsByPilots position arrows**: For competition races, show ▲/▼ position change arrows next to each lap time. Uses `startPositions` for first lap comparison. Only show when `startPositions` prop is provided.
45. **LapsByPilots default view**: Default view mode is "Осн" (not "Все").
46. **LapsByPilots sort toggle**: "Сорт: Час/Поз" only visible for race sessions with `startPositions`. Toolbar order: Вид first, Сорт second.
47. **Race column order**: TimingTable uses `RACE_ORDER` (Δ, P, Pilot, L, GAP, Kart, ...) in race mode, `DEFAULT_ORDER` in qualifying. Custom view ("Своє") inherits mode-specific order as default.
48. **Pencil rename button**: Uses `onPointerDown` + `setTimeout(…, 10)` with IIFE closure to survive React re-renders from `currentEntries` updates. Do NOT use `onClick` — it gets lost during re-renders.
49. **Session detail track change**: Uses `POST /db/update-sessions-track` with `sessionIds` array (includes merged session IDs). Admin-only endpoint.
50. **TimingEntry.gap**: Optional `gap?: string | null` field on `TimingEntry` interface. Computed in `getEntriesAtTime()`, consumed by `TimingTable` for GAP column display.
51. **Sprint scoring module**: `computeSprintStandings()` in `scoring.ts` handles Sprint format. `getSprintPositionPoints()` (40/37/35/33...) for races 1-2, `getSprintFinalPoints()` (180, -3 per pos) for finals. No overtake points. Speed points: 1pt per group per race for fastest.
52. **Sprint group splitting**: `splitIntoGroupsSprint()` (snake/round-robin) for races 1-2. Finals use sequential tiered split (best→Pro, middle→Gold, rest→Light) — inline logic in `computeSprintStandings`.
53. **Sprint results table has two rendering paths**: First table (compact) uses generic `cellForCol` + `RACE_COLS_H`. Second table (expanded) uses explicit `cv()`/`colVisible()` checks. When modifying Sprint columns, BOTH paths must be updated (column order, data cells, headers, sum logic).
54. **Sprint column order**: "Бали" sub-header for Sprint: Швидк, Штрафи, Позиція, Сума. LL/CL: Позиція, Обгони, Штрафи, Сума. Changed in: `RACE_COLS_H`, `RACE_COLS`, `SUB_GROUPS`, `PRESET_COLS`, `ptsCols`, `allSubCols`, `th` headers, `td` cells.
55. **Sprint cumulative sums**: Race 2 "Сума" = cumulative (q1_speed + r1_total + q2_speed + r2_total). Final "Сума" = `row.totalPoints`. Implemented in both cellForCol and explicit cv() paths.
56. **Sprint final start positions**: Computed in two places: `CompetitionPage.tsx` (LiveSessionTable useMemo) and `utils/timing.ts` (fetchRaceStartPositions). Both compute cumulative points from all previous phases, sort, and do tiered sequential split. Phase detection: `final_group_N`.
57. **Sprint phase naming**: `qualifying_N_group_X`, `race_N_group_X`, `final_group_X`. Race indices: `races[0]`=Race 1, `races[1]`=Race 2, `races[2]`=Final. Qualis: `qualis[0]`=Quali 1, `qualis[1]`=Quali 2.
58. **Sort column highlighting**: `sortColId` useMemo + `isSortCol()` + `SORT_HL` class. Works for ALL formats. Must be defined BEFORE early returns in LeagueResults.
59. **Clickable column headers**: `colSortInfo()`, `handleColClick()`, `sortableCursor()`. Sprint "Сума" for Race 2 → `race_2_cumsum`, for Final → `total`. Both clickable headers and "Сорт:" buttons bar coexist.
60. **Auto-link protection**: Collector `autoLinkSessionToActiveCompetition()` checks if all expected phases are filled before linking. Even with `live` status, completed competitions won't grab new sessions.

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
│   └── package.json         # v0.3.7
├── src/
│   ├── components/
│   │   ├── Layout/          # Header (fixed dropdowns, UserDropdown), Footer, Layout
│   │   ├── Timing/          # SessionReplay, TimingTable, DayTimeline, CompetitionControl,
│   │   │                    #   LapsByPilots, SessionTypeChanger, TimingBoard
│   │   ├── Track/           # TrackMap
│   │   ├── Sessions/        # DateNavigator (green today), SessionsTable, SessionRows
│   │   └── Results/         # LeagueResults, CompetitionTimeline, TableLayoutBar
│   ├── pages/
│   │   ├── Info/            # Timing, Onboard, Karts (date expiry), KartDetail, Tracks, Videos
│   │   ├── Sessions/        # SessionsList, SessionDetail
│   │   ├── Auth/            # Login, AdminPanel, PageSettings, DatabaseStats,
│   │   │                    #   Monitoring, CollectorLog, CompetitionManager, ScoringSettings
│   │   ├── Results/         # CompetitionPage (unified list + detail + live), CurrentRace
│   │   └── Pilots/          # PilotProfile (placeholder)
│   ├── services/
│   │   ├── auth.tsx         # Firebase Auth + roles + localhost auto-owner
│   │   ├── timingPoller.ts  # Live timing hook (bestS1/S2 tracking, kart Number conversion)
│   │   ├── viewPrefs.ts     # Per-user view preferences
│   │   ├── layoutPrefs.tsx  # Page-level section visibility + ordering (server defaults + local overrides)
│   │   ├── pageVisibility.tsx # Page visibility config (competitions in main group)
│   │   ├── config.ts        # Collector URL
│   │   └── firebase.ts      # Firebase init
│   ├── utils/
│   │   ├── timing.ts        # parseTime, toSeconds, toHundredths, getTimeColor,
│   │   │                    #   KART_COLOR, mergePilotNames, shortName, fetchRaceStartPositions
│   │   ├── scoring.ts       # computeStandings, rowsToStandings, calcOvertakePoints,
│   │   │                    #   getPositionPoints, parseLapSec (shared scoring module)
│   │   └── session.ts       # buildReplayLaps, extractCompetitionReplayProps
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
├── package.json             # v0.9.265
├── vite.config.ts
├── tailwind.config.js       # hoverOnlyWhenSupported: true
├── tsconfig.json            # resolveJsonModule enabled
└── netlify.toml
```
