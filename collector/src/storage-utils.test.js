import { describe, it, expect } from 'vitest';
import { parseCompetitionRow, mergeSessions, parseLapTimeSec, buildKartStats, remapKartNamesToPilots } from './storage-utils.js';

describe('parseLapTimeSec', () => {
  it('parses simple seconds', () => {
    expect(parseLapTimeSec('42.574')).toBe(42.574);
  });

  it('parses minutes:seconds', () => {
    expect(parseLapTimeSec('1:02.222')).toBeCloseTo(62.222, 3);
  });

  it('returns null for invalid', () => {
    expect(parseLapTimeSec(null)).toBe(null);
    expect(parseLapTimeSec('garbage')).toBe(null);
    expect(parseLapTimeSec('')).toBe(null);
  });
});

describe('parseCompetitionRow', () => {
  it('parses JSON fields', () => {
    const row = {
      id: 'c1',
      sessions: '[{"sessionId":"s1","phase":"qualifying_1"}]',
      results: '{"foo":"bar"}',
      uploaded_results: null,
      status: 'live',
    };
    const result = parseCompetitionRow(row);
    expect(result.sessions).toEqual([{ sessionId: 's1', phase: 'qualifying_1' }]);
    expect(result.results).toEqual({ foo: 'bar' });
  });

  it('migrates old format ["sessionId"] → [{sessionId, phase: null}]', () => {
    const row = {
      sessions: '["s1","s2"]',
      results: null,
      uploaded_results: null,
    };
    const result = parseCompetitionRow(row);
    expect(result.sessions).toEqual([
      { sessionId: 's1', phase: null },
      { sessionId: 's2', phase: null },
    ]);
  });

  it('defaults status to live', () => {
    const row = { sessions: '[]', results: null, uploaded_results: null, status: null };
    expect(parseCompetitionRow(row).status).toBe('live');
  });
});

