# Karting Collector API

Сервер для збору даних з таймінгу картодрому "Жага швидкості".

**Base URL:** `https://ekarting.duckdns.org` (або `http://150.230.157.143:3001`)

CORS увімкнений — можна запитувати з будь-якого домену, браузера чи програми.

---

## Як працює

Collector сервер отримує дані напряму з JSON API таймінгу (`nfs.playwar.com:3333/getmaininfo.json`):
- Коли API **недоступний** → запит кожні 60 секунд
- Коли API доступний, але **немає пілотів** → запит кожні 10 секунд
- Коли **є пілоти на трасі** → запит кожну 1 секунду
- Зберігає поточний стан і лог змін в пам'яті + SQLite
- Віддає кешовані дані через HTTP API

---

## Публічні ендпоінти (без авторизації)

### `GET /healthz` — Health check

```json
{ "ok": true, "uptime": 86400.123 }
```

---

### `GET /status` — Стан сервера

Повертає поточний стан collector'а + статистику БД.

| Поле | Тип | Опис |
|------|-----|------|
| `online` | boolean | `true` = картодром працює |
| `pollCount` | number | К-сть запитів до таймінгу |
| `errorCount` | number | К-сть невдалих запитів |
| `entriesCount` | number | К-сть пілотів на трасі зараз |
| `eventsCount` | number | К-сть подій в пам'яті |
| `sessionId` | string \| null | ID поточного заїзду |
| `sessionsCount` | number | К-сть заїздів з моменту старту |
| `lastUpdate` | number \| null | Unix ms останньої зміни |
| `pollInterval` | number | Поточний інтервал опитування (мс) |
| `db` | object | Статистики БД (розмір, к-сть записів) |

---

### `GET /timing` — Поточні дані таймінгу

Головний ендпоінт — поточне табло з пілотами, позиціями та часами.

**Відповідь:**
```json
{
  "isOnline": true,
  "lastUpdate": 1710523456789,
  "sessionId": "session-1710520000000",
  "trackId": 3,
  "competition": { "active": false, "format": null },
  "entries": [
    {
      "position": 1,
      "pilot": "Апанасенко Олексій",
      "kart": 7,
      "lastLap": "40.823",
      "s1": "13.245",
      "s2": "27.578",
      "bestLap": "40.123",
      "lapNumber": 12
    }
  ],
  "teams": [ ... ],
  "meta": { ... }
}
```

| Поле entries[] | Тип | Опис |
|----------------|-----|------|
| `position` | number | Позиція на таблі (1 = лідер) |
| `pilot` | string | Ім'я пілота |
| `kart` | number | Номер карту |
| `lastLap` | string \| null | Час останнього кола: `"40.823"` або `"1:02.345"` |
| `s1` | string \| null | Час сектора 1: `"13.245"` |
| `s2` | string \| null | Час сектора 2: `"27.578"` |
| `bestLap` | string \| null | Найкращий час кола в поточному заїзді |
| `lapNumber` | number | Номер поточного кола |

---

### `GET /track` — Поточний трек

```json
{ "trackId": 3 }
```

---

### `GET /events` — Лог подій (з пам'яті)

| Параметр | Тип | Опис |
|----------|-----|------|
| `session` | string | Фільтр по ID заїзду |
| `since` | number | Тільки події після цього timestamp (unix ms) |

**Типи подій:**

| Тип | Коли | Дані |
|-----|------|------|
| `snapshot` | Початок заїзду | `{ entries: [...] }` — повний стан табла |
| `lap` | Пілот завершив коло | `pilot, kart, lapNumber, lastLap, s1, s2, bestLap, position` |
| `s1` | Пілот пройшов сектор 1 | `pilot, kart, s1` |
| `update` | Зміна позиції/статусу | `pilot, kart, team` |
| `pilot_join` | Пілот з'явився | `pilot, kart` |
| `pilot_leave` | Пілот покинув | `pilot` |
| `poll_ok` | Без змін | `null` |

---

### `GET /sessions` — Список сесій (з пам'яті)

Сесії з моменту старту сервера.

```json
[
  { "id": "session-1710520000000", "startTime": 1710520000000, "endTime": 1710521200000, "entryCount": 8 }
]
```

---

### `GET /db/sessions` — Сесії з БД

| Параметр | Тип | Опис |
|----------|-----|------|
| `date` | string | Дата `YYYY-MM-DD`. Без параметра — останні 100 |

Повертає сесії з додатковими полями: `best_lap`, `best_lap_pilot`, `competition`, `day_order`. Сесії з однаковим `race_number` в межах 5 хв об'єднуються.

---

### `GET /db/laps` — Кола з БД

