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
 */

import http from 'node:http';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TimingPoller } from './poller.js';
import { storage } from './storage.js';
import { CompetitionDetector } from './detector.js';

const execFileAsync = promisify(execFile);

const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_BODY_SIZE = 16 * 1024; // 16 KB
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const poller = new TimingPoller();
const detector = new CompetitionDetector();

// Connect detector to poller events
poller.onSessionStart = (sessionId, pilotCount) => detector.onSessionStart(sessionId, pilotCount);
poller.onSessionEnd = (sessionId) => detector.onSessionEnd(sessionId);

// ============================================================
// Helpers
// ============================================================

function readBody(req, maxSize = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function isAuthorized(req) {
  if (!ADMIN_TOKEN) return true;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendUnauthorized(res) {
  sendJson(res, 401, { error: 'Unauthorized' });
}

// ============================================================
// HTTP API
// ============================================================

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  try {
    // GET /healthz — health check
    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true, uptime: process.uptime() });
      return;
    }

    // GET /status
    if (url.pathname === '/status') {
      const dbStats = storage.getStats();
      sendJson(res, 200, { ...poller.getStatus(), db: dbStats });
      return;
    }

    // GET /timing — поточні дані таймінгу
    if (url.pathname === '/timing') {
      sendJson(res, 200, {
        isOnline: poller.isOnline(),
        entries: poller.getCurrentEntries(),
        lastUpdate: poller.getLastUpdateTime(),
        sessionId: poller.getCurrentSessionId(),
        competition: detector.getState(),
      });
      return;
    }

    // GET /events?session=xxx&since=timestamp — event log для реплеїв
    if (url.pathname === '/events') {
      const sessionId = url.searchParams.get('session');
      const since = parseInt(url.searchParams.get('since') || '0');
      sendJson(res, 200, poller.getEvents(sessionId, since));
      return;
    }

    // GET /sessions — список сесій
    if (url.pathname === '/sessions') {
      sendJson(res, 200, poller.getSessions());
      return;
    }

    // GET /db/sessions?date=2025-03-15 — сесії з БД
    if (url.pathname === '/db/sessions') {
      const date = url.searchParams.get('date');
      const sessions = date ? storage.getSessionsByDate(date) : storage.getSessions(100);
      sendJson(res, 200, sessions);
      return;
    }

    // GET /db/laps?session=xxx — кола з БД
    if (url.pathname === '/db/laps') {
      const sessionId = url.searchParams.get('session');
      if (!sessionId) { sendJson(res, 400, { error: 'session required' }); return; }
      sendJson(res, 200, storage.getLaps(sessionId));
      return;
    }

    // GET /db/events?session=xxx&since=ts — події з БД
    if (url.pathname === '/db/events') {
      const sessionId = url.searchParams.get('session');
      const since = parseInt(url.searchParams.get('since') || '0');
      sendJson(res, 200, storage.getEvents(sessionId, since));
      return;
    }

    // GET /system — системні статистики сервера (admin only)
    if (url.pathname === '/system') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const cpus = os.cpus();
      const uptime = os.uptime();
      const processUptime = process.uptime();
      const processMemory = process.memoryUsage();

      let diskInfo = { total: 0, used: 0, free: 0 };
      try {
        const { stdout } = await execFileAsync('df', ['-B1', '/']);
        const line = stdout.trim().split('\n').pop()?.split(/\s+/) || [];
        diskInfo = { total: parseInt(line[1]) || 0, used: parseInt(line[2]) || 0, free: parseInt(line[3]) || 0 };
      } catch {}

      sendJson(res, 200, {
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
      });
      return;
    }

    // POST /analytics — отримати page view від фронтенду
    if (req.method === 'POST' && url.pathname === '/analytics') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        storage.trackPageView(data);
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 400, { error: 'invalid json or body too large' });
      }
      return;
    }

    // GET /analytics — статистика відвідувань (admin only)
    if (url.pathname === '/analytics') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      const days = parseInt(url.searchParams.get('days') || '7');
      sendJson(res, 200, storage.getAnalytics(days));
      return;
    }

    // GET /competition — стан змагання
    if (req.method === 'GET' && url.pathname === '/competition') {
      sendJson(res, 200, detector.getState());
      return;
    }

    // POST /competition/start — вручну запустити змагання (admin only)
    if (req.method === 'POST' && url.pathname === '/competition/start') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      try {
        const body = await readBody(req);
        const { format, name } = JSON.parse(body);
        detector.manualStart(format, name);
        sendJson(res, 200, { ok: true, state: detector.getState() });
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
      return;
    }

    // POST /competition/stop — зупинити змагання (admin only)
    if (req.method === 'POST' && url.pathname === '/competition/stop') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      detector.manualStop();
      sendJson(res, 200, { ok: true });
      return;
    }

    // POST /competition/phase — відмітити фазу (admin only)
    if (req.method === 'POST' && url.pathname === '/competition/phase') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      try {
        const body = await readBody(req);
        const { sessionId, type, name } = JSON.parse(body);
        detector.markPhase(sessionId, type, name);
        sendJson(res, 200, { ok: true, state: detector.getState() });
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
      return;
    }

    // POST /competition/reset — скинути автовизначення (admin only)
    if (req.method === 'POST' && url.pathname === '/competition/reset') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      detector.resetToday();
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Request error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`🏎️  Karting Collector running on port ${PORT}`);
  console.log(`   Status: http://localhost:${PORT}/status`);
  console.log(`   Timing: http://localhost:${PORT}/timing`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  poller.start();
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully`);
  poller.stop();
  storage.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
