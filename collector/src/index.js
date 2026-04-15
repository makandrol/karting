/**
 * Karting Collector — сервер для збору даних з таймінгу
 *
 * Архітектура:
 * - Отримує дані з JSON API таймінгу (nfs.playwar.com:3333)
 * - Коли API недоступний: 1 запит / 60 секунд
 * - Коли API доступний, немає пілотів: 1 запит / 10 секунд
 * - Коли є пілоти на трасі: 1 запит / 1 секунда
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
const MAX_BODY_SIZE = 512 * 1024; // 512 KB (competitions can have large JSON results)
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
      const meta = poller.getMeta();
      sendJson(res, 200, {
        isOnline: poller.isOnline(),
        entries: poller.getCurrentEntries(),
        teams: poller.getCurrentTeams(),
        meta: meta,
        trackId: storage.getCurrentTrackId(),
        lastUpdate: poller.getLastUpdateTime(),
        sessionId: poller.getCurrentSessionId(),
        competition: detector.getState(),
      });
      return;
    }

    // GET /track — поточний трек
    if (req.method === 'GET' && url.pathname === '/track') {
      sendJson(res, 200, { trackId: storage.getCurrentTrackId() });
      return;
    }

    // POST /track — змінити трек (admin only)
    if (req.method === 'POST' && url.pathname === '/track') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      try {
        const body = await readBody(req);
        const { trackId } = JSON.parse(body);
        if (typeof trackId !== 'number' || trackId < 1 || trackId > 20) {
          sendJson(res, 400, { error: 'Invalid trackId' });
          return;
        }
        storage.setCurrentTrackId(trackId);
        sendJson(res, 200, { ok: true, trackId });
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
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

    // GET /db/collector-log?limit=200 — останні результати collector'а (admin only)
    if (url.pathname === '/db/collector-log') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 1000);
      const sessions = storage.getRecentSessions(limit);
      sendJson(res, 200, sessions);
      return;
    }

    // GET /db/session-counts?from=2026-03-15&to=2026-03-21
    if (url.pathname === '/db/session-counts') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to) { sendJson(res, 400, { error: 'from and to required' }); return; }
      sendJson(res, 200, storage.getSessionCounts(from, to));
      return;
    }

    // GET /db/kart-stats?from=2026-03-15&to=2026-03-21
    if (req.method === 'GET' && url.pathname === '/db/kart-stats') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!from || !to) { sendJson(res, 400, { error: 'from and to required' }); return; }
      sendJson(res, 200, storage.getKartStats(from, to));
      return;
    }

    // POST /db/kart-stats — stats for specific sessions
    if (req.method === 'POST' && url.pathname === '/db/kart-stats') {
      try {
        const body = await readBody(req);
        const { sessionIds } = JSON.parse(body);
        if (!Array.isArray(sessionIds)) { sendJson(res, 400, { error: 'sessionIds array required' }); return; }
        sendJson(res, 200, storage.getKartStatsBySessions(sessionIds));
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
      return;
    }

    // GET /db/kart-session-counts?kart=11 — session counts per date for a specific kart
    if (req.method === 'GET' && url.pathname === '/db/kart-session-counts') {
      const kart = url.searchParams.get('kart');
      if (!kart) { sendJson(res, 400, { error: 'kart required' }); return; }
      sendJson(res, 200, storage.getKartSessionCounts(parseInt(kart)));
      return;
    }

    // GET /db/laps?session=xxx — кола з БД
    if (req.method === 'GET' && url.pathname === '/db/laps') {
      const sessionId = url.searchParams.get('session');
      const kart = url.searchParams.get('kart');
      if (kart) {
        const from = url.searchParams.get('from') || '2020-01-01';
        const to = url.searchParams.get('to') || '2099-12-31';
        sendJson(res, 200, storage.getLapsByKart(parseInt(kart), from, to));
        return;
      }
      if (!sessionId) { sendJson(res, 400, { error: 'session or kart required' }); return; }
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

    // ============================================================
    // Competitions CRUD
    // ============================================================

    // GET /competitions — список змагань
    if (req.method === 'GET' && url.pathname === '/competitions') {
      const format = url.searchParams.get('format');
      sendJson(res, 200, storage.getCompetitions(format || undefined));
      return;
    }

    // GET /competitions/:id
    if (req.method === 'GET' && url.pathname.match(/^\/competitions\/[^/]+$/)) {
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      const comp = storage.getCompetition(id);
      if (!comp) { sendJson(res, 404, { error: 'Not found' }); return; }
      sendJson(res, 200, comp);
      return;
    }

    // POST /competitions — створити змагання (admin only)
    if (req.method === 'POST' && url.pathname === '/competitions') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        if (!data.id || !data.name) { sendJson(res, 400, { error: 'id and name required' }); return; }
        storage.createCompetition(data);
        sendJson(res, 201, storage.getCompetition(data.id));
      } catch (err) { sendJson(res, 400, { error: err.message || 'invalid json' }); }
      return;
    }

    // PATCH /competitions/:id — оновити змагання (admin only)
    if (req.method === 'PATCH' && url.pathname.match(/^\/competitions\/[^/]+$/)) {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      try {
        const body = await readBody(req);
        const fields = JSON.parse(body);
        const ok = storage.updateCompetition(id, fields);
        if (!ok) { sendJson(res, 404, { error: 'Not found' }); return; }
        sendJson(res, 200, storage.getCompetition(id));
      } catch (err) { sendJson(res, 400, { error: err.message || 'invalid json' }); }
      return;
    }

    // DELETE /competitions/:id — видалити змагання (admin only)
    if (req.method === 'DELETE' && url.pathname.match(/^\/competitions\/[^/]+$/)) {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      const ok = storage.deleteCompetition(id);
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Not found' });
      return;
    }

    // POST /competitions/:id/link-session — прив'язати заїзд до етапу (admin only)
    if (req.method === 'POST' && url.pathname.match(/^\/competitions\/[^/]+\/link-session$/)) {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      try {
        const body = await readBody(req);
        const { sessionId, phase } = JSON.parse(body);
        if (!sessionId) { sendJson(res, 400, { error: 'sessionId required' }); return; }
        const comp = storage.getCompetition(id);
        if (!comp) { sendJson(res, 404, { error: 'Competition not found' }); return; }
        const sessions = comp.sessions.filter(s => s.sessionId !== sessionId);
        sessions.push({ sessionId, phase: phase || null });
        storage.updateCompetition(id, { sessions });
        sendJson(res, 200, storage.getCompetition(id));
      } catch (err) { sendJson(res, 400, { error: err.message || 'invalid json' }); }
      return;
    }

    // POST /competitions/:id/update-track — оновити трасу для всіх сесій (admin only)
    if (req.method === 'POST' && url.pathname.match(/^\/competitions\/[^/]+\/update-track$/)) {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      try {
        const body = await readBody(req);
        const { trackId } = JSON.parse(body);
        if (typeof trackId !== 'number' || trackId < 1 || trackId > 20) {
          sendJson(res, 400, { error: 'Invalid trackId' });
          return;
        }
        const comp = storage.getCompetition(id);
        if (!comp) { sendJson(res, 404, { error: 'Competition not found' }); return; }
        const sessionIds = comp.sessions.map(s => s.sessionId);
        const changes = storage.updateSessionsTrack(sessionIds, trackId);
        sendJson(res, 200, { ok: true, changes });
      } catch (err) { sendJson(res, 400, { error: err.message || 'invalid json' }); }
      return;
    }

    // POST /competitions/:id/unlink-session — відв'язати заїзд (admin only)
    if (req.method === 'POST' && url.pathname.match(/^\/competitions\/[^/]+\/unlink-session$/)) {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      const id = decodeURIComponent(url.pathname.split('/')[2]);
      try {
        const body = await readBody(req);
        const { sessionId } = JSON.parse(body);
        if (!sessionId) { sendJson(res, 400, { error: 'sessionId required' }); return; }
        const comp = storage.getCompetition(id);
        if (!comp) { sendJson(res, 404, { error: 'Competition not found' }); return; }
        const sessions = comp.sessions.filter(s => s.sessionId !== sessionId);
        storage.updateCompetition(id, { sessions });
        sendJson(res, 200, storage.getCompetition(id));
      } catch (err) { sendJson(res, 400, { error: err.message || 'invalid json' }); }
      return;
    }

    // GET /db/session-competition?session=ID — отримати змагання для сесії
    if (req.method === 'GET' && url.pathname === '/db/session-competition') {
      const sessionId = url.searchParams.get('session');
      if (!sessionId) { sendJson(res, 400, { error: 'session required' }); return; }
      const comp = storage.getSessionCompetition(sessionId);
      sendJson(res, 200, comp || { competitionId: null });
      return;
    }

    // GET /scoring — отримати таблицю балів
    if (req.method === 'GET' && url.pathname === '/scoring') {
      const data = storage.getScoring();
      if (!data) { sendJson(res, 404, { error: 'Scoring not configured' }); return; }
      sendJson(res, 200, data);
      return;
    }

    // POST /scoring — зберегти таблицю балів (admin only)
    if (req.method === 'POST' && url.pathname === '/scoring') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        if (!data.positionPoints || !data.speedPoints || !data.overtakePoints) {
          sendJson(res, 400, { error: 'Invalid scoring format' });
          return;
        }
        storage.setScoring(data);
        sendJson(res, 200, { ok: true });
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
      return;
    }

    // GET /view-defaults — отримати дефолтні настройки таблиць
    if (req.method === 'GET' && url.pathname === '/view-defaults') {
      const data = storage.getViewDefaults();
      sendJson(res, 200, data || {});
      return;
    }

    // POST /view-defaults — зберегти дефолтні настройки таблиць (admin only)
    if (req.method === 'POST' && url.pathname === '/view-defaults') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        storage.setViewDefaults(data);
        sendJson(res, 200, { ok: true });
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
      return;
    }

    // GET /page-visibility — налаштування видимості сторінок
    if (req.method === 'GET' && url.pathname === '/page-visibility') {
      const data = storage.getPageVisibility();
      sendJson(res, 200, data || {});
      return;
    }

    // POST /page-visibility — зберегти видимість сторінок (admin only)
    if (req.method === 'POST' && url.pathname === '/page-visibility') {
      if (!isAuthorized(req)) { sendUnauthorized(res); return; }
      try {
        const body = await readBody(req);
        const data = JSON.parse(body);
        storage.setPageVisibility(data);
        sendJson(res, 200, { ok: true });
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
      return;
    }

    // POST /db/update-sessions-track — оновити трасу для сесій (admin only)
    if (req.method === 'POST' && url.pathname === '/db/update-sessions-track') {
      if (!isAuthorized(req)) { sendJson(res, 403, { error: 'Forbidden' }); return; }
      try {
        const { sessionIds, trackId } = JSON.parse(await readBody(req));
        if (!Array.isArray(sessionIds) || typeof trackId !== 'number') { sendJson(res, 400, { error: 'sessionIds and trackId required' }); return; }
        const changes = storage.updateSessionsTrack(sessionIds, trackId);
        sendJson(res, 200, { ok: true, changes });
      } catch { sendJson(res, 400, { error: 'invalid json' }); }
      return;
    }

    // POST /db/rename-pilot — перейменувати пілота в заїзді (admin only)
    if (req.method === 'POST' && url.pathname === '/db/rename-pilot') {
      if (!isAuthorized(req)) { sendJson(res, 403, { error: 'Forbidden' }); return; }
      const { sessionId, oldName, newName } = JSON.parse(await readBody(req));
      if (!sessionId || !oldName || !newName) { sendJson(res, 400, { error: 'sessionId, oldName, newName required' }); return; }
      const changes = storage.renamePilot(sessionId, oldName, newName);
      sendJson(res, 200, { ok: true, changes });
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
