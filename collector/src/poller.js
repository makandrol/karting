/**
 * TimingPoller — ядро collector'а
 *
 * Отримує дані напряму з JSON API таймінгу (nfs.playwar.com:3333).
 *
 * Розбивка на заїзди по raceNumber з API (а не по наявності пілотів).
 *
 * Адаптивний polling:
 * - Офлайн (API недоступний): 1 запит / 60 сек
 * - Idle (API доступний, немає пілотів): 1 запит / 10 сек
 * - Онлайн (є пілоти на трасі): 1 запит / 1 сек
 */

import { parseTimingJson, VOLATILE_TEAM_FIELDS, VOLATILE_META_FIELDS } from './parser.js';
import { storage } from './storage.js';

const TIMING_API_URL = 'http://nfs.playwar.com:3333/getmaininfo.json';
const POLL_INTERVAL_OFFLINE = 60_000;
const POLL_INTERVAL_IDLE = 10_000;
const POLL_INTERVAL_ONLINE = 1_000;
const SNAPSHOT_INTERVAL = 60_000;

export class TimingPoller {
  #online = false;
  #siteReachable = false;
  #siteReachableSince = null;
  #entries = [];
  #teams = [];
  #previousEntries = [];
  #previousTeams = [];
  #meta = null;
  #lastUpdate = null;
  #lastSnapshot = 0;
  #pollCount = 0;
  #errorCount = 0;
  #sessionId = null;
  #groupChecked = false;
  #currentRaceNumber = null;
  #sessions = [];
  #events = [];
  #eventsBySession = new Map();
  #timer = null;
  #cleanupTimer = null;

  onSessionStart = null;
  onSessionEnd = null;

