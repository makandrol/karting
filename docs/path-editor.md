# Path Editor — редактор треків

Окремий standalone інструмент для редагування SVG-шляхів треків. Vanilla HTML+JS, не пов'язаний з React-додатком.

**Файли:**
- `tools/path-editor.html` (601 LOC) — редактор UI + логіка
- `tools/server.cjs` (56 LOC) — мінімальний Node HTTP server для збереження `tracks.json`

**Дані пишуться у:** `public/tracks/tracks.json` — той самий файл, який React-додаток читає через `loadTracksJson()` у `src/data/tracks.ts`.

## Запуск

```bash
node tools/server.cjs
# → http://localhost:8778/tools/path-editor.html
```

Сервер слухає `:8778`, віддає статику з кореня репо і зберігає `POST /save-tracks` у `public/tracks/tracks.json`.

Альтернативно — можна відкрити `path-editor.html` напряму в браузері, але тоді кнопка "💾 Зберегти" не працюватиме (треба використати "📥 Завантажити JSON" і вручну покласти у `public/tracks/tracks.json`).

## Що редагується

Для кожного треку (1..11, та реверсні `1R..11R`):
- **svgPath** — SVG `d` атрибут лінії траси
- **timeMarkers** — точки на шляху з відомим часом (для побудови speed profile)
- **s1Point** — точка S1 сектора
- **gridPositions** — стартова решітка
- **pitPositions** — піт-позиції
- **referenceLapTime** — еталонне коло (за замовчуванням 42с)

## Режими роботи

Перемикаються кнопками вгорі:
- 🛤️ **Шлях** — клікай для додавання точок шляху, права кнопка для видалення, drag — перетягнути
- ⏱️ **Час** — клікай по існуючій точці шляху → ввід часу у секундах від старту кола
- 🔵 **S1** — позначити одну точку як S1 сектор
- 🏁 **Решітка** — додавання/перетягування grid positions
- 🔧 **Піти** — pit positions

## Формат `tracks.json`

```json
{
  "1": {
    "svgPath": "M100,200 Q...",
    "s1Point": { "x": 450, "y": 320 },
    "s1Time": 18.2,
    "gridPositions": [{ "x": 100, "y": 200 }, ...],
    "pitPositions": [{ "x": 50, "y": 300 }, ...],
    "speedProfile": [
      { "progress": 0.0, "time": 0.0 },
      { "progress": 0.25, "time": 11.5 },
      ...
    ],
    "referenceLapTime": 42
  },
  "1R": { ...reverse конфігурація... },
  "2": { ... }
}
```

`speedProfile` — нерівномірна швидкість на трасі для замості реалістичної анімації картів у `TrackMap`. Збирається з `timeMarkers` через інтерполяцію.

## Track ID convention

- `1..11` — основні конфігурації
- `1R..11R` — реверсні (зашиваються як `id + 100` у frontend `src/data/tracks.ts`, REVERSE_OFFSET=100)
- У `tracks.json` ключі — рядки `"1"`, `"1R"`, etc.

## Зображення треків

Editor шукає картинки за шляхом `../public/tracks/nfs_{NUM}.jpg` (відносно `tools/path-editor.html`). Зображення мають бути 1280×720.

## Інтеграція з React-додатком

`src/data/tracks.ts` → `loadTracksJson()` асинхронно завантажує `/tracks/tracks.json` (з public). Потім використовується у:
- `TrackMap` (анімація кружечків пілотів за speedProfile)
- `Onboard` (S1 timing reference)
- Інші місця, що потребують `getTrackById(id)`

## Коли НЕ використовуй editor

- Не редагуй `tracks.json` руками — використовуй editor (легко зламати JSON)
- Не змінюй `referenceLapTime` всередині editor якщо не оновлюєш одночасно `timeMarkers` (вони пов'язані)
- Не плутай реверсні з основними — це різні svg paths (часто реверс — це той самий path але з інверсним напрямком руху + інший grid)

## Робота агента з editor

Агенту НЕ треба запускати editor чи редагувати tracks.json напряму без явного прохання. Це інструмент для людини. Якщо користувач просить — запропонуй запустити локально:

```bash
node tools/server.cjs
```

Якщо просять змінити `tracks.json` через скрипт — виконай через `node` маленьким скриптом, валідуй JSON перед записом.
