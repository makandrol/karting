---
name: karting-merge-to-main
description: Merge dev → main with full release flow — update changelog, bump version, create entry, no-ff merge, push both branches. Use ONLY when user explicitly asks to merge to main, release, or push to production.
---

# Merge dev → main

**Цей скіл — ТІЛЬКИ коли користувач явно просить мердж у `main` / реліз / "пуш у продакшн".**

Працює лише з frontend (Netlify auto-deploy з `main`). Collector деплоїться окремо через `karting-deploy-collector`.

## Безпекові гарантії

- ❌ НІКОЛИ не запускай цей скіл без явного прохання користувача (CRITICAL — `.cursor/rules/changelog.mdc`)
- ❌ НІКОЛИ не роби force push в `main`
- ❌ НІКОЛИ не використовуй `git rebase -i` (інтерактивний — не підтримується)
- ❌ НІКОЛИ не оновлюй `git config`
- ❌ НЕ комітуй `.env`, секрети, креденшіали
- ✅ Завжди `--no-ff` merge — щоб історія мержів була зрозумілою

## Повний flow

### 1. Початковий стан

```bash
git status
git branch --show-current
git log --oneline main..dev   # commits що йдуть у main
```

Переконайся:
- Поточна гілка — `dev` (або користувач хоче спершу свіч)
- Working tree чистий (немає uncommitted)
- Усі поточні commits на `dev` запушені (`git status` не показує `Your branch is ahead`)

### 2. Bump версії (якщо ще не зроблено)

Дізнайся, чи в коммітах між `main..dev` уже є bump версії:

```bash
git log main..dev --oneline -- package.json collector/package.json
```

Якщо НЕ було bump-ів у нових коммітах — інкрементуй:
- Якщо змінювалися файли frontend → bump `package.json`
- Якщо змінювалися файли collector → bump `collector/package.json`

Використай скіл `karting-bump-version`.

Закомітуй bump у `dev`:
```bash
git add package.json collector/package.json
git commit -m "v0.9.X bump version"
```

### 3. Збери інформацію для changelog

```bash
# Усі commits між main і dev
git log main..dev --pretty=format:'%h %s' --no-merges

# Якщо багато — глянь conventional groups
git log main..dev --pretty=format:'%s' --no-merges | head -50
```

### 4. Оновити `src/data/changelog.ts`

**ОБОВ'ЯЗКОВО, перед мерджем.** Правила (з `.cursor/rules/changelog.mdc`):

1. **Додай НОВУ `ChangelogEntry` НА ПОЧАТОК масиву `CHANGELOG`** — найновіший зверху.
2. **Поле `version`** — найвища нова frontend версія (наприклад `'0.9.413'`). Якщо merge включає кілька bump-ів — використовуй найвищу з них.
3. **Поле `date`** — формат `YYYY-MM-DD HH:MM` (24h, **Kyiv local time = system time + 2 години**). Отримай:

```bash
node -e "const d=new Date(Date.now()+2*3600*1000); const pad=n=>String(n).padStart(2,'0'); console.log(`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`);"
```

4. **Поле `title`** — короткий заголовок українською (4-7 слів), охоплює основну тему мержу. Приклад: `'Онборд: квала-позиції, розумні дефолти, T1/T2'`.
5. **Поле `changes`** — масив рядків, по одному на версію (НЕ по одному на коміт). **Українська мова.** Кожен рядок: `'v0.9.X — короткий опис'`.
   - Групуй пов'язані commits під однією версією
   - Описуй ЩО ЗМІНИЛОСЬ (UI елементи, алгоритми, позиції), а не "improvements" / "fixes"
   - Дотримуйся стилю наявних entries — глянь `src/data/changelog.ts` для прикладів
6. Збережи файл.

### 5. Bump версії ще раз для changelog-коміту (опційно)

Зазвичай не треба — changelog включається в той самий version bump. Але якщо хочеш окремо — bump знову і закомітуй.

### 6. Закомітити changelog у `dev`

```bash
git add src/data/changelog.ts
git commit -m "$(cat <<'EOF'
v0.9.X changelog: <title>
EOF
)"
git push origin dev
```

(Замінити X та `<title>` на актуальні.)

### 7. Merge у `main`

```bash
git checkout main
git pull origin main
git merge dev --no-ff -m "$(cat <<'EOF'
v0.9.X merge: <title>
EOF
)"
```

Якщо merge має конфлікти — зупинись, повідом користувача, чекай інструкцій. НЕ намагайся вгадати resolution.

### 8. Push обох гілок

```bash
git push origin main
git checkout dev
git push origin dev
```

(`dev` уже запушений у кроці 6, але про всяк випадок дорівняй.)

### 9. Перевір що Netlify підхопив

```bash
git log main -1 --oneline
```

Netlify автоматично почне build з `main`. Користувач побачить через 1-2 хв на проді.

### 10. Якщо collector теж змінювався — окремо деплой

Окремо запропонуй `karting-deploy-collector` — Netlify не деплоїть бекенд.

### 11. Звіт користувачу

- Версія frontend / collector після bump
- Заголовок + кілька головних змін з changelog
- Кількість commits змерджено
- Чи треба deploy collector
- Посилання на проду (https://ekarting.com.ua або яке у користувача), якщо знаєш

## Приклад готового entry

```ts
{
  version: '0.9.413',
  date: '2026-05-29 17:30',
  title: 'Онборд історія, per-track scoring, scrub-time positions',
  changes: [
    'v0.9.413 — Pilot/kart history overlay в онборді',
    'v0.9.413 — Per-track scoring laps configuration',
    'v0.9.413 — Scrub-time positions у replay режимі',
    'v0.9.412 — Перейменування пілотів через всі сесії Гонзалеса',
  ],
},
```

## Edge cases

- **Якщо `main` уже синхронний з `dev`** (все мерджено) — нема чого мерджити, скажи користувачу
- **Якщо в `dev` є untracked / unstaged зміни** — спершу запитай користувача чи вони мають бути в мержі, потім commit, потім продовжуй
- **Якщо є pre-commit hook**, що міняє файли — додай їх НОВИМ commit, НЕ `--amend` (правила безпеки git)
- **Якщо merge провалився** — НЕ створюй пустий мердж-коміт. Повідом користувачу і зупинись

## ВАЖЛИВО

- Правила з `.cursor/rules/changelog.mdc` — інваріант. Цей скіл їх імплементує. Якщо щось у ньому суперечить `changelog.mdc` — `changelog.mdc` має пріоритет.
- НЕ створюй pull request на GitHub без явного прохання — користувач воркфлоу через прямий мердж локально.
