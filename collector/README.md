# Karting Collector

Сервер для постійного збору даних з таймінгу картодрому "Жага швидкості".

## Архітектура

```
timing.karting.ua ←── Collector (цей сервер) ──→ API для фронтенда
                         │
                         └──→ Supabase (майбутнє)
```

## Адаптивний polling

| Стан | Інтервал | Що робить |
|------|----------|-----------|
| Офлайн | 1 раз/хвилину | Перевіряє чи запрацював таймінг |
| Онлайн | 1 раз/секунду | Збирає дані, зберігає зміни |

## API

| Endpoint | Опис |
|----------|------|
| `GET /status` | Стан collector'а |
| `GET /timing` | Поточні дані таймінгу |
| `GET /events?session=xxx&since=ts` | Event log для реплеїв |
| `GET /sessions` | Список сесій |

## Локальний запуск

```bash
cd collector
npm install
npm run dev
```

## Деплой на Fly.io

```bash
# Встановити flyctl
brew install flyctl

# Логін
fly auth login

# Створити додаток
fly launch --name karting-collector

# Деплой
fly deploy
```

## Event типи

| Тип | Коли | Дані |
|-----|------|------|
| `snapshot` | Старт сесії + кожні 60 сек | Повний стан табла |
| `lap` | Пілот завершив коло | pilot, kart, lapNumber, lastLap, s1, s2 |
| `s1` | Пілот пройшов S1 | pilot, kart, s1 |
| `poll_ok` | Запит без змін | null (тільки timestamp) |
| `pilot_join` | Новий пілот на трасі | pilot, kart |
| `pilot_leave` | Пілот покинув трасу | pilot |
