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
  storage._clearCaches();
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

  it('CL: 3-й заїзд лінкується як race_1_group_2 (із повного списку, без overlap)', () => {
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
    // Laps не потрібні — autoLink тепер не робить overlap-аналіз.
    const result = storage.autoLinkSessionToActiveCompetition('session-3000');
    // 3-а сесія → phases[2] у повному списку CL → race_1_group_2
    expect(result?.phase).toBe('race_1_group_2');
    // autoDetectedGroups не виставляється в autoLink — це робить finalizeSessionPhaseOnFirstLap
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

  it('Gonzales: 2-й заїзд лінкується як qualifying_2 (з повного списку, без overlap)', () => {
    insertSession('session-1000');
    insertSession('session-2000', { endTime: 2000 + 70_000 });
    makeCompetition({
      id: 'c1', format: 'gonzales',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
    });
    // autoLink не дивиться на laps — просто бере наступну фазу
    const result = storage.autoLinkSessionToActiveCompetition('session-2000');
    expect(result?.phase).toBe('qualifying_2');
    // autoDetectedGroups встановлюється в finalize, не в autoLink
  });
});

// ============================================================
// recomputeGonzalesRoundCount
// ============================================================

describe('storage.recomputeGonzalesRoundCount', () => {
  it('рахує MAX(12, пілотів) з квалі-сесій ("Карт N" як валідні пілоти)', () => {
    insertSession('session-1000');
    insertSession('session-2000');
    insertLaps('session-1000', { 'Іванов': 3, 'Петров': 3, 'Сидоров': 3 }); // 3 реальних
    insertLaps('session-2000', {
      'Карт 1': 3, 'Карт 2': 3, 'Карт 3': 3, 'Карт 4': 3, 'Карт 5': 3,
      'Карт 6': 3, 'Карт 7': 3, 'Карт 8': 3, 'Карт 9': 3, 'Карт 10': 3,
      'Карт 11': 3, 'Карт 12': 3, 'Карт 13': 3, 'Карт 14': 3, 'Карт 15': 3,
      'Карт 16': 3,
    }); // 16 "Карт N" — рахуються як пілоти
    makeCompetition({
      id: 'g1', format: 'gonzales',
      sessions: [
        { sessionId: 'session-1000', phase: 'qualifying_1' },
        { sessionId: 'session-2000', phase: 'qualifying_2' },
      ],
    });

    const comp = storage.getCompetition('g1');
    const rc = storage.recomputeGonzalesRoundCount(comp);
    expect(rc).toBe(19); // 3 + 16 = 19 distinct → MAX(12, 19) = 19
    expect(storage.getCompetition('g1').results.gonzalesRoundCount).toBe(19);
  });

  it('повертає 12 коли пілотів менше за 12', () => {
    insertSession('session-1000');
    insertLaps('session-1000', { 'A': 3, 'B': 3, 'C': 3, 'D': 3 });
    makeCompetition({
      id: 'g1', format: 'gonzales',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
    });
    const comp = storage.getCompetition('g1');
    expect(storage.recomputeGonzalesRoundCount(comp)).toBe(12);
  });

  it('не зменшує вже збережений roundCount', () => {
    insertSession('session-1000');
    insertLaps('session-1000', { 'A': 3, 'B': 3 });
    makeCompetition({
      id: 'g1', format: 'gonzales',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
      results: { gonzalesRoundCount: 18 },
    });
    const comp = storage.getCompetition('g1');
    expect(storage.recomputeGonzalesRoundCount(comp)).toBe(18);
    expect(storage.getCompetition('g1').results.gonzalesRoundCount).toBe(18);
  });

  it('ігнорує не-gonzales формати', () => {
    makeCompetition({ id: 'c1', format: 'light_league' });
    const comp = storage.getCompetition('c1');
    expect(storage.recomputeGonzalesRoundCount(comp)).toBe(null);
  });
});

// ============================================================
// gonzales auto-link: не блокується дефолтним roundCount=12
// ============================================================

