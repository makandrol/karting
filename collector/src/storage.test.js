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

// ============================================================
// autoStartCompetitionIfTime
// ============================================================

// Helper: timestamp at Kyiv local time
function kyivTs(year, month, day, hour = 0, minute = 0) {
  return Date.UTC(year, month - 1, day, hour - 3, minute);
}

describe('storage.autoStartCompetitionIfTime', () => {
  it('створює gonzales у понеділок ≥19:30 Kyiv', () => {
    const ts = kyivTs(2026, 6, 1, 20, 0); // Mon 20:00
    const created = storage.autoStartCompetitionIfTime(ts);
    expect(created).not.toBeNull();
    expect(created.format).toBe('gonzales');
    expect(created.status).toBe('live');
    expect(created.date).toBe('2026-06-01');
    expect(created.name).toMatch(/^Гонз, 01\.06\.26, Тр\. \d+$/);
  });

  it('створює light_league у вівторок', () => {
    const created = storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 2, 19, 45));
    expect(created.format).toBe('light_league');
  });

  it('створює champions_league у середу', () => {
    const created = storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 3, 20, 30));
    expect(created.format).toBe('champions_league');
  });

  it('повертає null до 19:30 Kyiv', () => {
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 1, 19, 0))).toBe(null);
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 1, 19, 29))).toBe(null);
  });

  it('повертає null у дні поза розкладом (Чт, Пт, Сб, Нд)', () => {
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 4, 20, 0))).toBe(null); // Thu
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 5, 20, 0))).toBe(null); // Fri
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 6, 20, 0))).toBe(null); // Sat
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 7, 20, 0))).toBe(null); // Sun
  });

  it('повертає існуюче змагання якщо вже є того дня (idempotent)', () => {
    const ts = kyivTs(2026, 6, 1, 20, 0);
    const a = storage.autoStartCompetitionIfTime(ts);
    const b = storage.autoStartCompetitionIfTime(ts);
    expect(b.id).toBe(a.id);
  });

  it('не створює нове якщо є finished змагання того ж формату й дня', () => {
    makeCompetition({
      id: 'gonzales-existing',
      format: 'gonzales',
      status: 'finished',
    });
    // Hack: вручну виставляю date через update
    storage.updateCompetition('gonzales-existing', { date: '2026-06-01' });

    const result = storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 1, 20, 0));
    expect(result.id).toBe('gonzales-existing');
    expect(result.status).toBe('finished');
  });
});

describe('storage.autoLinkSessionToActiveCompetition (with auto-start)', () => {
  it('створює нове gonzales-змагання + лінкує першу сесію як qualifying_1 у понеділок', () => {
    const ts = kyivTs(2026, 6, 1, 20, 0);
    const sessionId = `session-${ts}`;
    insertSession(sessionId, { startTime: ts });

    const result = storage.autoLinkSessionToActiveCompetition(sessionId);
    expect(result).not.toBeNull();
    expect(result.phase).toBe('qualifying_1');

    const comp = storage.getCompetition(result.competitionId);
    expect(comp.format).toBe('gonzales');
    expect(comp.status).toBe('live');
  });

  it('у час поза розкладом — не створює і повертає null', () => {
    const ts = kyivTs(2026, 6, 4, 20, 0); // Thursday
    insertSession(`session-${ts}`, { startTime: ts });
    expect(storage.autoLinkSessionToActiveCompetition(`session-${ts}`)).toBe(null);
  });
});

// ============================================================
// autoFinishCompletedCompetitions
// ============================================================

