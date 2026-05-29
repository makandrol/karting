# Architecture

Real-time timing dashboard для картодрому "Жага швидкості" з трьома компонентами.

## High-level

```
┌─────────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Timing API          │     │  Collector        │     │  Frontend (React)  │
│  nfs.playwar.com     │────→│  Node.js + SQLite │←───→│  Vite + Tailwind   │
│  :3333               │poll │  :3001            │HTTP │  Netlify           │
└─────────────────────┘     └──────────────────┘     └───────────────────┘
                                    │
                            ┌───────┴────────┐
                            │  SQLite DB      │
                            │  karting.db     │
                            │                 │
                            │  sessions       │
                            │  events         │
                            │  laps           │
                            │  competitions   │
                            │  page_views     │
                            │  visitor_sessions│
                            │  db_stats       │
                            └─────────────────┘
```

- **Frontend** — Netlify, авто-деплой з `main`. `package.json` версія `0.9.x`.
- **Collector** — Oracle VPS `150.230.157.143:3001`, PM2. `collector/package.json` версія `0.3.x`.
- **Timing API** — джерело `nfs.playwar.com:3333/getmaininfo.json` (зовнішній).

## Адаптивний полінг

```
[*] → Offline (60s)
Offline ↔ Idle (10s)  ← API up, no pilots
Idle    ↔ Online (1s) ← pilots on track
```

Інтервали керовані з `collector/src/poller.js` (`TimingPoller`).

## Event-sourcing

Collector НЕ зберігає періодичні snapshot-и. Натомість пише події у таблицю `events`:

| Тип | Коли | Дані |
|---|---|---|
| `snapshot` | Старт сесії (один раз!) | `{ entries, teams, meta }` — full state |
| `lap` | Пілот пройшов фініш | `{ pilot, kart, lapNumber, lastLap, s1, s2, bestLap, position, team }` |
| `s1` | Пілот пройшов S1 mid-lap | `{ pilot, kart, s1, team }` |
| `update` | Position / pit status / etc | `{ pilot, kart, team }` |
| `pilot_join` | Новий пілот з'явився | `{ pilot, kart }` |
| `pilot_leave` | Пілот зник | `{ pilot }` |
| `poll_ok` | Без змін | `null` |

**Volatile fields** (ігноруються в diff): `totalOnTrack`, `secondsFromPit`, `timeFromLassPassing`, `lastPitMainTime`.

Frontend через `parseSessionEvents()` будує таймлайн позицій, поєднуючи всі типи. Snapshots — це "якір" початку, всі зміни — приріст.

## Дані: дві таблиці-близнюки

- `events` — append-only лог змін (для replay і position timeline)
- `laps` — структуровані рядки лап (для агрегатів і scoring)

Обидві мають `session_id` foreign key.

## Session merging

Timing API іноді коротко падає (1-30с), створюючи дві окремі сесії для одної гонки. `getSessionsByDate()` мерджить сесії з тим самим `race_number` у вікні 5 хв.

## Auto-link змагань

```
[Нова сесія старт]
    ↓
storage.autoLinkSessionToActiveCompetition(sessionId)
    ↓ [знаходить first competition зі status='live']
    ↓ [фільтрує phases по groupCount]
    ↓ [бере наступну незайняту фазу]
    ↓ [GUARD: якщо всі phases filled → return null]
    ↓
[Перше коло у сесії]
    ↓
storage.recheckSessionPhase(sessionId)
    ↓ [overlap пілотів з попередніми qualis]
    ↓ [≥50% → це гонка]
    ↓ [<50% → це нова квала]
```

`autoUnlinkSession(sessionId)` — для сесій < 60с (тестові/помилкові).

Деталі в `docs/competition-detection.md`.

## Frontend

### Routes (lazy)
| URL | Компонент |
|---|---|
| `/` (= `/info/timing`) | `Timing` — live |
| `/onboard`, `/onboard/:kartId` | `Onboard` — повноекранний |
| `/sessions` | `SessionsList` |
| `/sessions/:id` | `SessionDetail` |
| `/info/karts` | `Karts` |
| `/info/karts/:id` | `KartDetail` |
| `/info/tracks` | `Tracks` |
| `/info/videos` | `Videos` |
| `/results` | `CompetitionPage` (unified list) |
| `/results/:type/:eventId` | `CompetitionPage` (detail) |
| `/admin/access`, `/admin/db`, `/admin/monitoring`, `/admin/collector-log`, `/admin/scoring` | Admin |
| `/login` | `Login` |
| `/changelog` | `Changelog` |