describe('mergeSessions', () => {
  it('returns single session unchanged', () => {
    const session = { id: 's1', start_time: 1000, end_time: 2000, race_number: 1 };
    const result = mergeSessions([session]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(session);
  });

  it('merges sessions with same race_number within 5 minutes', () => {
    const sessions = [
      { id: 's1', start_time: 1000, end_time: 1000 + 60_000, race_number: 5, pilot_count: 5 },
      { id: 's2', start_time: 1000 + 90_000, end_time: 1000 + 200_000, race_number: 5, pilot_count: 6 },
    ];
    const result = mergeSessions(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
    expect(result[0].end_time).toBe(1000 + 200_000);
    expect(result[0].pilot_count).toBe(6); // max
    expect(result[0].merged_session_ids).toEqual(['s1', 's2']);
  });

  it('does not merge if gap > 5 minutes', () => {
    const sessions = [
      { id: 's1', start_time: 1000, end_time: 2000, race_number: 1 },
      { id: 's2', start_time: 2000 + 6 * 60_000, end_time: 3000 + 6 * 60_000, race_number: 1 },
    ];
    const result = mergeSessions(sessions);
    expect(result).toHaveLength(2);
  });

  it('does not merge sessions with null race_number', () => {
    const sessions = [
      { id: 's1', start_time: 1000, end_time: 2000, race_number: null },
      { id: 's2', start_time: 3000, end_time: 4000, race_number: null },
    ];
    const result = mergeSessions(sessions);
    expect(result).toHaveLength(2);
  });

  it('keeps best lap time when merging', () => {
    const sessions = [
      { id: 's1', start_time: 1000, end_time: 2000, race_number: 1, best_lap_time: '45.000', best_lap_pilot: 'A' },
      { id: 's2', start_time: 3000, end_time: 4000, race_number: 1, best_lap_time: '40.000', best_lap_pilot: 'B' },
    ];
    const result = mergeSessions(sessions);
    expect(result[0].best_lap_time).toBe('40.000');
    expect(result[0].best_lap_pilot).toBe('B');
  });
});

describe('buildKartStats', () => {
  it('groups laps by kart and pilot, picking best per pilot', () => {
    const rows = [
      { kart: 1, pilot: 'A', lap_time: '42.0', lap_sec: 42.0, ts: 100 },
      { kart: 1, pilot: 'A', lap_time: '41.0', lap_sec: 41.0, ts: 200 },
      { kart: 1, pilot: 'B', lap_time: '40.0', lap_sec: 40.0, ts: 300 },
      { kart: 2, pilot: 'A', lap_time: '43.0', lap_sec: 43.0, ts: 400 },
    ];
    const result = buildKartStats(rows);
    expect(result).toHaveLength(2);
    const kart1 = result.find(r => r.kart === 1);
    expect(kart1.top5).toHaveLength(2);
    expect(kart1.top5[0].pilot).toBe('B'); // 40.0 fastest
    expect(kart1.top5[0].lap_time).toBe('40.0');
    expect(kart1.top5[1].pilot).toBe('A'); // best is 41.0, not 42.0
    expect(kart1.top5[1].lap_time).toBe('41.0');
  });

  it('limits to top 10 per kart', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      kart: 1, pilot: `P${i}`, lap_time: `${42 + i}.0`, lap_sec: 42 + i, ts: i,
    }));
    const result = buildKartStats(rows);
    expect(result[0].top5).toHaveLength(10);
  });

  it('sorts result by kart number', () => {
    const rows = [
      { kart: 5, pilot: 'A', lap_time: '42.0', lap_sec: 42.0 },
      { kart: 1, pilot: 'A', lap_time: '42.0', lap_sec: 42.0 },
      { kart: 3, pilot: 'A', lap_time: '42.0', lap_sec: 42.0 },
    ];
    const result = buildKartStats(rows);
    expect(result.map(r => r.kart)).toEqual([1, 3, 5]);
  });

  it('computes theoretical best from best S1 + best S2 across laps', () => {
    const rows = [
      { kart: 1, pilot: 'A', lap_time: '42.0', lap_sec: 42.0, s1: '20.0', s2: '22.0', ts: 1 },
      { kart: 1, pilot: 'A', lap_time: '43.0', lap_sec: 43.0, s1: '19.5', s2: '23.5', ts: 2 },
    ];
    const result = buildKartStats(rows);
    const a = result[0].top5[0];
    // best lap = 42.0 with its sectors 20.0/22.0
    expect(a.lap_time).toBe('42.0');
    expect(a.s1).toBe('20.0');
    expect(a.s2).toBe('22.0');
    // TB = best S1 (19.5) + best S2 (22.0) = 41.5
    expect(a.tb_s1).toBe('19.5');
    expect(a.tb_s2).toBe('22.0');
    expect(a.tb_sec).toBeCloseTo(41.5, 3);
  });

  it('tb_sec is null when sectors missing', () => {
    const rows = [
      { kart: 1, pilot: 'A', lap_time: '42.0', lap_sec: 42.0, s1: null, s2: null, ts: 1 },
    ];
    const result = buildKartStats(rows);
    expect(result[0].top5[0].tb_sec).toBeNull();
  });

  it('пропускає глобально виключені кола (excludedLaps)', () => {
    const rows = [
      { session_id: 's1', kart: 1, pilot: 'A', lap_time: '40.0', lap_sec: 40.0, s1: '19.0', s2: '21.0', ts: 100 },
      { session_id: 's1', kart: 1, pilot: 'A', lap_time: '41.0', lap_sec: 41.0, s1: '19.5', s2: '21.5', ts: 200 },
    ];
    // Без виключень — best 40.0
    expect(buildKartStats(rows).find(r => r.kart === 1).top5[0].lap_time).toBe('40.0');
    // Виключаємо найшвидше коло (ts=100) → best стає 41.0
    const excluded = new Set(['s1|A|100']);
    const res = buildKartStats(rows, excluded);
    const a = res.find(r => r.kart === 1).top5[0];
    expect(a.lap_time).toBe('41.0');
    // TB рахується тільки з невиключених кіл: S1 19.5 + S2 21.5
    expect(a.tb_s1).toBe('19.5');
    expect(a.tb_s2).toBe('21.5');
  });
});