  start() {
    console.log('🔄 Poller started');
    console.log(`   API: ${TIMING_API_URL}`);
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
  getCurrentEntries() { return this.#entries; }
  getCurrentTeams() { return this.#teams; }
  getMeta() { return this.#meta; }
  getLastUpdateTime() { return this.#lastUpdate; }
  getCurrentSessionId() { return this.#sessionId; }
  getSessions() { return this.#sessions; }

  #scheduleCleanup() {
    const doCleanup = () => {
      try {
        const deleted = storage.cleanupPolls(5);
        if (deleted > 0) console.log(`🧹 Cleaned up ${deleted} old poll_ok events`);
      } catch (err) {
        console.error('Cleanup error:', err.message);
      }
    };
    doCleanup();
    this.#cleanupTimer = setInterval(doCleanup, 6 * 60 * 60 * 1000);
  }

  getStatus() {
    return {
      online: this.#online,
      siteReachable: this.#siteReachable,
      siteReachableSince: this.#siteReachableSince,
      pollCount: this.#pollCount,
      errorCount: this.#errorCount,
      entriesCount: this.#entries.length,
      eventsCount: this.#events.length,
      sessionId: this.#sessionId,
      raceNumber: this.#currentRaceNumber,
      sessionsCount: this.#sessions.length,
      lastUpdate: this.#lastUpdate,
      pollInterval: this.#online ? POLL_INTERVAL_ONLINE : this.#siteReachable ? POLL_INTERVAL_IDLE : POLL_INTERVAL_OFFLINE,
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
      const response = await fetch(TIMING_API_URL, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      const result = parseTimingJson(json);

      if (!result) {
        throw new Error('Invalid JSON structure');
      }

      if (!this.#siteReachable) this.#siteReachableSince = Date.now();
      this.#siteReachable = true;
      this.#errorCount = 0;

      this.#meta = result.meta;
      this.#teams = result.teams;

      const newRaceNumber = result.meta.raceNumber;
      const raceChanged = newRaceNumber !== null
        && this.#currentRaceNumber !== null
        && newRaceNumber !== this.#currentRaceNumber;

      if (raceChanged) {
        this.#endCurrentSession(now);
      }

      this.#currentRaceNumber = newRaceNumber;

      if (result.entries.length > 0) {
        this.#goOnline(result.entries, result.teams, result.meta, now, result.raw);
      } else {
        this.#goOffline(now);
      }
    } catch (err) {
      this.#errorCount++;
      this.#siteReachable = false;
      this.#siteReachableSince = null;
      this.#goOffline(now);

      if (this.#errorCount <= 3 || this.#errorCount % 60 === 0) {
        console.log(`⚠️  Poll error (${this.#errorCount}): ${err.message}`);
      }
    }

    const interval = this.#online ? POLL_INTERVAL_ONLINE : this.#siteReachable ? POLL_INTERVAL_IDLE : POLL_INTERVAL_OFFLINE;
    this.#timer = setTimeout(() => this.#poll(), interval);
  }

  #goOnline(entries, teams, meta, now, raw) {
    const wasOffline = !this.#online;

    if (wasOffline) {
      console.log(`✅ Timing ONLINE — ${entries.length} pilots, race #${meta.raceNumber ?? '?'}`);
      this.#online = true;
      this.#sessionId = `session-${Date.now()}`;
      this.#groupChecked = false;
      this.#sessions.push({
        id: this.#sessionId,
        startTime: now,
        endTime: null,
        entryCount: entries.length,
        raceNumber: meta.raceNumber,
        isRace: meta.isRace,
        totalRaceTime: meta.totalRaceTime,
      });
      storage.createSession(this.#sessionId, now, entries.length, {
        trackId: storage.getCurrentTrackId(),
        raceNumber: meta.raceNumber,
        isRace: meta.isRace,
      });
      storage.autoLinkSessionToActiveCompetition(this.#sessionId);
      this.#addEvent('snapshot', { entries, teams, meta, raw }, now);
      this.#lastSnapshot = now;
      if (this.onSessionStart) this.onSessionStart(this.#sessionId, entries.length);
    }

    const changes = this.#diff(this.#previousTeams, teams, this.#previousEntries, entries, meta);

    if (changes.length > 0) {
      for (const change of changes) {
        this.#addEvent(change.type, change.data, now);
      }
      this.#lastUpdate = now;
    } else {
      this.#addEvent('poll_ok', null, now);
    }

    this.#previousEntries = entries;
    this.#previousTeams = teams;
    this.#entries = entries;
  }

  #endCurrentSession(now) {
    if (this.#online && this.#sessionId) {
      console.log(`🔄 Race number changed → closing session ${this.#sessionId}`);
      const session = this.#sessions.find(s => s.id === this.#sessionId);
      if (session) session.endTime = now;
      storage.endSession(this.#sessionId, now);
      this.#tryAutoUnlinkShortSession(this.#sessionId, session?.startTime, now);
      if (this.onSessionEnd) this.onSessionEnd(this.#sessionId);
      this.#online = false;
      this.#sessionId = null;
      this.#groupChecked = false;
      this.#entries = [];
      this.#previousEntries = [];
      this.#previousTeams = [];
    }
  }

  #goOffline(now) {
    if (this.#online) {
      console.log('🔴 Timing OFFLINE');
      this.#online = false;
      if (this.#sessionId) {
        const session = this.#sessions.find(s => s.id === this.#sessionId);
        if (session) session.endTime = now;
        storage.endSession(this.#sessionId, now);
        this.#tryAutoUnlinkShortSession(this.#sessionId, session?.startTime, now);
        if (this.onSessionEnd) this.onSessionEnd(this.#sessionId);
      }
      this.#entries = [];
      this.#previousEntries = [];
      this.#previousTeams = [];
    }
  }

  #tryAutoUnlinkShortSession(sessionId, startTime, endTime) {
    if (!sessionId || !startTime || !endTime) return;
    const durationMs = endTime - startTime;
    if (durationMs >= 60000) return;
    storage.autoUnlinkSession(sessionId);
  }

  #diff(prevTeams, currentTeams, prevEntries, currentEntries, meta) {
    const changes = [];

    for (let i = 0; i < currentTeams.length; i++) {
      const team = currentTeams[i];
      const entry = currentEntries[i];
      const pilotKey = team.pilotName || team.teamName || `Карт ${team.number}`;
      const prevTeam = prevTeams.find(p => (p.pilotName || p.teamName || `Карт ${p.number}`) === pilotKey);

      if (!prevTeam) {
        changes.push({ type: 'pilot_join', data: { pilot: pilotKey, kart: team.number || team.kart, team } });
        continue;
      }

      if (team.lapCount > prevTeam.lapCount) {
        changes.push({
          type: 'lap',
          data: {
            pilot: pilotKey,
            kart: team.number || team.kart,
            lapNumber: team.lapCount,
            lastLap: entry.lastLap,
            s1: entry.s1,
            s2: entry.s2,
            bestLap: entry.bestLap,
            position: entry.position,
            team,
            meta: { bestLapRace: meta.bestLapRace, bestS1Race: meta.bestS1Race, bestS2Race: meta.bestS2Race },
          },
        });
        continue;
      }

      if (entry.s1 !== prevEntries.find(p => p.pilot === pilotKey)?.s1 && team.lapCount === prevTeam.lapCount) {
        changes.push({
          type: 's1',
          data: { pilot: pilotKey, kart: team.number || team.kart, s1: entry.s1, team },
        });
      }

      let hasRealChange = false;
      for (const key of Object.keys(team)) {
        if (VOLATILE_TEAM_FIELDS.has(key)) continue;
        if (team[key] !== prevTeam[key]) {
          hasRealChange = true;
          break;
        }
      }
      if (hasRealChange) {
        changes.push({
          type: 'update',
          data: { pilot: pilotKey, kart: team.number || team.kart, team },
        });
      }
    }

    for (const prevTeam of prevTeams) {
      const pilotKey = prevTeam.pilotName || prevTeam.teamName || `Карт ${prevTeam.number}`;
      const found = currentTeams.find(t => (t.pilotName || t.teamName || `Карт ${t.number}`) === pilotKey);
      if (!found) {
        changes.push({ type: 'pilot_leave', data: { pilot: pilotKey } });
      }
    }

    return changes;
  }

  #addEvent(type, data, ts) {
    const event = { sessionId: this.#sessionId, type, ts, data };
    this.#events.push(event);

    if (this.#sessionId) {
      if (!this.#eventsBySession.has(this.#sessionId)) {
        this.#eventsBySession.set(this.#sessionId, []);
      }
      this.#eventsBySession.get(this.#sessionId).push(event);
    }

    if (this.#sessionId) {
      storage.addEvent(this.#sessionId, type, ts, data);
      if (type === 'lap' && data) {
        storage.addLap(this.#sessionId, { ...data, ts });
        if (!this.#groupChecked) {
          this.#groupChecked = true;
          storage.recheckSessionPhase(this.#sessionId);
        }
      }
    }

    if (this.#events.length > 100_000) {
      this.#events = this.#events.slice(-80_000);
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
