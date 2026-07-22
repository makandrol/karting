#!/usr/bin/env bash
#
# Healthcheck watchdog для collector'а.
#
# Пінгає localhost:3001/healthz. Якщо сервер не відповідає (таймаут або не 200)
# ДВІЧІ поспіль (з паузою) — робить `pm2 restart collector`. Це зовнішній
# захист від зависання HTTP-сервера, яке PM2 сам не ловить (процес технічно
# лишається "online"). Дублює in-process watchdog у index.js як друга лінія.
#
# Запуск через cron щохвилини:
#   * * * * * /home/ubuntu/collector/scripts/healthcheck.sh >> /home/ubuntu/collector/healthcheck.log 2>&1

set -u

URL="http://localhost:3001/healthz"
TIMEOUT=8
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

check() {
  # -sf: тихо, fail на не-2xx; --max-time: жорсткий таймаут.
  curl -sf --max-time "$TIMEOUT" "$URL" >/dev/null 2>&1
}

if check; then
  exit 0
fi

# Перша спроба провалилась — коротка пауза й повтор (уникаємо рестарту на
# поодинокому тимчасовому лагу, напр. під час важкого запиту).
sleep 5

if check; then
  echo "$LOG_PREFIX healthz recovered on 2nd try (no restart)"
  exit 0
fi

echo "$LOG_PREFIX healthz FAILED twice — restarting collector via PM2"
pm2 restart collector >/dev/null 2>&1
echo "$LOG_PREFIX pm2 restart issued (exit=$?)"