describe('storage.autoLinkSessionToActiveCompetition (gonzales rounds)', () => {
  it('лінкує 13-й раунд коли пілотів >12 (roundCount перераховано)', () => {
    // 2 квали з 15 пілотами сумарно → roundCount має стати 15
    insertSession('session-100');
    insertSession('session-200');
    insertLaps('session-100', {
      'P1': 3, 'P2': 3, 'P3': 3, 'P4': 3, 'P5': 3, 'P6': 3, 'P7': 3, 'P8': 3,
    });
    insertLaps('session-200', {
      'P9': 3, 'P10': 3, 'P11': 3, 'P12': 3, 'P13': 3, 'P14': 3, 'P15': 3,
    });

    const sessions = [
      { sessionId: 'session-100', phase: 'qualifying_1' },
      { sessionId: 'session-200', phase: 'qualifying_2' },
    ];
    for (let r = 1; r <= 12; r++) sessions.push({ sessionId: `session-${1000 + r}`, phase: `round_${r}` });
    makeCompetition({ id: 'g1', format: 'gonzales', sessions });

    insertSession('session-1013'); // 13-й раунд
    const result = storage.autoLinkSessionToActiveCompetition('session-1013');
    expect(result?.phase).toBe('round_13');
    expect(storage.getCompetition('g1').results.gonzalesRoundCount).toBe(15);
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
  it('створює gonzales у понеділок ≥20:05 Kyiv', () => {
    const ts = kyivTs(2026, 6, 1, 20, 10); // Mon 20:10
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

  it('повертає null до 20:05 Kyiv (понеділок, Гонзалес)', () => {
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 1, 19, 0))).toBe(null);
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 1, 20, 4))).toBe(null);
  });

  it('повертає null у дні поза розкладом (Чт, Пт, Сб, Нд)', () => {
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 4, 20, 0))).toBe(null); // Thu
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 5, 20, 0))).toBe(null); // Fri
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 6, 20, 0))).toBe(null); // Sat
    expect(storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 7, 20, 0))).toBe(null); // Sun
  });

  it('повертає існуюче змагання якщо вже є того дня (idempotent)', () => {
    const ts = kyivTs(2026, 6, 1, 20, 10);
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

    const result = storage.autoStartCompetitionIfTime(kyivTs(2026, 6, 1, 20, 10));
    expect(result.id).toBe('gonzales-existing');
    expect(result.status).toBe('finished');
  });
});

