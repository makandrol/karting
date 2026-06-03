# Karting "Жага швидкості" — Documentation

Reference documentation для проєкту. **Не для агентів за замовчуванням** — для людей, які копаються в архітектурі або інтегруються з API. Агенти інжектять контекст через `.cursor/rules/` автоматично; для них перша точка — `AGENTS.md` у корені.

## Index

| Документ | Про що |
|---|---|
| [architecture.md](./architecture.md) | Three-tier архітектура, event-sourcing, polling, frontend providers, scoring flow |
| [collector-api.md](./collector-api.md) | REST API колектора — усі endpoints |
| [database-schema.md](./database-schema.md) | SQLite schema, JSON структура `competitions.results` |
| [competition-rules.md](./competition-rules.md) | Регламент: Гонзалес, Лайт Ліга, Ліга Чемпіонів, Спринт |
| [competition-detection.md](./competition-detection.md) | Auto-detection груп / фаз / прив'язки сесій |
| [deployment.md](./deployment.md) | Як деплоїти collector (PM2 на VPS) і frontend (Netlify) |
| [path-editor.md](./path-editor.md) | Редактор SVG-шляхів треків (`tools/path-editor.html`) |

## Releases / changelog

`src/data/changelog.ts` — автогенерована сторінка `/changelog`. Версії — у `package.json` (`0.9.x` frontend) і `collector/package.json` (`0.3.x`).

## Tools

- `tools/path-editor.html` — vanilla HTML+JS редактор SVG-шляхів треків. Запускай через `node tools/server.cjs` → `http://localhost:8778/tools/path-editor.html`. Виводить JSON у форматі `public/tracks/tracks.json`. Деталі — [path-editor.md](./path-editor.md).

## Tech overview (швидко)

- React 18 + TypeScript + Vite + Tailwind на frontend
- Plain Node.js HTTP + better-sqlite3 на collector (БЕЗ Express)
- Firebase Google Sign-In для auth
- Netlify (frontend) + Oracle VPS PM2 (collector)
- Timing API — зовнішній: `nfs.playwar.com:3333`

Деталі — у `architecture.md`.

## Для розробника-людини

Якщо ти агент — стоп, читай `AGENTS.md` у корені, а не цю папку.

Якщо ти людина:
1. `architecture.md` — як це все працює
2. `collector-api.md` — якщо інтегруєшся з API ззовні
3. `competition-rules.md` + `competition-detection.md` — якщо хочеш зрозуміти бізнес-логіку змагань
4. `deployment.md` — якщо треба задеплоїти

## Не у docs/

Інваріанти коду, патерни, гайди для агентів — у `.cursor/rules/`. Не дублюй сюди — рулі автоматично інжектяться у Claude/Cursor.
