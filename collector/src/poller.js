/**
 * TimingPoller — ядро collector'а
 *
 * Адаптивний polling:
 * - Офлайн: 1 запит / 60 сек
 * - Онлайн: 1 запит / 1 сек
 *
 * Зберігає event log:
 * - SNAPSHOT: повний стан (при першому запиті і кожні 60 сек)
 * - LAP: пілот завершив коло
 * - S1: пілот пройшов S1
 * - POLL_OK: запит без змін (тільки timestamp)
 */

import { parseTimingHtml } from './parser.js';
import { storage } from './storage.js';

const TIMING_URL = 'https://timing.karting.ua/board.html';
const POLL_INTERVAL_OFFLINE = 60_000;  // 1 хвилина
const POLL_INTERVAL_ONLINE = 1_000;    // 1 секунда
const SNAPSHOT_INTERVAL = 60_000;       // зберігати повний стан кожні 60 сек

export class TimingPoller {
  #online = false;
  #entries = [];
  #previousEntries = [];
  #lastUpdate = null;
  #lastSnapshot = 0;
  #pollCount = 0;
  #errorCount = 0;
  #sessionId = null;
  #sessions = [];
  #events = [];
  #eventsBySession = new Map();
  #timer = null;
  #cleanupTimer = null;

  /** Callback: викликається при старті сесії */
  onSessionStart = null;
  /** Callback: викликається при завершенні сесії */
  onSessionEnd = null;

  start() {
    console.log('🔄 Poller started');
    this.#poll();
    this.#scheduleCleanup();
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#cleanupTimer) clearInterval(this.#cleanupTimer);
    this.#cleanupTimer = null;
    console.log('⏹ Poller stopped');
  }