**По сесії:**

| Параметр | Тип | Опис |
|----------|-----|------|
| `session` | string | ID заїзду (обов'язково, якщо без `kart`) |

**По карту:**

| Параметр | Тип | Опис |
|----------|-----|------|
| `kart` | number | Номер карту |
| `from` | string | Дата початку `YYYY-MM-DD` |
| `to` | string | Дата кінця `YYYY-MM-DD` |

**Відповідь:** масив кіл з полями `pilot, kart, lap_number, lap_time, s1, s2, best_lap, position, ts`.

---

### `GET /db/events` — Події з БД

| Параметр | Тип | Опис |
|----------|-----|------|
| `session` | string | ID заїзду |
| `since` | number | Тільки після цього timestamp (unix ms) |

---

### `GET /db/session-counts` — К-сть сесій по датах

| Параметр | Тип | Обов'язково | Опис |
|----------|-----|-------------|------|
| `from` | string | так | Дата початку `YYYY-MM-DD` |
| `to` | string | так | Дата кінця `YYYY-MM-DD` |

```json
[{ "date": "2026-03-15", "count": 12 }]
```

---

### `GET /db/kart-stats` — Статистика по картах

| Параметр | Тип | Обов'язково | Опис |
|----------|-----|-------------|------|
| `from` | string | так | Дата початку `YYYY-MM-DD` |
| `to` | string | так | Дата кінця `YYYY-MM-DD` |

### `POST /db/kart-stats` — Статистика по картах для конкретних сесій

```json
{ "sessionIds": ["session-123", "session-456"] }
```

---

### `GET /db/kart-session-counts` — Сесії по карту

| Параметр | Тип | Обов'язково | Опис |
|----------|-----|-------------|------|
| `kart` | number | так | Номер карту |

---

### `GET /db/session-competition` — Змагання для сесії

| Параметр | Тип | Обов'язково | Опис |
|----------|-----|-------------|------|
| `session` | string | так | ID заїзду |

Повертає `{ competitionId, phase, format }` або `{ competitionId: null }`.

---

### `GET /competitions` — Список змагань

| Параметр | Тип | Опис |
|----------|-----|------|
| `format` | string | Фільтр: `light_league`, `champions_league`, `gonzales` |

---

### `GET /competitions/:id` — Конкретне змагання

```json
{
  "id": "ll-2026-03-18",
  "name": "Лайт Ліга Тр. 3",
  "format": "light_league",
  "date": "2026-03-18",
  "sessions": [{ "sessionId": "session-123", "phase": "qualifying" }],
  "results": { "excludedPilots": [], "edits": {}, "excludedLaps": [], "editLog": [] },
  "status": "live"
}
```

---

### `GET /competition` — Стан автовизначення змагань

Повертає поточний стан `CompetitionDetector`.

---

### `GET /scoring` — Таблиця балів

Повертає налаштування scoring (position points, speed points, overtake points).

---

### `POST /analytics` — Трекінг перегляду сторінки

```json
{ "page": "/sessions", "sessionId": "abc", "userAgent": "..." }
```

---

## Адмін ендпоінти (потрібен `Authorization: Bearer <token>`)

### Трек

| Метод | Шлях | Опис |
|-------|------|------|
| POST | `/track` | Змінити поточний трек: `{ trackId: 3 }` |

### Система

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/system` | CPU, RAM, диск, Node.js версія |
| GET | `/analytics?days=7` | Статистика відвідувань |
| GET | `/db/collector-log?limit=200` | Останні сесії (raw, до 1000) |

### Scoring

| Метод | Шлях | Опис |
|-------|------|------|
| POST | `/scoring` | Зберегти таблицю балів: `{ positionPoints, speedPoints, overtakePoints }` |

### Змагання CRUD

| Метод | Шлях | Опис |
|-------|------|------|
| POST | `/competitions` | Створити: `{ id, name, format, date }` |
| PATCH | `/competitions/:id` | Оновити поля |
| DELETE | `/competitions/:id` | Видалити |
| POST | `/competitions/:id/link-session` | Прив'язати заїзд: `{ sessionId, phase }` |
| POST | `/competitions/:id/unlink-session` | Відв'язати заїзд: `{ sessionId }` |
| POST | `/competitions/:id/update-track` | Оновити трек для всіх сесій: `{ trackId }` |

### Управління змаганнями

| Метод | Шлях | Опис |
|-------|------|------|
| POST | `/competition/start` | Запустити вручну: `{ format, name }` |
| POST | `/competition/stop` | Зупинити |
| POST | `/competition/phase` | Відмітити фазу: `{ sessionId, type, name }` |
| POST | `/competition/reset` | Скинути автовизначення |

### Пілоти

| Метод | Шлях | Опис |
|-------|------|------|
| POST | `/db/rename-pilot` | Перейменувати: `{ sessionId, oldName, newName }` |

### Сесії

| Метод | Шлях | Опис |
|-------|------|------|
| POST | `/db/update-sessions-track` | Змінити трек для кількох сесій: `{ sessionIds: string[], trackId: number }` |

---

## Важливі деталі

1. **Час** — всі timestamps в Unix мілісекундах (13 цифр)
2. **Час кіл** — строка в секундах (`"40.823"`) або хвилинах (`"1:02.345"`)
3. **Кешування** — дані кешуються на сервері, запити не навантажують timing API
4. **CORS** — `Access-Control-Allow-Origin: *`
5. **Rate limiting** — немає (рекомендовано ≤ 5 req/sec)
6. **Body limit** — 512 KB
7. **Мін. валідне коло** — 38 секунд (фільтрується на рівні SQL)
8. **Мін. валідна сесія** — 3 хвилини
9. **ID сесій** — формат `session-{unix_timestamp_ms}`

---

## Приклади

### Python

```python
import requests
import time

BASE_URL = "https://ekarting.duckdns.org"

# Стан сервера
status = requests.get(f"{BASE_URL}/status").json()
print(f"Online: {status['online']}, Polls: {status['pollCount']}")

# Поточний таймінг
data = requests.get(f"{BASE_URL}/timing").json()
if data["isOnline"]:
    for e in data["entries"]:
        print(f"  P{e['position']} | {e['pilot']:25s} | Kart {e['kart']:2d} | "
              f"Lap: {e['lastLap'] or '---':>8s} | Best: {e['bestLap'] or '---':>8s}")

# Сесії за дату
sessions = requests.get(f"{BASE_URL}/db/sessions?date=2026-04-01").json()
for s in sessions:
    print(f"  {s['id']} | pilots: {s.get('pilot_count', '?')}")

# Кола для сесії
laps = requests.get(f"{BASE_URL}/db/laps?session={sessions[0]['id']}").json()
for lap in laps:
    print(f"  {lap['pilot']} | Kart {lap['kart']} | {lap['lap_time']}")

# Постійне опитування таймінгу
while True:
    data = requests.get(f"{BASE_URL}/timing").json()
    if data["isOnline"]:
        print(f"{len(data['entries'])} pilots on track")
    time.sleep(1)
```

### JavaScript

```javascript
const BASE_URL = "https://ekarting.duckdns.org";

// Поточний таймінг
const { isOnline, entries, sessionId } = await fetch(`${BASE_URL}/timing`).then(r => r.json());
if (isOnline) {
  entries.forEach(e =>
    console.log(`P${e.position} ${e.pilot} Kart:${e.kart} Lap:${e.lastLap} Best:${e.bestLap}`)
  );
}

// Сесії за дату
const sessions = await fetch(`${BASE_URL}/db/sessions?date=2026-04-01`).then(r => r.json());

// Кола для сесії
const laps = await fetch(`${BASE_URL}/db/laps?session=${sessions[0].id}`).then(r => r.json());

// Змагання
const competitions = await fetch(`${BASE_URL}/competitions`).then(r => r.json());

// Постійне опитування (1 раз/сек)
setInterval(async () => {
  const { isOnline, entries } = await fetch(`${BASE_URL}/timing`).then(r => r.json());
  if (isOnline) console.log(`${entries.length} pilots on track`);
}, 1000);
```

### cURL

```bash
# Стан сервера
curl https://ekarting.duckdns.org/status

# Поточний таймінг
curl https://ekarting.duckdns.org/timing

# Поточний трек
curl https://ekarting.duckdns.org/track

# Сесії за дату
curl "https://ekarting.duckdns.org/db/sessions?date=2026-04-01"

# Кола для сесії
curl "https://ekarting.duckdns.org/db/laps?session=session-1710520000000"

# Кола для карту
curl "https://ekarting.duckdns.org/db/karts?kart=7&from=2026-03-01&to=2026-03-31"

# Події для реплея
curl "https://ekarting.duckdns.org/db/events?session=session-1710520000000"

# Змагання
curl https://ekarting.duckdns.org/competitions
curl "https://ekarting.duckdns.org/competitions?format=light_league"
curl https://ekarting.duckdns.org/competitions/ll-2026-03-18

# Scoring
curl https://ekarting.duckdns.org/scoring

# Статистика по картах
curl "https://ekarting.duckdns.org/db/kart-stats?from=2026-03-01&to=2026-03-31"
```
