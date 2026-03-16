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
import { storage } from './storage.js';

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

  // GET /status
  if (url.pathname === '/status') {
    const dbStats = storage.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...poller.getStatus(), db: dbStats }));
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

  // GET /db/sessions?date=2025-03-15 — сесії з БД
  if (url.pathname === '/db/sessions') {
    const date = url.searchParams.get('date');
    const sessions = date ? storage.getSessionsByDate(date) : storage.getSessions(100);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return;
  }

  // GET /db/laps?session=xxx — кола з БД
  if (url.pathname === '/db/laps') {
    const sessionId = url.searchParams.get('session');
    if (!sessionId) { res.writeHead(400); res.end('{"error":"session required"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(storage.getLaps(sessionId)));
    return;
  }

  // GET /db/events?session=xxx&since=ts — події з БД
  if (url.pathname === '/db/events') {
    const sessionId = url.searchParams.get('session');
    const since = parseInt(url.searchParams.get('since') || '0');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(storage.getEvents(sessionId, since)));
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
