/**
 * Integration tests for storage.js — autoLinkSessionToActiveCompetition,
 * recheckSessionPhase, autoUnlinkSession.
 *
 * Використовує реальний `better-sqlite3` через дефолтний DB_PATH у storage.js.
 * Перед кожним тестом таблиці очищуються — це швидше за створення in-memory
 * instance і не потребує зміни production-коду.
 *
 * Файл DB лишається в `collector/data/karting.db` (gitignored). Якщо тести
 * запускаються паралельно з реальним collector PM2 на dev-машині — можуть
 * бути race conditions; за замовчуванням collector живе на VPS, тому ОК.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from './storage.js';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'karting.db');
const db = new Database(DB_PATH);

function clean() {
  db.exec(`
    DELETE FROM competitions;
    DELETE FROM laps;
    DELETE FROM events;
    DELETE FROM sessions;
  `);
}

function insertSession(id, opts = {}) {
  const startTime = opts.startTime ?? parseInt(id.replace('session-', ''));
  storage.createSession(id, startTime, opts.pilotCount ?? 5, {
    trackId: opts.trackId ?? 1,
    raceNumber: opts.raceNumber ?? null,
    isRace: opts.isRace ?? 0,
  });
  if (opts.endTime) storage.endSession(id, opts.endTime);
}

function insertLaps(sessionId, pilotsLapCounts) {
  // pilotsLapCounts: { 'PilotA': 3, 'PilotB': 4 } — adds N laps per pilot, all valid
  let lapNum = 1;
  for (const [pilot, count] of Object.entries(pilotsLapCounts)) {
    for (let i = 0; i < count; i++) {
      storage.addLap(sessionId, {
        pilot, kart: 1, lapNumber: lapNum++,
        lastLap: '42.500', s1: '20.5', s2: '22.0', bestLap: '42.500',
        position: 1, ts: Date.now(),
      });
    }
  }
}

function makeCompetition({ id, format, sessions = [], results = null, status = 'live' }) {
  storage.createCompetition({
    id,
    name: `Test ${id}`,
    format,
    date: '2026-06-01',
    sessions,
    results,
    status,
  });
}

beforeEach(() => {
  clean();
});

// ============================================================
// autoLinkSessionToActiveCompetition
// ============================================================

describe('storage.autoLinkSessionToActiveCompetition', () => {
  it('повертає null коли немає live competition', () => {
    insertSession('session-1000');
    expect(storage.autoLinkSessionToActiveCompetition('session-1000')).toBe(null);
  });

  it('лінкує перший заїзд як qualifying_1 для LL', () => {
    makeCompetition({ id: 'c1', format: 'light_league' });
    insertSession('session-1000');
    const result = storage.autoLinkSessionToActiveCompetition('session-1000');
    expect(result).toEqual({ competitionId: 'c1', phase: 'qualifying_1' });

    const comp = storage.getCompetition('c1');
    expect(comp.sessions).toEqual([{ sessionId: 'session-1000', phase: 'qualifying_1' }]);
  });

  it('лінкує другий заїзд як qualifying_2', () => {
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
    });
    insertSession('session-2000');
    const result = storage.autoLinkSessionToActiveCompetition('session-2000');
    expect(result?.phase).toBe('qualifying_2');
  });

  it('CL: 3-й заїзд (квала) лінкується як qualifying_2 (бо MAX=2 не блочить)', () => {
    insertSession('session-1000');
    insertSession('session-2000');
    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
    });
    insertLaps('session-1000', { A: 3, B: 3 });
    insertLaps('session-2000', { X: 3, Y: 3 }); // distinct → quali 2

    const result = storage.autoLinkSessionToActiveCompetition('session-2000');
    expect(result?.phase).toBe('qualifying_2');
  });

  it('CL: 3-й заїзд з тими ж пілотами (overlap >50%) → лінкується як race_1_group_2', () => {
    insertSession('session-1000');
    insertSession('session-2000');
    insertSession('session-3000');
    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'qualifying_2' },
      ],
    });
    insertLaps('session-1000', { A: 3, B: 3, C: 3 });
    insertLaps('session-2000', { A: 3, B: 3, D: 3 });
    insertLaps('session-3000', { A: 3, B: 3, C: 3 }); // overlap 100%

    const result = storage.autoLinkSessionToActiveCompetition('session-3000');
    expect(result?.phase).toBe('race_1_group_2');

    const comp = storage.getCompetition('c1');
    expect(comp.results.autoDetectedGroups).toBe(2);
  });

  it('Sprint: 4-й заїзд лінкується як qualifying_1_group_3 (без overlap-detection)', () => {
    makeCompetition({
      id: 'c1', format: 'sprint',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1_group_1' },
        { sessionId: 'session-2000', phase: 'qualifying_1_group_2' },
      ],
    });
    insertSession('session-3000');
    const result = storage.autoLinkSessionToActiveCompetition('session-3000');
    expect(result?.phase).toBe('qualifying_1_group_3');
  });

  it('GUARD: коли всі фази заповнені, повертає null', () => {
    // CL with 1 group: phases = [q1, r1g1, r2g1, r3g1] = 4 phases
    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'race_1_group_1' },
        { sessionId: 'session-3000', phase: 'race_2_group_1' },
        { sessionId: 'session-4000', phase: 'race_3_group_1' },
      ],
      results: { groupCountOverride: 1 },
    });
    insertSession('session-5000');
    const result = storage.autoLinkSessionToActiveCompetition('session-5000');
    expect(result).toBe(null);
  });

  it('повертає null коли competition статус finished', () => {
    makeCompetition({ id: 'c1', format: 'light_league', status: 'finished' });
    insertSession('session-1000');
    expect(storage.autoLinkSessionToActiveCompetition('session-1000')).toBe(null);
  });

  it('Gonzales: real names → інкрементує groupCount', () => {
    insertSession('session-1000');
    insertSession('session-2000', { endTime: 2000 + 70_000 });
    makeCompetition({
      id: 'c1', format: 'gonzales',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
    });
    insertLaps('session-1000', { Іванов: 2, Петров: 2 });
    insertLaps('session-2000', { Сидоров: 2, Шевченко: 2 });

    const result = storage.autoLinkSessionToActiveCompetition('session-2000');
    expect(result?.phase).toBe('qualifying_2');
    const comp = storage.getCompetition('c1');
    expect(comp.results.autoDetectedGroups).toBe(2);
  });
});

// ============================================================
// recheckSessionPhase
// ============================================================

describe('storage.recheckSessionPhase', () => {
  it('перепризначає quali → race коли overlap ≥50%', () => {
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'qualifying_2' }, // буде reassigned
      ],
    });
    insertSession('session-1000');
    insertSession('session-2000');
    insertLaps('session-1000', { A: 3, B: 3, C: 3 });
    insertLaps('session-2000', { A: 3, B: 3, C: 3 }); // 100% overlap

    storage.recheckSessionPhase('session-2000');

    const comp = storage.getCompetition('c1');
    const entry = comp.sessions.find(s => s.sessionId === 'session-2000');
    expect(entry.phase).toBe('race_1_group_1');
  });

  it('НЕ перепризначає коли overlap <50%', () => {
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'qualifying_2' },
      ],
    });
    insertSession('session-1000');
    insertSession('session-2000');
    insertLaps('session-1000', { A: 3, B: 3 });
    insertLaps('session-2000', { X: 3, Y: 3, Z: 3 }); // 0% overlap

    storage.recheckSessionPhase('session-2000');

    const comp = storage.getCompetition('c1');
    const entry = comp.sessions.find(s => s.sessionId === 'session-2000');
    expect(entry.phase).toBe('qualifying_2');
  });

  it('не чіпає race-фази (тільки quali перевіряє)', () => {
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'race_1_group_1' },
      ],
    });
    insertSession('session-1000');
    insertSession('session-2000');
    insertLaps('session-2000', { A: 3, B: 3, C: 3 });

    storage.recheckSessionPhase('session-2000');

    const comp = storage.getCompetition('c1');
    const entry = comp.sessions.find(s => s.sessionId === 'session-2000');
    expect(entry.phase).toBe('race_1_group_1');
  });

  it('повертається без помилок коли немає мінімум 3 пілотів', () => {
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'qualifying_2' },
      ],
    });
    insertSession('session-1000');
    insertSession('session-2000');
    insertLaps('session-1000', { A: 3, B: 3 });
    insertLaps('session-2000', { A: 3 }); // лише 1 пілот

    expect(() => storage.recheckSessionPhase('session-2000')).not.toThrow();

    const comp = storage.getCompetition('c1');
    expect(comp.sessions.find(s => s.sessionId === 'session-2000').phase).toBe('qualifying_2');
  });

  it('finished competition не чіпається', () => {
    makeCompetition({
      id: 'c1', format: 'light_league', status: 'finished',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'qualifying_2' },
      ],
    });
    insertSession('session-1000');
    insertSession('session-2000');
    insertLaps('session-1000', { A: 3, B: 3, C: 3 });
    insertLaps('session-2000', { A: 3, B: 3, C: 3 });

    storage.recheckSessionPhase('session-2000');

    const comp = storage.getCompetition('c1');
    expect(comp.sessions.find(s => s.sessionId === 'session-2000').phase).toBe('qualifying_2');
  });
});

// ============================================================
// autoUnlinkSession
// ============================================================

describe('storage.autoUnlinkSession', () => {
  it('видаляє сесію з масиву sessions[]', () => {
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'qualifying_2' },
      ],
    });

    const result = storage.autoUnlinkSession('session-1000');
    expect(result).toBe(true);

    const comp = storage.getCompetition('c1');
    expect(comp.sessions).toEqual([{ sessionId: 'session-2000', phase: 'qualifying_2' }]);
  });

  it('повертає false коли сесія не залінкована до жодного змагання', () => {
    makeCompetition({ id: 'c1', format: 'light_league' });
    expect(storage.autoUnlinkSession('session-9999')).toBe(false);
  });
});