describe('remapKartNamesToPilots', () => {
  it('повертає вхід без змін якщо пусто', () => {
    expect(remapKartNamesToPilots([])).toEqual([]);
    expect(remapKartNamesToPilots(null)).toBe(null);
  });

  it('замінює "Карт N" на real name коли в групі рівно 1 real (через resolved_pilot)', () => {
    const laps = [
      { session_id: 's1', kart: 3, pilot: 'Карт 3', lap_time: '42.0' },
      { session_id: 's1', kart: 3, pilot: 'Карт 3', lap_time: '42.5' },
      { session_id: 's1', kart: 3, pilot: 'Шевченко Владислав', lap_time: '41.8' },
    ];
    const result = remapKartNamesToPilots(laps);
    // pilot лишається raw, resolved_pilot — реальне ім'я для "Карт N"
    expect(result.map(l => l.pilot)).toEqual(['Карт 3', 'Карт 3', 'Шевченко Владислав']);
    expect(result.map(l => l.resolved_pilot)).toEqual([
      'Шевченко Владислав', 'Шевченко Владислав', null,
    ]);
  });

  it('не мутує input', () => {
    const laps = [
      { session_id: 's1', kart: 3, pilot: 'Карт 3' },
      { session_id: 's1', kart: 3, pilot: 'Іван' },
    ];
    const original = JSON.parse(JSON.stringify(laps));
    remapKartNamesToPilots(laps);
    expect(laps).toEqual(original);
  });

  it('case-insensitive для "Карт" (resolved_pilot)', () => {
    const laps = [
      { session_id: 's1', kart: 5, pilot: 'карт 5' },
      { session_id: 's1', kart: 5, pilot: 'КАРТ 5' },
      { session_id: 's1', kart: 5, pilot: 'Іван' },
    ];
    const result = remapKartNamesToPilots(laps);
    expect(result[0].resolved_pilot).toBe('Іван');
    expect(result[1].resolved_pilot).toBe('Іван');
    expect(result[2].resolved_pilot).toBe(null);
  });

  it('лишає "Карт N" без resolved якщо нема real name на цьому карті', () => {
    const laps = [
      { session_id: 's1', kart: 5, pilot: 'Карт 5' },
      { session_id: 's1', kart: 5, pilot: 'Карт 5' },
    ];
    const result = remapKartNamesToPilots(laps);
    expect(result.every(l => l.pilot === 'Карт 5')).toBe(true);
    expect(result.every(l => l.resolved_pilot === null)).toBe(true);
  });

  it('лишає "Карт N" якщо є 2+ real names на одному карті (edge case 2 пілоти)', () => {
    const laps = [
      { session_id: 's1', kart: 3, pilot: 'Карт 3' },
      { session_id: 's1', kart: 3, pilot: 'Іван' },
      { session_id: 's1', kart: 3, pilot: 'Петро' },
    ];
    const result = remapKartNamesToPilots(laps);
    expect(result.map(l => l.pilot)).toEqual(['Карт 3', 'Іван', 'Петро']);
    expect(result.every(l => l.resolved_pilot === null)).toBe(true);
  });

  it('кожен карт резолвиться окремо в одній сесії', () => {
    const laps = [
      { session_id: 's1', kart: 3, pilot: 'Карт 3' },
      { session_id: 's1', kart: 3, pilot: 'Іван' },
      { session_id: 's1', kart: 5, pilot: 'Карт 5' },
      { session_id: 's1', kart: 5, pilot: 'Петро' },
    ];
    const result = remapKartNamesToPilots(laps);
    expect(result.map(l => l.resolved_pilot)).toEqual(['Іван', null, 'Петро', null]);
  });

  it('різні session_id з тим же kart — ізольовані', () => {
    const laps = [
      { session_id: 's1', kart: 3, pilot: 'Карт 3' },
      { session_id: 's1', kart: 3, pilot: 'Іван' },
      { session_id: 's2', kart: 3, pilot: 'Карт 3' },
      { session_id: 's2', kart: 3, pilot: 'Петро' },
    ];
    const result = remapKartNamesToPilots(laps);
    expect(result.map(l => `${l.session_id}|${l.resolved_pilot ?? l.pilot}`)).toEqual([
      's1|Іван', 's1|Іван', 's2|Петро', 's2|Петро',
    ]);
  });

  it('різні session_id ізольовані навіть якщо в одного є real, в іншого ні', () => {
    const laps = [
      { session_id: 's1', kart: 3, pilot: 'Карт 3' },
      { session_id: 's2', kart: 3, pilot: 'Карт 3' },
      { session_id: 's2', kart: 3, pilot: 'Іван' },
    ];
    const result = remapKartNamesToPilots(laps);
    // s1 → лишається "Карт 3" (нема real name); s2 → resolved "Іван"
    expect(result[0].resolved_pilot).toBe(null);
    expect(result[1].resolved_pilot).toBe('Іван');
    expect(result[2].resolved_pilot).toBe(null);
  });

  it('зберігає інші поля лапу (pilot raw + resolved_pilot)', () => {
    const laps = [
      { session_id: 's1', kart: 3, pilot: 'Карт 3', lap_time: '42.0', ts: 1000, lap_number: 1 },
      { session_id: 's1', kart: 3, pilot: 'Іван', lap_time: '41.5', ts: 1500, lap_number: 2 },
    ];
    const result = remapKartNamesToPilots(laps);
    expect(result[0]).toEqual({
      session_id: 's1', kart: 3, pilot: 'Карт 3', resolved_pilot: 'Іван', lap_time: '42.0', ts: 1000, lap_number: 1,
    });
  });

  it('працює без session_id (для laps з єдиної сесії)', () => {
    const laps = [
      { kart: 3, pilot: 'Карт 3' },
      { kart: 3, pilot: 'Іван' },
    ];
    const result = remapKartNamesToPilots(laps);
    expect(result[0].resolved_pilot).toBe('Іван');
    expect(result[1].resolved_pilot).toBe(null);
  });
});
