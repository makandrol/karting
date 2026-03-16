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
import os from 'node:os';
import { execSync } from 'node:child_process';
import { TimingPoller } from './poller.js';
import { storage } from './storage.js';
import { CompetitionDetector } from './detector.js';

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const poller = new TimingPoller();
const detector = new CompetitionDetector();

// Connect detector to poller events
poller.onSessionStart = (sessionId, pilotCount) => detector.onSessionStart(sessionId, pilotCount);
poller.onSessionEnd = (sessionId) => detector.onSessionEnd(sessionId);

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
      competition: detector.getState(),
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

  // GET /system — системні статистики сервера
  if (url.pathname === '/system') {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();
    const uptime = os.uptime();
    const processUptime = process.uptime();
    const processMemory = process.memoryUsage();

    let diskInfo = { total: 0, used: 0, free: 0 };
    try {
      const df = execSync("df -B1 / | tail -1").toString().trim().split(/\s+/);
      diskInfo = { total: parseInt(df[1]) || 0, used: parseInt(df[2]) || 0, free: parseInt(df[3]) || 0 };
    } catch {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.arch()}`,
      nodeVersion: process.version,
      serverUptime: uptime,
      processUptime: processUptime,
      cpu: {
        model: cpus[0]?.model || 'unknown',
        cores: cpus.length,
        loadAvg: os.loadavg(),
      },
      memory: {
        totalBytes: totalMem,
        usedBytes: usedMem,
        freeBytes: freeMem,
        usedPercent: Math.round((usedMem / totalMem) * 100),
        process: {
          rssBytes: processMemory.rss,
          heapUsedBytes: processMemory.heapUsed,
          heapTotalBytes: processMemory.heapTotal,
        },
      },
      disk: {
        totalBytes: diskInfo.total,
        usedBytes: diskInfo.used,
        freeBytes: diskInfo.free,
        usedPercent: diskInfo.total > 0 ? Math.round((diskInfo.used / diskInfo.total) * 100) : 0,
      },
      db: storage.getStats(),
    }));
    return;
  }

  // POST /analytics — отримати page view від фронтенду
  if (req.method === 'POST' && url.pathname === '/analytics') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        storage.trackPageView(data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400);
        res.end('{"error":"invalid json"}');
      }
    });
    return;
  }

  // GET /analytics — статистика відвідувань
  if (url.pathname === '/analytics') {
    const days = parseInt(url.searchParams.get('days') || '7');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(storage.getAnalytics(days)));
    return;
  }

  // GET /competition — стан змагання
  if (req.method === 'GET' && url.pathname === '/competition') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(detector.getState()));
    return;
  }

  // POST /competition/start — вручну запустити змагання
  if (req.method === 'POST' && url.pathname === '/competition/start') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { format, name } = JSON.parse(body);
        detector.manualStart(format, name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, state: detector.getState() }));
      } catch { res.writeHead(400); res.end('{"error":"invalid json"}'); }
    });
    return;
  }

  // POST /competition/stop — зупинити змагання
  if (req.method === 'POST' && url.pathname === '/competition/stop') {
    detector.manualStop();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /competition/phase — відмітити фазу
  if (req.method === 'POST' && url.pathname === '/competition/phase') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { sessionId, type, name } = JSON.parse(body);
        detector.markPhase(sessionId, type, name);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, state: detector.getState() }));
      } catch { res.writeHead(400); res.end('{"error":"invalid json"}'); }
    });
    return;
  }

  // POST /competition/reset — скинути автовизначення
  if (req.method === 'POST' && url.pathname === '/competition/reset') {
    detector.resetToday();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
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
