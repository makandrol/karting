# 🏎️ Karting Collector API

Сервер для збору даних з таймінгу картодрому "Жага швидкості".

**Base URL:** `http://150.230.157.143:3001`

CORS увімкнений — можна запитувати з будь-якого домену, браузера чи програми. Авторизація не потрібна.

---

## Як працює

Collector сервер постійно опитує табло [timing.karting.ua](https://timing.karting.ua/board.html):
- Коли таймінг **офлайн** → запит кожні 60 секунд
- Коли таймінг **онлайн** → запит кожну 1 секунду
- Зберігає поточний стан і лог змін в пам'яті
- Віддає кешовані дані через HTTP API

---

## Ендпоінти

### 1. `GET /status` — Стан сервера

Повертає поточний стан collector'а. Використовуйте для перевірки чи працює сервер і чи доступний таймінг.

**Запит:**
```
GET http://150.230.157.143:3001/status
```

**Відповідь:**
```json
{
  "online": false,
  "pollCount": 752,
  "errorCount": 752,
  "entriesCount": 0,
  "eventsCount": 0,
  "sessionId": null,
  "sessionsCount": 0,
  "lastUpdate": null,
  "pollInterval": 60000
}
```

| Поле | Тип | Опис |
|------|-----|------|
| `online` | boolean | `true` = картодром працює, дані є. `false` = офлайн |
| `pollCount` | number | Загальна к-сть запитів до таймінгу з моменту старту сервера |
| `errorCount` | number | К-сть невдалих запитів |
| `entriesCount` | number | К-сть пілотів на трасі прямо зараз |
| `eventsCount` | number | К-сть подій збережених в пам'яті |
| `sessionId` | string \| null | ID поточного заїзду. `null` = немає активного заїзду |
| `sessionsCount` | number | К-сть заїздів з моменту старту сервера |
| `lastUpdate` | number \| null | Unix timestamp (мілісекунди) останньої зміни на таблі |
| `pollInterval` | number | Поточний інтервал опитування в мс (60000 = офлайн, 1000 = онлайн) |

---

### 2. `GET /timing` — Поточні дані таймінгу

Повертає поточне табло — те саме що показується на timing.karting.ua, але в JSON форматі.

**Запит:**
```
GET http://150.230.157.143:3001/timing
```

**Відповідь коли таймінг працює:**
```json
{
  "isOnline": true,
  "lastUpdate": 1710523456789,
  "sessionId": "session-1710520000000",
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
    },
    {
      "position": 2,
      "pilot": "Джасім Салєх",
      "kart": 3,
      "lastLap": "41.156",
      "s1": "13.567",
      "s2": "27.589",
      "bestLap": "40.890",
      "lapNumber": 11
    }
  ]
}
```

**Відповідь коли таймінг офлайн:**
```json
{
  "isOnline": false,
  "lastUpdate": null,
  "sessionId": null,
  "entries": []
}
```

#### Поля `entries[]`:

| Поле | Тип | Опис |
|------|-----|------|
| `position` | number | Позиція на таблі (1 = лідер) |
| `pilot` | string | Ім'я пілота (як на таблі) |
| `kart` | number | Номер карту |
| `lastLap` | string \| null | Час останнього завершеного кола. Формат: `"40.823"` (секунди) або `"1:02.345"` (хвилини:секунди). `null` якщо ще не проїхав жодного кола |
| `s1` | string \| null | Час сектора 1 в секундах: `"13.245"`. Оновлюється коли пілот проїжджає середину кола |
| `s2` | string \| null | Час сектора 2 в секундах: `"27.578"`. Оновлюється коли пілот перетинає фініш |
| `bestLap` | string \| null | Найкращий час кола пілота в поточному заїзді |
| `lapNumber` | number | Номер поточного кола (починається з 1) |

---

### 3. `GET /events` — Лог подій

Повертає детальний лог подій. Корисно для відтворення заїзду (replay) або аналітики.

**Запити:**
```
GET http://150.230.157.143:3001/events
GET http://150.230.157.143:3001/events?session=session-1710520000000
GET http://150.230.157.143:3001/events?since=1710523400000
GET http://150.230.157.143:3001/events?session=session-123&since=1710523400000
```

| Параметр | Тип | Обов'язковий | Опис |
|----------|-----|-------------|------|
| `session` | string | ні | Фільтр по ID заїзду |
| `since` | number | ні | Тільки події після цього timestamp (unix ms) |

**Відповідь:**
```json
[
  {
    "sessionId": "session-1710520000000",
    "type": "snapshot",
    "ts": 1710520000000,
    "data": {
      "entries": [
        { "position": 1, "pilot": "Апанасенко Олексій", "kart": 7, ... }
      ]
    }
  },
  {
    "sessionId": "session-1710520000000",
    "type": "lap",
    "ts": 1710520042000,
    "data": {
      "pilot": "Апанасенко Олексій",
      "kart": 7,
      "lapNumber": 5,
      "lastLap": "40.823",
      "s1": "13.245",
      "s2": "27.578",
      "bestLap": "40.123",
      "position": 1
    }
  },
  {
    "sessionId": "session-1710520000000",
    "type": "s1",
    "ts": 1710520055000,
    "data": {
      "pilot": "Джасім Салєх",
      "kart": 3,
      "s1": "13.890"
    }
  },
  {
    "sessionId": "session-1710520000000",
    "type": "poll_ok",
    "ts": 1710520056000,
    "data": null
  }
]
```

#### Типи подій:

| Тип | Коли виникає | Дані (`data`) |
|-----|-------------|---------------|
| `snapshot` | Початок заїзду + кожні 60 сек | `{ entries: [...] }` — повний стан табла |
| `lap` | Пілот завершив коло (перетнув фініш) | `pilot, kart, lapNumber, lastLap, s1, s2, bestLap, position` |
| `s1` | Пілот пройшов сектор 1 (середина кола) | `pilot, kart, s1` |
| `poll_ok` | Запит до таймінгу без змін | `null` (тільки timestamp) |
| `pilot_join` | Новий пілот з'явився на трасі | `pilot, kart` |
| `pilot_leave` | Пілот покинув трасу | `pilot` |

---

### 4. `GET /sessions` — Список заїздів

Повертає список всіх заїздів з моменту старту сервера.

**Запит:**
```
GET http://150.230.157.143:3001/sessions
```

**Відповідь:**
```json
[
  {
    "id": "session-1710520000000",
    "startTime": 1710520000000,
    "endTime": 1710521200000,
    "entryCount": 8
  },
  {
    "id": "session-1710525600000",
    "startTime": 1710525600000,
    "endTime": null,
    "entryCount": 12
  }
]
```

| Поле | Тип | Опис |
|------|-----|------|
| `id` | string | Унікальний ID заїзду |
| `startTime` | number | Unix timestamp (ms) початку заїзду |
| `endTime` | number \| null | Unix timestamp (ms) кінця. `null` = ще йде |
| `entryCount` | number | К-сть пілотів в заїзді |

---

## Приклади

### Python

```python
import requests
import time

BASE_URL = "http://150.230.157.143:3001"

# Перевірити стан
status = requests.get(f"{BASE_URL}/status").json()
print(f"Online: {status['online']}, Polls: {status['pollCount']}")

# Постійне опитування таймінгу
while True:
    data = requests.get(f"{BASE_URL}/timing").json()
    
    if data["isOnline"]:
        print(f"\n--- {len(data['entries'])} pilots ---")
        for e in data["entries"]:
            print(f"  P{e['position']} | {e['pilot']:25s} | "
                  f"Kart {e['kart']:2d} | "
                  f"Lap: {e['lastLap'] or '---':>8s} | "
                  f"Best: {e['bestLap'] or '---':>8s} | "
                  f"#{e['lapNumber']}")
    else:
        print("Timing offline, waiting...")
    
    time.sleep(1)
```

### JavaScript / Node.js

```javascript
const BASE_URL = "http://150.230.157.143:3001";

// Одноразовий запит
const res = await fetch(`${BASE_URL}/timing`);
const data = await res.json();

if (data.isOnline) {
  data.entries.forEach(e => {
    console.log(`P${e.position} ${e.pilot} Kart:${e.kart} Lap:${e.lastLap} Best:${e.bestLap}`);
  });
}

// Постійне опитування
setInterval(async () => {
  const res = await fetch(`${BASE_URL}/timing`);
  const { isOnline, entries } = await res.json();
  
  if (isOnline) {
    console.log(`${entries.length} pilots on track`);
  }
}, 1000);
```

### cURL

```bash
# Стан сервера
curl http://150.230.157.143:3001/status

# Поточний таймінг
curl http://150.230.157.143:3001/timing

# Список заїздів
curl http://150.230.157.143:3001/sessions

# Події конкретного заїзду
curl "http://150.230.157.143:3001/events?session=session-123456"
```

---

## Важливі деталі

1. **Час** — всі timestamps в Unix мілісекундах (13 цифр, наприклад `1710523456789`)
2. **Час кіл** — строка в секундах (`"40.823"`) або хвилинах (`"1:02.345"`)
3. **Оновлення** — дані кешуються на сервері, запити до API не спричиняють додаткових запитів до таймінгу
4. **CORS** — дозволено з будь-якого домену
5. **Rate limiting** — немає (але не зловживайте, рекомендовано ≤ 5 req/sec)
6. **Uptime** — сервер працює 24/7 на Oracle Cloud, перезапускається автоматично
