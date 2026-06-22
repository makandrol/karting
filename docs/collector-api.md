# Collector API Reference

Plain Node.js HTTP server. **Base URL**:
- Production: `http://141.147.32.196:3001`
- Local dev: `http://localhost:3001` (треба `npm install && node src/index.js` у `collector/`)

CORS відкритий: `Access-Control-Allow-Origin: *`. Body limit 512KB.

## Auth

Write-ендпоінти потребують `Authorization: Bearer <ADMIN_TOKEN>` (env var на сервері). `VITE_ADMIN_TOKEN` у frontend `.env`.

Read-ендпоінти переважно публічні (без auth). Винятки явно позначені нижче як `🔒`.

---

## Health & status

| Method | Path | Опис |
|---|---|---|
| GET | `/healthz` | `{ ok: true, uptime: <sec> }` |
| GET | `/status` | Стан + DB stats (`isOnline`, `pollCount`, `entriesCount`, `db.*`) |
| GET | `/timing` | Поточний таймінг (entries, teams, meta, trackId, sessionId, competition) |
| GET 🔒 | `/system` | CPU/RAM/disk/uptime сервера |
| GET 🔒 | `/analytics?days=7` | Visitor analytics |
| POST | `/analytics` | Track page view (без auth, відкритий — body: `{date, path, sessionId, userEmail, userName, userAgent, ip}`) |

## Live timing data

| Method | Path | Опис |
|---|---|---|
| GET | `/events?session=&since=` | In-memory event log |
| GET | `/sessions` | In-memory session list |

## Persisted data (DB)

| Method | Path | Опис |
|---|---|---|
| GET | `/db/sessions?date=YYYY-MM-DD` | Сесії з БД (merged + stats per day) |
| GET | `/db/laps?session=ID` | Лапи сесії |
| GET | `/db/laps?kart=N&from=&to=` | Лапи карта в date range |
| GET | `/db/events?session=ID&since=ts` | Події з БД |
| GET | `/db/session-counts?from=&to=` | Кількість сесій per date |
| GET | `/db/kart-stats?from=&to=` | Статистика картів за date range |
| POST | `/db/kart-stats` | Те саме для конкретного списку sessionIds (body: `{sessionIds}`) |
| GET | `/db/kart-session-counts?kart=N` | Кількість сесій per date для одного карта |
| GET | `/db/session-competition?session=ID` | Інфо про змагання, до якого прив'язана сесія |
| GET 🔒 | `/db/collector-log?limit=200` | Останні N сесій (raw, для admin) |
| POST 🔒 | `/db/update-sessions-track` | `{sessionIds, trackId}` — batch update |
| POST 🔒 | `/db/propagate-track` | `{sessionId, trackId}` — оновити сесію + усі наступні non-competition того ж дня |
| POST 🔒 | `/db/rename-pilot` | `{sessionId, oldName, newName}` — перейменувати пілота |

## Track config

| Method | Path | Опис |
|---|---|---|
| GET | `/track` | Поточний `{ trackId }` |
| POST 🔒 | `/track` | Body: `{ trackId }` (1..20). Оновлює track для всіх майбутніх сесій |

## Scoring rules

Зберігається в `db_stats`. Fallback — `public/data/scoring.json`.

| Method | Path | Опис |
|---|---|---|
| GET | `/scoring` | Положення/обгони/швидкісні бали |
| POST 🔒 | `/scoring` | Body: `{positionPoints, positionPoints_CL?, overtakePoints, speedPoints}` |

## Page visibility & moderators (server-side persistence)

| Method | Path | Опис |
|---|---|---|
| GET | `/page-visibility` | `{ userPages, adminPages, accountOverrides }` |
| POST 🔒 | `/page-visibility` | Те саме body |
| GET | `/moderators` | `[{ email, permissions: [...] }]` |
| POST 🔒 | `/moderators` | Те саме body |
| GET | `/view-defaults` | Layout defaults для сторінок (з версіонуванням) |
| POST 🔒 | `/view-defaults` | Body: `{ pageId, version, sections: [{id, visible}] }` |

## Competitions

| Method | Path | Опис |
|---|---|---|
| GET | `/competitions` | Список змагань |
| GET | `/competitions/:id` | Одне змагання |
| POST 🔒 | `/competitions` | Створити (body: `{id, name, format, date, sessions, status}`) |
| PATCH 🔒 | `/competitions/:id` | Оновити (часткові поля, типово `{results, status}`) |
| DELETE 🔒 | `/competitions/:id` | Видалити |
| POST 🔒 | `/competitions/:id/link-session` | `{sessionId, phase}` |
| POST 🔒 | `/competitions/:id/unlink-session` | `{sessionId}` |
| POST 🔒 | `/competitions/:id/update-track` | `{trackId}` — оновити trackId для всіх linked sessions |

## External proxies

| Method | Path | Опис |
|---|---|---|
| GET | `/proxy/sheets-csv?url=<encoded>` | Проксі для Google Sheets CSV (обхід CORS, для Sprint порівнянь з офіційною таблицею) |

---

## Implementation notes

- HTTP-сервер — plain `http.createServer` (не Express).
- Усі endpoints — у `collector/src/index.js`, додавай ДО `sendJson(res, 404, { error: 'Not found' })`.
- Pattern для нових write-endpoints — див. `.cursor/rules/collector-patterns.mdc`.
- ADMIN_TOKEN env var — якщо порожня, всі endpoints працюють без auth (для dev).
- DB schema — `docs/database-schema.md`.
