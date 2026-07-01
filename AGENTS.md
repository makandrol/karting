# Karting "Жага швидкості" — Agent Entry Point

Real-time timing dashboard для картодрому "Жага швидкості". Цей файл — перша точка для будь-якого агента, який починає роботу в репо.

## Що це

Three-tier app:

- **Frontend** (`src/`) — React 18 + TS + Vite + Tailwind, lazy routes, Firebase Auth
- **Collector** (`collector/`) — Node.js 20, plain `http`, `better-sqlite3`, без фреймворків
- **Tools** (`tools/path-editor.html`) — окремий SVG-редактор шляхів треків (vanilla HTML+JS)

Frontend деплоїться на Netlify з `main` автоматично. Collector — на Oracle VPS `141.147.32.196`, керується PM2, ходить за даними на `nfs.playwar.com:3333` адаптивним полінгом (1s/10s/60s).

Дві окремі версії:
- Frontend: `package.json` → `0.9.x` (зараз 0.9.433)
- Collector: `collector/package.json` → `0.3.x` (зараз 0.3.8)

`APP_VERSION` авто-читається з `package.json` (`src/data/changelog.ts`).

## Тести

Vitest + happy-dom. Запуск:
```bash
npm test           # одноразовий run
npm run test:watch # watch mode
```

Тести в:
- `src/utils/scoring.test.ts` — pure scoring functions
- `src/utils/timing.test.ts` — parseTime, mergePilotNames, isValidSession
- `src/utils/datetime.test.ts` — fmtTime, fmtDuration, fmtDateLabel
- `src/data/competitions.test.ts` — group splitting, phase config
- `src/services/useLocalStorage.test.ts` — hook persistence
- `collector/src/storage-utils.test.js` — parseCompetitionRow, mergeSessions

**При змінах в scoring/timing/competitions/storage-utils — додавай тести.** Поточно: 120 passing.

## Куди дивитись

| Запитання | Файл |
|---|---|
| Загальна архітектура | `docs/architecture.md` |
| Регламент змагань (4 формати) | `docs/competition-rules.md` |
| Як визначаються групи / фази | `docs/competition-detection.md` |
| API колектора (ендпоінти, схема БД) | `docs/collector-api.md` |
| Як деплоїти | `docs/deployment.md` |
| SQL схема | `docs/database-schema.md` |
| Список змін / реліз-ноти | `src/data/changelog.ts` (рендериться на `/changelog`) |

Інваріанти / патерни коду інжектуються автоматично через `.cursor/rules/`. Окремо їх читати не потрібно — вони з'являться у твоєму контексті, коли ти редагуватимеш відповідні файли.

## Найважливіше для роботи

1. **Працюй на гілці `dev`**. НІКОЛИ не мерджи в `main` без явного прохання користувача. Коли просять — використай скіл `karting-merge-to-main`.
2. **Commit + bump + push після кожної логічної зміни** — автоматично, без питань. Деталі — у `.cursor/rules/git-workflow.mdc`. Використовуй скіл `karting-bump-version` для bump-у.
3. **Колектор деплоїться окремо** від frontend. Скіл `karting-deploy-collector`.
4. **Українська мова в UI**. Без емодзі в коді (тільки де явно стоять у наявному UI).
5. **Tailwind CSS** — без CSS-modules. Темна тема: `bg-dark-900`, `text-dark-300`, `border-dark-800`.
6. **TypeScript** на frontend, plain JS на collector.
7. **Lazy pages** — кожна сторінка через `React.lazy()` в `src/App.tsx`.

## Централізовані утиліти (НЕ винаходь колесо)

При написанні нового коду використовуй наявні модулі замість дублювання:

| Що треба | Використай |
|---|---|
| HTTP-виклик до колектора | `api.*` з `services/api/` (НЕ `fetch(\`${COLLECTOR_URL}/...\`)`) |
| Persistence в localStorage | `useLocalStorage<T>(key, defaultValue, opts?)` з `services/useLocalStorage.ts` |
| Час/дата формат | `fmtTime/fmtDuration/fmtDateLabel/fmtDateISO` з `utils/datetime.ts` |
| Lap times | `parseTime/toSeconds/toHundredths` з `utils/timing.ts` |
| Скорочення імен | `shortName/shortPilot` з `utils/timing.ts` |
| Loading/Error/Empty UI | `<LoadingState />`, `<ErrorState />`, `<EmptyState />` з `components/States.tsx` |
| Scoring обчислення | `computeStandings/computeSprintStandings/computeGonzalesStandings` з `utils/scoring.ts` |
| DbSession / DbLap типи | `import { type DbSession } from 'services/api'` (НЕ локальні interfaces) |

Більше — у `.cursor/rules/frontend-patterns.mdc` (інжектиться автоматично при редагуванні `src/`).

## Структура проєкту

```
karting/
├── AGENTS.md                  ← цей файл
├── .cursor/
│   ├── rules/                 ← правила інжектяться автоматично
│   └── skills/                ← процедурні скіли (deploy, bump, merge)
├── docs/                      ← довідкова, читай за потребою
├── src/                       ← frontend
│   ├── App.tsx                ← роути (lazy) + RouteShield (per-route ErrorBoundary)
│   ├── components/
│   │   ├── States.tsx         ← LoadingState/ErrorState/EmptyState
│   │   ├── ErrorBoundary.tsx
│   │   ├── Layout/, Timing/, Results/, Sessions/, Track/
│   ├── pages/
│   │   ├── Auth/AccessSettings/  ← розбито на 7 файлів за секціями
│   │   ├── Results/
│   │   │   ├── CompetitionPage.tsx          (LiveResults + helpers)
│   │   │   ├── CompetitionList.tsx          (list + ListItem)
│   │   │   ├── LiveSessionTable.tsx         (live timing для сесії)
│   │   │   ├── competition-types.ts         (Competition, SessionLap)
│   │   │   └── competition-utils.ts         (date helpers, FORMAT_FILTERS)
│   │   └── Sessions/
│   │       ├── SessionDetail.tsx
│   │       └── useSessionData.ts             ← хук для даних сесії
│   ├── services/
│   │   ├── api/               ← http.ts + index.ts (centralized client)
│   │   ├── useLocalStorage.ts
│   │   ├── auth, layoutPrefs, pageVisibility, timingPoller, trackContext
│   ├── utils/                 ← scoring, timing, datetime, session, sheetsCompare
│   ├── data/                  ← competitions, tracks, changelog
│   └── types/index.ts
├── collector/
│   ├── src/                   ← index.js, poller.js, storage.js, storage-utils.js, ...
│   └── package.json           ← v0.3.x
├── public/
│   ├── data/scoring.json      ← fallback scoring rules
│   └── tracks/tracks.json     ← дані для треків
├── tools/path-editor.html     ← редактор шляхів
├── package.json               ← v0.9.x
├── vitest.config.ts           ← happy-dom env
├── tailwind.config.js
└── vite.config.ts
```

## Гілки

- `main` — production, авто-деплой Netlify
- `dev` — активна розробка

## Як інкрементити версію (швидко)

```bash
# Frontend (більшість змін)
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); const [a,b,c]=p.version.split('.').map(Number); p.version=`${a}.${b}.${c+1}`; fs.writeFileSync('package.json', JSON.stringify(p, null, 2)+'\n'); console.log(p.version);"
```

Деталі — у скілі `karting-bump-version`.