describe('storage.autoLinkSessionToActiveCompetition (with auto-start)', () => {
  it('створює нове gonzales-змагання + лінкує першу сесію як qualifying_1 у понеділок', () => {
    const ts = kyivTs(2026, 6, 1, 20, 10);
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

// ============================================================
// remapKartNamesToPilots integration через storage.getLaps
// ============================================================

describe('storage.getLaps з ремапом "Карт N" → real names', () => {
  function insertRawLap(sessionId, pilot, kart, lapNumber, lapTime, ts) {
    storage.addLap(sessionId, {
      pilot, kart, lapNumber,
      lastLap: lapTime, s1: '20', s2: '22', bestLap: lapTime,
      position: 1, ts,
    });
  }

  it('перейменовує "Карт N" коли є real name на тому ж карті', () => {
    insertSession('session-1000');
    insertRawLap('session-1000', 'Карт 3', 3, 1, '42.0', 1000);
    insertRawLap('session-1000', 'Карт 3', 3, 2, '42.5', 2000);
    insertRawLap('session-1000', 'Шевченко', 3, 3, '41.8', 3000);

    const laps = storage.getLaps('session-1000');
    expect(laps).toHaveLength(3);
    expect(laps.every(l => l.pilot === 'Шевченко')).toBe(true);
  });

  it('лишає "Карт N" якщо нема real name', () => {
    insertSession('session-1000');
    insertRawLap('session-1000', 'Карт 5', 5, 1, '42.0', 1000);
    insertRawLap('session-1000', 'Карт 5', 5, 2, '42.5', 2000);

    const laps = storage.getLaps('session-1000');
    expect(laps.every(l => l.pilot === 'Карт 5')).toBe(true);
  });

  it('autoLink overlap-аналіз бачить правильні імена після ремапу', () => {
    insertSession('session-1000');
    insertSession('session-2000');

    // Перша квала: пілот починав як "Карт 3", далі — Іван
    insertRawLap('session-1000', 'Карт 3', 3, 1, '42.0', 1000);
    insertRawLap('session-1000', 'Іван', 3, 2, '41.5', 2000);

    // Друга сесія — той самий Іван (ім'я з самого початку)
    insertRawLap('session-2000', 'Іван', 3, 1, '41.0', 3000);
    insertRawLap('session-2000', 'Петро', 5, 1, '42.0', 3500);
    insertRawLap('session-2000', 'Сидор', 7, 1, '42.5', 4000);

    makeCompetition({
      id: 'c1', format: 'light_league',
      sessions: [{ sessionId: 'session-1000', phase: 'qualifying_1' }],
    });

    // Перевіряю, що cumulative pilots в overlap-аналізі — це {Іван} (а не {Карт 3, Іван})
    // Тоді overlap для session-2000 буде 1/3 = 33%, action='qualifying' → лінкується як qualifying_2
    const result = storage.autoLinkSessionToActiveCompetition('session-2000');
    expect(result?.phase).toBe('qualifying_2');
  });
});

// ============================================================
// detectGroupCountIfNeeded — окремий метод для детекції груп
// ============================================================

describe('storage.detectGroupCountIfNeeded', () => {
  function insertRawLap(sessionId, pilot, kart, lapNumber, lapTime, ts) {
    storage.addLap(sessionId, {
      pilot, kart, lapNumber,
      lastLap: lapTime, s1: '20', s2: '22', bestLap: lapTime,
      position: 1, ts,
    });
  }

  it('CL: 2 квалі + race з overlap 100% → встановлює autoDetectedGroups=2', () => {
    insertSession('session-q1', { startTime: 1000 });
    insertSession('session-q2', { startTime: 2000 });
    insertSession('session-r1', { startTime: 3000 });
    insertRawLap('session-q1', 'A', 1, 1, '42.0', 1000);
    insertRawLap('session-q1', 'B', 2, 1, '42.5', 2000);
    insertRawLap('session-q1', 'C', 3, 1, '42.5', 3000);
    insertRawLap('session-q2', 'X', 4, 1, '41.5', 4000);
    insertRawLap('session-q2', 'Y', 5, 1, '41.0', 5000);
    insertRawLap('session-q2', 'Z', 6, 1, '41.5', 6000);
    insertRawLap('session-r1', 'A', 1, 1, '42.0', 7000);
    insertRawLap('session-r1', 'B', 2, 1, '42.5', 8000);
    insertRawLap('session-r1', 'C', 3, 1, '42.5', 9000);

    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-q1', phase: 'qualifying_1' },
        { sessionId: 'session-q2', phase: 'qualifying_2' },
        { sessionId: 'session-r1', phase: 'race_1_group_2' },
      ],
    });

    const result = storage.detectGroupCountIfNeeded('session-r1');
    expect(result).toBe(2);
    const comp = storage.getCompetition('c1');
    expect(comp.results?.autoDetectedGroups).toBe(2);
  });

  it('повертає null коли autoDetectedGroups вже встановлений', () => {
    insertSession('session-q1', { startTime: 1000 });
    insertSession('session-r1', { startTime: 2000 });
    insertRawLap('session-q1', 'A', 1, 1, '42.0', 1000);
    insertRawLap('session-r1', 'A', 1, 1, '42.0', 2000);
    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-q1', phase: 'qualifying_1' },
        { sessionId: 'session-r1', phase: 'race_1_group_2' },
      ],
      results: { autoDetectedGroups: 1 },
    });

    expect(storage.detectGroupCountIfNeeded('session-r1')).toBe(null);
    expect(storage.getCompetition('c1').results.autoDetectedGroups).toBe(1);
  });

  it('повертає null коли немає quali-сесій', () => {
    insertSession('session-r1', { startTime: 1000 });
    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [{ sessionId: 'session-r1', phase: 'race_1_group_1' }],
    });
    expect(storage.detectGroupCountIfNeeded('session-r1')).toBe(null);
  });

  it('повертає null коли overlap <50% (це нова квала, не гонка)', () => {
    insertSession('session-q1', { startTime: 1000 });
    insertSession('session-q2', { startTime: 2000 });
    insertRawLap('session-q1', 'A', 1, 1, '42.0', 1000);
    insertRawLap('session-q1', 'B', 2, 1, '42.5', 2000);
    insertRawLap('session-q2', 'X', 3, 1, '41.5', 3000);
    insertRawLap('session-q2', 'Y', 4, 1, '41.0', 4000);
    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-q1', phase: 'qualifying_1' },
        { sessionId: 'session-q2', phase: 'qualifying_2' },
      ],
    });
    expect(storage.detectGroupCountIfNeeded('session-q2')).toBe(null);
    expect(storage.getCompetition('c1').results?.autoDetectedGroups).toBeUndefined();
  });

  it('Gonzales: реальні імена + якісь laps → інкрементує groupCount', () => {
    insertSession('session-100000', { startTime: 100000, endTime: 170000 });
    insertSession('session-200000', { startTime: 200000, endTime: 270000 });
    insertRawLap('session-100000', 'Іванов', 1, 1, '42.0', 100000);
    insertRawLap('session-200000', 'Петров', 2, 1, '42.5', 200000);
    makeCompetition({
      id: 'c1', format: 'gonzales',
      sessions: [
        { sessionId: 'session-100000', phase: 'qualifying_1' },
        { sessionId: 'session-200000', phase: 'qualifying_2' },
      ],
    });
    const result = storage.detectGroupCountIfNeeded('session-200000');
    // 1 quali existing + 1 new = 2 (capped)
    expect(result).toBe(2);
  });
});

