/**
 * Karting Collector — сервер для збору даних з таймінгу
 *
 * Архітектура:
 * - Постійно опитує timing.karting.ua
 * - Коли таймінг офлайн: 1 запит / 60 секунд
 * - Коли таймінг онлайн: 1 запит / 1 секунда
 * - Зберігає тільки зміни (event log)
 * - Роздає дані через HTTP API для фронтенда
 *
 * Запуск: node src/index.js
 * Деплой: Fly.io (безкоштовний)
 */

import http from 'node:http';
import { TimingPoller } from './poller.js';

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const poller = new TimingPoller();

// ============================================================
// HTTP API
// ============================================================

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // GET /status — поточний стан collector'а
  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(poller.getStatus()));
    return;
  }

  // GET /timing — поточні дані таймінгу
  if (url.pathname === '/timing') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      isOnline: poller.isOnline(),
      entries: poller.getCurrentEntries(),
      lastUpdate: poller.getLastUpdateTime(),
      sessionId: poller.getCurrentSessionId(),
    }));
    return;
  }

  // GET /events?session=xxx&since=timestamp — event log для реплеїв
  if (url.pathname === '/events') {
    const sessionId = url.searchParams.get('session');
    const since = parseInt(url.searchParams.get('since') || '0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(poller.getEvents(sessionId, since)));
    return;
  }

  // GET /sessions — список сесій
  if (url.pathname === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(poller.getSessions()));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🏎️  Karting Collector running on port ${PORT}`);
  console.log(`   Status: http://localhost:${PORT}/status`);
  console.log(`   Timing: http://localhost:${PORT}/timing`);
  poller.start();
});
