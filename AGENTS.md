# Karting "Жага швидкості" — Agent Entry Point

Real-time timing dashboard для картодрому "Жага швидкості". Цей файл — перша точка для будь-якого агента, який починає роботу в репо.

## Що це

Three-tier app:

- **Frontend** (`src/`) — React 18 + TS + Vite + Tailwind, lazy routes, Firebase Auth
- **Collector** (`collector/`) — Node.js 20, plain `http`, `better-sqlite3`, без фреймворків
- **Tools** (`tools/path-editor.html`) — окремий SVG-редактор шляхів треків (vanilla HTML+JS)

Frontend деплоїться на Netlify з `main` автоматично. Collector — на Oracle VPS `150.230.157.143`, керується PM2, ходить за даними на `nfs.playwar.com:3333` адаптивним полінгом (1s/10s/60s).

Дві окремі версії:
- Frontend: `package.json` → `0.9.x` (зараз 0.9.412)
- Collector: `collector/package.json` → `0.3.x` (зараз 0.3.7)

`APP_VERSION` авто-читається з `package.json` (`src/data/changelog.ts`).

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

## Структура проєкту

```
karting/
├── AGENTS.md                  ← цей файл
├── .cursor/
│   ├── rules/                 ← правила інжектяться автоматично
│   └── skills/                ← процедурні скіли (deploy, bump, merge)
├── docs/                      ← довідкова, читай за потребою
├── src/                       ← frontend
│   ├── App.tsx                ← роути (lazy)
│   ├── components/            ← Layout, Timing, Results, Sessions, Track, Filters
│   ├── pages/                 ← Auth, Info, Pilots, Results, Sessions
│   ├── services/              ← auth, layoutPrefs, pageVisibility, timingPoller, ...
│   ├── utils/                 ← scoring, timing, session, sheetsCompare
│   ├── data/                  ← competitions, tracks, changelog
│   ├── types/index.ts
│   └── index.css
├── collector/
│   ├── src/                   ← index.js, poller.js, storage.js, detector.js, ...
│   └── package.json           ← v0.3.x
├── public/
│   ├── data/scoring.json      ← fallback scoring rules
│   └── tracks/tracks.json     ← дані для треків (svgPaths, gridPositions, ...)
├── tools/path-editor.html     ← редактор шляхів
├── package.json               ← v0.9.x
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