  isOnline() { return this.#online; }

  #scheduleCleanup() {
    const doCleanup = () => {
      try {
        const deleted = storage.cleanupPolls(10);
        if (deleted > 0) console.log(`🧹 Cleaned up ${deleted} old poll_ok events`);
      } catch (err) {
        console.error('Cleanup error:', err.message);
      }
    };
    doCleanup();
    this.#cleanupTimer = setInterval(doCleanup, 6 * 60 * 60 * 1000); // every 6 hours
  }
  getCurrentEntries() { return this.#entries; }
  getLastUpdateTime() { return this.#lastUpdate; }
  getCurrentSessionId() { return this.#sessionId; }
  getSessions() { return this.#sessions; }

  getStatus() {
    return {
      online: this.#online,
      pollCount: this.#pollCount,
      errorCount: this.#errorCount,
      entriesCount: this.#entries.length,
      eventsCount: this.#events.length,
      sessionId: this.#sessionId,
      sessionsCount: this.#sessions.length,
      lastUpdate: this.#lastUpdate,
      pollInterval: this.#online ? POLL_INTERVAL_ONLINE : POLL_INTERVAL_OFFLINE,
    };
  }

  getEvents(sessionId, since = 0) {
    if (sessionId) {
      const sessionEvents = this.#eventsBySession.get(sessionId) || [];
      return since > 0 ? sessionEvents.filter(e => e.ts >= since) : sessionEvents;
    }
    return this.#events.filter(e => e.ts >= since);
  }

  async #poll() {
    this.#pollCount++;
    const now = Date.now();

    try {
      const response = await fetch(TIMING_URL, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const entries = parseTimingHtml(html);

      if (!entries || entries.length === 0) {
        // Таймінг доступний але порожній (немає сесії)
        this.#goOffline(now);
      } else {
        // Таймінг працює!
        this.#goOnline(entries, now);
      }

      this.#errorCount = 0;
    } catch (err) {
      this.#errorCount++;
      this.#goOffline(now);

      if (this.#errorCount <= 3 || this.#errorCount % 60 === 0) {
        console.log(`⚠️  Poll error (${this.#errorCount}): ${err.message}`);
      }
    }

    // Schedule next poll
    const interval = this.#online ? POLL_INTERVAL_ONLINE : POLL_INTERVAL_OFFLINE;
    this.#timer = setTimeout(() => this.#poll(), interval);
  }

  #goOnline(entries, now) {
    const wasOffline = !this.#online;

    if (wasOffline) {
      console.log(`✅ Timing ONLINE — ${entries.length} pilots`);
      this.#online = true;
      this.#sessionId = `session-${Date.now()}`;
      this.#sessions.push({
        id: this.#sessionId,
        startTime: now,
        endTime: null,
        entryCount: entries.length,
      });
      // Save to DB
      storage.createSession(this.#sessionId, now, entries.length);
      this.#addEvent('snapshot', { entries }, now);
      this.#lastSnapshot = now;
      // Notify detector
      if (this.onSessionStart) this.onSessionStart(this.#sessionId, entries.length);
    }

    // Diff with previous
    const changes = this.#diff(this.#previousEntries, entries);

    if (changes.length > 0) {
      for (const change of changes) {
        this.#addEvent(change.type, change.data, now);
      }
      this.#lastUpdate = now;
    } else {
      // No changes — just record poll
      this.#addEvent('poll_ok', null, now);
    }

    // Periodic snapshot
    if (now - this.#lastSnapshot >= SNAPSHOT_INTERVAL) {
      this.#addEvent('snapshot', { entries }, now);
      this.#lastSnapshot = now;
    }

    this.#previousEntries = entries;
    this.#entries = entries;
  }

  #goOffline(now) {
    if (this.#online) {
      console.log('🔴 Timing OFFLINE');
      this.#online = false;
      if (this.#sessionId) {
        const session = this.#sessions.find(s => s.id === this.#sessionId);
        if (session) session.endTime = now;
        storage.endSession(this.#sessionId, now);
        if (this.onSessionEnd) this.onSessionEnd(this.#sessionId);
      }
      this.#entries = [];
      this.#previousEntries = [];
    }
  }

  /**
   * Порівнює попередній і поточний стан, повертає список змін.
   */
  #diff(prev, current) {
    const changes = [];

    for (const entry of current) {
      const prevEntry = prev.find(p => p.pilot === entry.pilot);

      if (!prevEntry) {
        // Новий пілот
        changes.push({ type: 'pilot_join', data: { pilot: entry.pilot, kart: entry.kart } });
        continue;
      }

      // Нове коло (lapNumber збільшився)
      if (entry.lapNumber > prevEntry.lapNumber) {
        changes.push({
          type: 'lap',
          data: {
            pilot: entry.pilot,
            kart: entry.kart,
            lapNumber: entry.lapNumber,
            lastLap: entry.lastLap,
            s1: entry.s1,
            s2: entry.s2,
            bestLap: entry.bestLap,
            position: entry.position,
          },
        });
      }

      // S1 змінився (пілот пройшов S1 на поточному колі)
      if (entry.s1 !== prevEntry.s1 && entry.lapNumber === prevEntry.lapNumber) {
        changes.push({
          type: 's1',
          data: {
            pilot: entry.pilot,
            kart: entry.kart,
            s1: entry.s1,
          },
        });
      }
    }

    // Пілот покинув трасу
    for (const prevEntry of prev) {
      if (!current.find(c => c.pilot === prevEntry.pilot)) {
        changes.push({ type: 'pilot_leave', data: { pilot: prevEntry.pilot } });
      }
    }

    return changes;
  }

  #addEvent(type, data, ts) {
    const event = {
      sessionId: this.#sessionId,
      type,
      ts,
      data,
    };
    this.#events.push(event);

    if (this.#sessionId) {
      if (!this.#eventsBySession.has(this.#sessionId)) {
        this.#eventsBySession.set(this.#sessionId, []);
      }
      this.#eventsBySession.get(this.#sessionId).push(event);
    }

    // Write to SQLite
    if (this.#sessionId) {
      storage.addEvent(this.#sessionId, type, ts, data);

      if (type === 'lap' && data) {
        storage.addLap(this.#sessionId, { ...data, ts });
      }
    }

    // Keep max 100K events in memory
    if (this.#events.length > 100_000) {
      this.#events = this.#events.slice(-80_000);
      // Rebuild index from remaining events
      this.#eventsBySession.clear();
      for (const e of this.#events) {
        if (e.sessionId) {
          if (!this.#eventsBySession.has(e.sessionId)) {
            this.#eventsBySession.set(e.sessionId, []);
          }
          this.#eventsBySession.get(e.sessionId).push(e);
        }
      }
    }
  }
}
