import { describe, it, expect } from 'vitest';
import { parseCompetitionRow, mergeSessions, parseLapTimeSec, buildKartStats } from './storage-utils.js';

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

  it('limits to top 5 per kart', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      kart: 1, pilot: `P${i}`, lap_time: `${42 + i}.0`, lap_sec: 42 + i, ts: i,
    }));
    const result = buildKartStats(rows);
    expect(result[0].top5).toHaveLength(5);
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
});
