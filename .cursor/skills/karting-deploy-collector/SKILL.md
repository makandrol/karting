---
name: karting-deploy-collector
description: Deploy the collector backend to the Oracle VPS — scp files, pm2 restart, verify health. Use when the user asks to deploy/push the collector, backend, or server.
---

# Deploy Collector

Виконуй ЦЕЙ flow повністю, коли користувач просить деплой колектора (`деплой колектора`, `задеплой бекенд`, `пуш на сервер`, `restart pm2`, тощо).

## Передумови

- SSH ключ: `~/.ssh/id_github`
- Сервер: `ubuntu@150.230.157.143`
- App path: `/home/ubuntu/collector/`
- DB path: `/home/ubuntu/collector/data/karting.db` (НЕ чіпай)
- Process manager: PM2, app name `collector`
- Port: 3001

## Стандартний flow

1. **Перевір що зміни закомічені** (або користувач явно просить deploy без commit):
```bash
git status
```

2. **Бамп collector version** (якщо зміни в `collector/src/`):
   - Використай скіл `karting-bump-version` для `collector/package.json`.
   - Якщо просять deploy без зміни коду (наприклад просто restart) — пропусти.

3. **Скопіюй змінені файли на сервер.** Не копіюй усе підряд — копіюй тільки те, що змінилося:

```bash
# Якщо змінено кілька файлів у collector/src/
scp -i ~/.ssh/id_github collector/src/index.js collector/src/storage.js \
  ubuntu@150.230.157.143:/home/ubuntu/collector/src/

# Якщо тільки один файл
scp -i ~/.ssh/id_github collector/src/storage.js \
  ubuntu@150.230.157.143:/home/ubuntu/collector/src/storage.js

# Якщо змінився package.json (нова залежність)
scp -i ~/.ssh/id_github collector/package.json \
  ubuntu@150.230.157.143:/home/ubuntu/collector/package.json
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "cd /home/ubuntu/collector && npm install"
```

4. **Restart PM2**:
```bash
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 restart collector"
```

5. **Verify health** — це обов'язково, не пропускай:
```bash
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "curl -s localhost:3001/healthz"
```
Очікуваний результат: `{"ok":true,"uptime":<small_number>}`. Uptime має бути малим — це підтверджує що restart відбувся.

6. **Перевір логи на помилки**:
```bash
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 logs collector --nostream --lines 20"
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 logs collector --nostream --lines 10 --err"
```

7. **Звітуй користувачу**: версія колектора, які файли скопійовано, uptime з healthz, чи є помилки в логах.

## Корисні команди

```bash
# PM2 list
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 list"

# Stop / start
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 stop collector"
ssh -i ~/.ssh/id_github ubuntu@150.230.157.143 "pm2 start collector"

# DB stats / sessions count
curl http://150.230.157.143:3001/status

# Перевірка живих даних
curl http://150.230.157.143:3001/timing
```

## ВАЖЛИВО / небезпеки

- **НІКОЛИ не копіюй `collector/data/`** — це SQLite база на сервері, її переписувати означає втратити всі історичні дані.
- **НЕ деплой `node_modules/`** — встановлюй на сервері через `npm install`.
- **НЕ використовуй `pm2 delete collector`** без явного прохання — це знесе інстанс і доведеться знову `pm2 start`.
- Якщо collector не стартує після restart — глянь `pm2 logs --err`, перевір чи `package.json` сумісний (нова залежність потребує `npm install`).
- Frontend деплоїться окремо через Netlify (auto-deploy з `main`). НЕ змішуй.

## Коли цей скіл НЕ застосовний

- Користувач хоче деплой frontend → це Netlify, не цей скіл (просто merge у `main`)
- Користувач хоче налаштувати новий PM2 instance → запитай деталі, не виконуй
- Будь-які небезпечні операції з БД на сервері → запитай підтвердження
