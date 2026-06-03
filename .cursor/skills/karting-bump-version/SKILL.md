---
name: karting-bump-version
description: Increment frontend or collector version in package.json. Use when finishing a code change to bump the patch version, or when the user asks to bump/increment the version.
---

# Bump Version

Інкрементуй версію патч-номером (`X+1`) — кожна зміна коду в проєкті заслуговує на bump.

## Дві окремі версії

| Що змінено | Файл | Формат | Поточна |
|---|---|---|---|
| Frontend (`src/`, `public/`, `vite.config.ts`, `tailwind.config.js`, `index.html`, `tsconfig.json`) | `package.json` | `0.9.X` | див. файл |
| Collector (`collector/src/`) | `collector/package.json` | `0.3.X` | див. файл |

Якщо змінювалося і там, і там — інкрементуй ОБИДВІ.

## Flow

1. **Визнач що змінено**:
```bash
git status
git diff --name-only HEAD
```

2. **Перевір поточну версію**:
```bash
node -e "console.log('frontend:', require('./package.json').version)"
node -e "console.log('collector:', require('./collector/package.json').version)"
```

3. **Інкрементуй потрібну (-і)**:

Frontend (`0.9.X` → `0.9.X+1`):
```bash
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); const [a,b,c]=p.version.split('.').map(Number); p.version=`${a}.${b}.${c+1}`; fs.writeFileSync('package.json', JSON.stringify(p, null, 2)+'\n'); console.log('frontend → '+p.version);"
```

Collector (`0.3.X` → `0.3.X+1`):
```bash
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('collector/package.json')); const [a,b,c]=p.version.split('.').map(Number); p.version=`${a}.${b}.${c+1}`; fs.writeFileSync('collector/package.json', JSON.stringify(p, null, 2)+'\n'); console.log('collector → '+p.version);"
```

4. **Звітуй користувачу нову версію**.

## Правила

- НЕ переходь через minor (`0.10.0`) і НЕ змінюй major (`1.0.0`) без явного прохання користувача.
- НЕ змінюй жодних інших полів `package.json` (`name`, `dependencies`, etc).
- НЕ оновлюй `APP_VERSION` у `src/data/changelog.ts` — він авто-імпортується з `package.json`.
- Версія = РОБОЧИЙ номер. Інкрементуй з кожним смисловим коммітом, навіть якщо це 1-рядковий fix.

## Коли скіл застосовується

- Користувач закінчив редагування коду і просить зробити commit / merge
- Користувач явно просить "bump version" / "інкрементуй версію"
- В рамках більшого скіла (`karting-merge-to-main`)

## Коли НЕ застосовується

- Зміни лише в `docs/`, `.cursor/`, `AGENTS.md`, `.gitignore`, `README.md` — без bump (це не код)
- Зміна тільки в `node_modules/` — без bump
- Якщо вже інкрементили в цій же сесії — НЕ інкрементуй знову, якщо не було нових змін коду між

## Edge cases

- Якщо `0.9.999` → `0.9.1000` (очікувана поведінка, нічого особливого)
- Якщо хтось руками встановив "невалідну" версію (`0.9` без патча) — попередь користувача, не додавай патч сам