// ============================================================
// recheckSessionPhase для race-фаз (новий сценарій)
// ============================================================

describe('storage.recheckSessionPhase для race-фаз', () => {
  function insertRawLap(sessionId, pilot, kart, lapNumber, lapTime, ts) {
    storage.addLap(sessionId, {
      pilot, kart, lapNumber,
      lastLap: lapTime, s1: '20', s2: '22', bestLap: lapTime,
      position: 1, ts,
    });
  }

  it('CL race_1_group_1 з overlap → реасайнить на race_1_group_2 (бо це перша race-сесія для groupCount=2)', () => {
    insertSession('session-q1', { startTime: 1000 });
    insertSession('session-q2', { startTime: 2000 });
    insertSession('session-r1', { startTime: 3000 });
    insertRawLap('session-q1', 'A', 1, 1, '42.0', 1000);
    insertRawLap('session-q1', 'B', 2, 1, '42.5', 2000);
    insertRawLap('session-q1', 'C', 3, 1, '42.5', 3000);
    insertRawLap('session-q2', 'X', 4, 1, '41.5', 4000);
    insertRawLap('session-q2', 'Y', 5, 1, '41.0', 5000);
    insertRawLap('session-q2', 'Z', 6, 1, '41.5', 6000);
    insertRawLap('session-r1', 'A', 1, 1, '42.0', 7000);
    insertRawLap('session-r1', 'B', 2, 1, '42.5', 8000);
    insertRawLap('session-r1', 'C', 3, 1, '42.5', 9000);

    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-q1', phase: 'qualifying_1' },
        { sessionId: 'session-q2', phase: 'qualifying_2' },
        { sessionId: 'session-r1', phase: 'race_1_group_1' },
      ],
    });

    storage.recheckSessionPhase('session-r1');

    const comp = storage.getCompetition('c1');
    const r1 = comp.sessions.find(s => s.sessionId === 'session-r1');
    expect(r1.phase).toBe('race_1_group_2');
    expect(comp.results?.autoDetectedGroups).toBe(2);
  });

  it('race-фаза що відповідає groupCount → не чіпає', () => {
    insertSession('session-q1', { startTime: 1000 });
    insertSession('session-r1', { startTime: 2000 });
    insertRawLap('session-q1', 'A', 1, 1, '42.0', 1000);
    insertRawLap('session-r1', 'A', 1, 1, '42.0', 2000);

    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-q1', phase: 'qualifying_1' },
        { sessionId: 'session-r1', phase: 'race_1_group_1' },
      ],
      results: { groupCountOverride: 1 },
    });

    storage.recheckSessionPhase('session-r1');

    const comp = storage.getCompetition('c1');
    expect(comp.sessions.find(s => s.sessionId === 'session-r1').phase).toBe('race_1_group_1');
  });

  it('race без quali-overlap → не чіпає (groupCount залишається null)', () => {
    insertSession('session-r1', { startTime: 1000 });
    insertRawLap('session-r1', 'A', 1, 1, '42.0', 1000);

    makeCompetition({
      id: 'c1', format: 'champions_league',
      sessions: [
        { sessionId: 'session-r1', phase: 'race_1_group_2' },
      ],
    });

    storage.recheckSessionPhase('session-r1');

    const comp = storage.getCompetition('c1');
    expect(comp.sessions.find(s => s.sessionId === 'session-r1').phase).toBe('race_1_group_2');
    expect(comp.results?.autoDetectedGroups).toBeUndefined();
  });
});