describe('storage.autoFinishCompletedCompetitions', () => {
  it('закриває LL коли всі phases linked + всі сесії ended', () => {
    // LL з 1 групою має 3 фази: qualifying_1, race_1_group_1, race_2_group_1
    const t0 = 100_000_000_000;
    insertSession('session-1000', { startTime: t0,        endTime: t0 + 60_000 });
    insertSession('session-2000', { startTime: t0 + 70_000, endTime: t0 + 130_000 });
    insertSession('session-3000', { startTime: t0 + 140_000, endTime: t0 + 200_000 });
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'race_1_group_1' },
        { sessionId: 'session-3000', phase: 'race_2_group_1' },
      ],
      results: { groupCountOverride: 1 },
    });

    const finishedIds = storage.autoFinishCompletedCompetitions(t0 + 1_000_000);
    expect(finishedIds).toContain('c1');
    expect(storage.getCompetition('c1').status).toBe('finished');
  });

  it('НЕ закриває коли є сесія без end_time', () => {
    insertSession('session-1000', { startTime: 1000, endTime: 60_000 });
    insertSession('session-2000', { startTime: 70_000 }); // active
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'race_1_group_1' },
      ],
      results: { groupCountOverride: 1 },
    });

    const finishedIds = storage.autoFinishCompletedCompetitions(Date.now());
    expect(finishedIds).toEqual([]);
    expect(storage.getCompetition('c1').status).toBe('live');
  });

  it('НЕ закриває коли last session ended нещодавно і phases incomplete', () => {
    const t0 = Date.now() - 5 * 60 * 1000; // 5 min ago
    insertSession('session-1000', { startTime: t0, endTime: t0 + 60_000 });
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
      results: { groupCountOverride: 1 }, // expects 3 phases, has 1
    });

    expect(storage.autoFinishCompletedCompetitions(Date.now())).toEqual([]);
    expect(storage.getCompetition('c1').status).toBe('live');
  });

  it('закриває по timeout — last session ended >60 хв тому', () => {
    const t0 = 1_000_000_000;
    insertSession('session-1000', { startTime: t0, endTime: t0 + 60_000 });
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
      results: { groupCountOverride: 2 }, // 6 phases, has 1 — phases incomplete
    });

    const now = t0 + 60_000 + 70 * 60 * 1000; // 70 min after last end
    expect(storage.autoFinishCompletedCompetitions(now)).toContain('c1');
    expect(storage.getCompetition('c1').status).toBe('finished');
  });

  it('Gonzales закривається ТІЛЬКИ по timeout (phases-check skipped)', () => {
    const t0 = 1_000_000_000;
    // 14 sessions (qualifying_1 + 12 round_*_group_1 + 1 extra) — phases-check сказав би "complete" для Gonzales з 1 групою
    // Але для Gonzales ми скіпаємо phase-check — закриваємо тільки по timeout.
    insertSession('session-g1', { startTime: t0, endTime: t0 + 60_000 });
    makeCompetition({
      id: 'g1', format: 'gonzales',
      sessions: [{ sessionId: 'session-g1', phase: 'qualifying_1' }],
    });

    // Без timeout — НЕ закривається навіть якщо phases-check спрацював би
    expect(storage.autoFinishCompletedCompetitions(t0 + 60_000 + 30 * 60 * 1000)).toEqual([]);
    // З timeout — закривається
    expect(storage.autoFinishCompletedCompetitions(t0 + 60_000 + 70 * 60 * 1000)).toContain('g1');
  });

  it('idempotent — повторний виклик не реагує', () => {
    const t0 = 1_000_000_000;
    insertSession('session-1000', { startTime: t0, endTime: t0 + 60_000 });
    insertSession('session-2000', { startTime: t0 + 70_000, endTime: t0 + 130_000 });
    insertSession('session-3000', { startTime: t0 + 140_000, endTime: t0 + 200_000 });
    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'race_1_group_1' },
        { sessionId: 'session-3000', phase: 'race_2_group_1' },
      ],
      results: { groupCountOverride: 1 },
    });

    const now = t0 + 1_000_000;
    expect(storage.autoFinishCompletedCompetitions(now)).toContain('c1');
    expect(storage.autoFinishCompletedCompetitions(now)).toEqual([]);
  });

  it('пропускає змагання без сесій', () => {
    makeCompetition({ id: 'empty', format: 'light_league' });
    expect(storage.autoFinishCompletedCompetitions(Date.now())).toEqual([]);
    expect(storage.getCompetition('empty').status).toBe('live');
  });
});
