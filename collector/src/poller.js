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

const TIMING_URL = 'https://timing.karting.ua/board.html';
const POLL_INTERVAL_OFFLINE = 60_000;  // 1 хвилина
const POLL_INTERVAL_ONLINE = 1_000;    // 1 секунда
const SNAPSHOT_INTERVAL = 60_000;       // зберігати повний стан кожні 60 сек

export class TimingPoller {
  #online = false;
  #entries = [];           // поточні дані з табла
  #previousEntries = [];   // попередні (для diffing)
  #lastUpdate = null;
  #lastSnapshot = 0;
  #pollCount = 0;
  #errorCount = 0;
  #sessionId = null;
  #sessions = [];          // [{id, startTime, endTime, entryCount}]
  #events = [];            // event log (in-memory, потім → DB)
  #timer = null;

  start() {
    console.log('🔄 Poller started');
    this.#poll();
  }

  stop() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    console.log('⏹ Poller stopped');
  }

  isOnline() { return this.#online; }
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
    return this.#events.filter(e =>
      (!sessionId || e.sessionId === sessionId) && e.ts >= since
    );
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
      // Start new session
      this.#sessionId = `session-${Date.now()}`;
      this.#sessions.push({
        id: this.#sessionId,
        startTime: now,
        endTime: null,
        entryCount: entries.length,
      });
      // First snapshot
      this.#addEvent('snapshot', { entries }, now);
      this.#lastSnapshot = now;
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
      // End session
      if (this.#sessionId) {
        const session = this.#sessions.find(s => s.id === this.#sessionId);
        if (session) session.endTime = now;
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
    this.#events.push({
      sessionId: this.#sessionId,
      type,
      ts,
      data,
    });

    // Keep max 100K events in memory (oldest removed)
    if (this.#events.length > 100_000) {
      this.#events = this.#events.slice(-80_000);
    }
  }
}