### Providers (top-down у `App.tsx`)
```
AuthProvider
  PageVisibilityProvider
    LayoutPrefsProvider
      TrackProvider
        BrowserRouter
          ErrorBoundary
            <Routes>...
```

### API client (services/api/)
Усі HTTP-виклики до колектора — через типізований клієнт `services/api/`:
- `services/api/http.ts` — `apiGet`, `apiPost`, `apiPatch`, `apiDelete` з timeout, auth header, error handling, `CollectorApiError`
- `services/api/index.ts` — typed endpoints groups: `api.competitions`, `api.sessions`, `api.laps`, `api.events`, `api.scoring`, `api.track`, `api.pageVisibility`, `api.moderators`, `api.viewDefaults`, `api.detector`, etc.

Виняток: `services/analytics.ts` робить fire-and-forget heartbeat через bare `fetch` (без auth).

### Reusable компоненти
- `SessionReplay` — головний replay-компонент (live, replay, competition-live з `showScrubber={false}`)
- `TimingTable` — standalone timing table з вибором колонок (Все/Осн/Своє)
- `LapsByPilots` — laps grid per pilot
- `LeagueResults` — scoring table для LL/CL/Sprint
- `GonzalesResults` — окремий компонент для Гонзалеса (kart manager, slot rotation)
- `TrackMap` — SVG track з анімованими pilot-позиціями
- `CompetitionTimeline` — горизонтальний скраббер змагання

## Scoring

Уся логіка — pure functions у `src/utils/scoring.ts`:
- `computeStandings()` — LL/CL
- `computeSprintStandings()` — Sprint
- `computeGonzalesStandings()` — Гонзалес
- `rowsToStandings()` → `CompetitionStandings` для збереження

Format dispatch у `LeagueResults`. Деталі — у `.cursor/rules/scoring-rules.mdc`.

## Standings storage flow

```
LeagueResults / GonzalesResults компонент
  ↓ кожен render
computeStandings() → PilotRow[]
  ↓ rowsToStandings(rows, excludedPilots, format)
CompetitionStandings { updatedAt, pilots: [...] }
  ↓ onSaveResults({ standings }) — debounced 10s
PATCH /competitions/:id  →  competition.results.standings
  ↓
Competition list `/results` reads standings → top-3 pilots з балами
```

## Auth & ролі

- Owner — `makandrol@gmail.com` (хардкод у `auth.tsx`)
- Moderator — список email-ів на колекторі (`/moderators`, server-side з v0.9.355)
- User — будь-хто
- `localhost`/`127.0.0.1` — auto-owner (development)

Permissions: `change_track`, `manage_results`, `manage_videos`, `manage_karts`.

## Page visibility

Server-side controlled (з v0.9.354). Owner керує через `/admin/access` — які сторінки видні модераторам / користувачам, plus per-account overrides. Зберігається у колекторі `/page-visibility`.

## Layout prefs (page-level sections)

Кожна сторінка має draggable sections (наприклад competition: Таймлайн, Заїзд, Результати, Список заїздів). Server defaults з версіонуванням + local overrides. Сервер може bump-нути version → reset кастомізацій.

## Live competition updates

```
LeagueResults
    ↓
[3s slow poll] GET /competitions/:id + GET /db/laps  →  competition + sessionLaps
[2s fast poll] GET /status + /timing                  →  liveSessionId + livePositions
    ↓
computeStandings(params with live) → render
    ↓
[10s debounced] onSaveResults({ standings }) → PATCH /competitions/:id
```

`● LIVE` toggle — пауза/резюм live-апдейтів. Активна сесія підсвічена (зелений тон).

## Mobile optimizations

- `html, body { overflow-x: hidden }`
- Headers: `overflow-x-auto scrollbar-none` для горизонтального скролу
- Усі dropdowns: `position: fixed` з parent ref (без флікера)
- Tailwind `hoverOnlyWhenSupported: true`
- `-webkit-tap-highlight-color: transparent`
- `active:bg-dark-700/30` touch feedback
- Today highlighted green (`bg-green-600/20`) у DateNavigator

## Tools

`tools/path-editor.html` — окремий vanilla HTML+JS редактор SVG-шляхів для треків. Не пов'язаний з React-додатком. Дані пишуться у `public/tracks/tracks.json`.
