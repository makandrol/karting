import { describe, it, expect } from 'vitest';
import {
  parseLapSec,
  getOvertakeRate,
  calcOvertakePoints,
  getPositionPoints,
  getSprintPositionPoints,
  getSprintFinalPoints,
  byTimeThenTs,
  byLapsThenTs,
  computeStandings,
  type ScoringData,
  type SessionLap,
} from './scoring';

const mockScoring: ScoringData = {
  positionPoints: [
    {
      label: 'few',
      minPilots: 1, maxPilots: 12,
      groups: { '1': [10, 8, 6, 4, 3, 2, 1, 1, 1, 1, 1, 1] },
    },
    {
      label: 'medium',
      minPilots: 13, maxPilots: 26,
      groups: {
        '1': [12, 10, 8, 6, 5, 4, 3, 2, 1, 1, 1, 1],
        '2': [6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1],
      },
    },
  ],
  positionPoints_CL: [
    {
      label: 'few',
      minPilots: 1, maxPilots: 12,
      groups: { '1': [15, 12, 10, 8, 6, 5, 4, 3, 2, 1, 1, 1] },
    },
  ],
  overtakePoints: {
    groupI_LL: [
      { startPosMin: 1, startPosMax: 3, perOvertake: 0.5 },
      { startPosMin: 4, startPosMax: 6, perOvertake: 0.8 },
      { startPosMin: 7, startPosMax: 9, perOvertake: 1.0 },
      { startPosMin: 10, startPosMax: 99, perOvertake: 1.2 },
    ],
    groupI_CL: [
      { startPosMin: 1, startPosMax: 3, perOvertake: 0.6 },
      { startPosMin: 4, startPosMax: 6, perOvertake: 0.9 },
      { startPosMin: 7, startPosMax: 99, perOvertake: 1.3 },
    ],
    groupII: 0.5,
    groupIII: 0.3,
  },
  speedPoints: [2.5, 2.0, 1.5, 1.0, 0.5],
};

// ============================================================
// parseLapSec
// ============================================================

describe('parseLapSec', () => {
  it('parses simple seconds format', () => {
    expect(parseLapSec('42.574')).toBe(42.574);
    expect(parseLapSec('39.800')).toBe(39.8);
  });

  it('parses minutes:seconds format', () => {
    expect(parseLapSec('1:02.222')).toBeCloseTo(62.222, 3);
    expect(parseLapSec('2:30.000')).toBeCloseTo(150.0, 3);
  });

  it('returns null for invalid input', () => {
    expect(parseLapSec(null)).toBe(null);
    expect(parseLapSec('')).toBe(null);
    expect(parseLapSec('abc')).toBe(null);
    expect(parseLapSec('42')).toBe(null); // No decimal point
  });
});

// ============================================================
// getOvertakeRate
// ============================================================

describe('getOvertakeRate', () => {
  it('returns groupIII rate for group 3', () => {
    expect(getOvertakeRate(mockScoring, 3, 5, false)).toBe(0.3);
    expect(getOvertakeRate(mockScoring, 3, 100, true)).toBe(0.3);
  });

  it('returns groupII rate for group 2', () => {
    expect(getOvertakeRate(mockScoring, 2, 5, false)).toBe(0.5);
  });

  it('returns LL rate for group 1 LL', () => {
    expect(getOvertakeRate(mockScoring, 1, 1, false)).toBe(0.5);
    expect(getOvertakeRate(mockScoring, 1, 5, false)).toBe(0.8);
    expect(getOvertakeRate(mockScoring, 1, 8, false)).toBe(1.0);
    expect(getOvertakeRate(mockScoring, 1, 15, false)).toBe(1.2);
  });

  it('returns CL rate for group 1 CL (different from LL)', () => {
    expect(getOvertakeRate(mockScoring, 1, 1, true)).toBe(0.6);
    expect(getOvertakeRate(mockScoring, 1, 5, true)).toBe(0.9);
    expect(getOvertakeRate(mockScoring, 1, 15, true)).toBe(1.3);
  });

  it('returns 0 for unknown position', () => {
    const emptyScoring = { ...mockScoring, overtakePoints: { ...mockScoring.overtakePoints, groupI_LL: [] } };
    expect(getOvertakeRate(emptyScoring, 1, 5, false)).toBe(0);
  });
});

// ============================================================
// calcOvertakePoints
// ============================================================

describe('calcOvertakePoints', () => {
  it('returns 0 if no positions gained', () => {
    expect(calcOvertakePoints(mockScoring, 1, 5, 5, false)).toBe(0);
    expect(calcOvertakePoints(mockScoring, 1, 5, 8, false)).toBe(0);
  });

  it('calculates progressive overtake points (LL)', () => {
    // Start 5, finish 1 → gained 4 positions: 5(0.8) + 4(0.8) + 3(0.5) + 2(0.5) = 2.6
    expect(calcOvertakePoints(mockScoring, 1, 5, 1, false)).toBeCloseTo(2.6, 1);
  });

  it('uses CL rates when isCL=true', () => {
    // Start 5, finish 1 (CL): 5(0.9) + 4(0.9) + 3(0.6) + 2(0.6) = 3.0
    expect(calcOvertakePoints(mockScoring, 1, 5, 1, true)).toBeCloseTo(3.0, 1);
  });

  it('uses fixed rate for group 2/3', () => {
    // Group 2, start 5 finish 1: 4 overtakes × 0.5 = 2.0
    expect(calcOvertakePoints(mockScoring, 2, 5, 1, false)).toBeCloseTo(2.0, 1);
    expect(calcOvertakePoints(mockScoring, 3, 10, 5, false)).toBeCloseTo(1.5, 1);
  });

  it('rounds to 1 decimal', () => {
    const result = calcOvertakePoints(mockScoring, 1, 10, 5, false);
    // rounded result should have at most 1 decimal place
    expect(result * 10 % 1).toBeCloseTo(0, 5);
  });
});

// ============================================================
// getPositionPoints
// ============================================================

describe('getPositionPoints', () => {
  it('returns correct points for finish position', () => {
    expect(getPositionPoints(mockScoring, 10, '1', 1)).toBe(10);
    expect(getPositionPoints(mockScoring, 10, '1', 3)).toBe(6);
  });

  it('uses correct category by pilot count', () => {
    expect(getPositionPoints(mockScoring, 10, '1', 1)).toBe(10);  // few category
    expect(getPositionPoints(mockScoring, 20, '1', 1)).toBe(12);  // medium category
  });

  it('uses CL table for champions_league format', () => {
    expect(getPositionPoints(mockScoring, 10, '1', 1, 'champions_league')).toBe(15);
    expect(getPositionPoints(mockScoring, 10, '1', 1, 'light_league')).toBe(10);
  });

  it('returns 0 for invalid position or unknown group', () => {
    expect(getPositionPoints(mockScoring, 10, '1', 0)).toBe(0);
    expect(getPositionPoints(mockScoring, 10, '1', 99)).toBe(0);
    expect(getPositionPoints(mockScoring, 10, 'X', 1)).toBe(0);
  });

  it('returns 0 if pilot count out of range', () => {
    expect(getPositionPoints(mockScoring, 100, '1', 1)).toBe(0);
  });
});

// ============================================================
// Sprint position points
// ============================================================

describe('getSprintPositionPoints', () => {
  it('uses 40/37/35 scale for top 3', () => {
    expect(getSprintPositionPoints(1)).toBe(40);
    expect(getSprintPositionPoints(2)).toBe(37);
    expect(getSprintPositionPoints(3)).toBe(35);
  });

  it('decreases by 2 for positions 4+', () => {
    expect(getSprintPositionPoints(4)).toBe(33);
    expect(getSprintPositionPoints(5)).toBe(31);
    expect(getSprintPositionPoints(6)).toBe(29);
    expect(getSprintPositionPoints(10)).toBe(21);
  });

  it('clamps at 0 for low positions', () => {
    expect(getSprintPositionPoints(20)).toBe(1);
    expect(getSprintPositionPoints(21)).toBe(0);
    expect(getSprintPositionPoints(50)).toBe(0);
  });

  it('returns 0 for invalid input', () => {
    expect(getSprintPositionPoints(0)).toBe(0);
    expect(getSprintPositionPoints(-1)).toBe(0);
  });
});

// ============================================================
// Sprint final points
// ============================================================

describe('getSprintFinalPoints', () => {
  it('starts at 180 for first place in first group (Pro)', () => {
    expect(getSprintFinalPoints(1, 0)).toBe(180);
  });

  it('decreases by 3 per position', () => {
    expect(getSprintFinalPoints(1, 0)).toBe(180);
    expect(getSprintFinalPoints(2, 0)).toBe(177);
    expect(getSprintFinalPoints(3, 0)).toBe(174);
  });

  it('continues across groups using precedingPilots', () => {
    // After 12 pilots in Pro, first place in Gold:
    expect(getSprintFinalPoints(1, 12)).toBe(180 - 12 * 3); // = 144
  });

  it('clamps at 0', () => {
    expect(getSprintFinalPoints(100, 0)).toBe(0);
  });
});

describe('byTimeThenTs', () => {
  it('faster time ranks first regardless of timestamp', () => {
    expect(byTimeThenTs(42.1, 1000, 42.2, 500)).toBeLessThan(0);
    expect(byTimeThenTs(42.3, 1000, 42.2, 5000)).toBeGreaterThan(0);
  });

  it('on equal time (to the thousandth), the earlier timestamp ranks first', () => {
    expect(byTimeThenTs(42.177, 1000, 42.177, 2000)).toBeLessThan(0); // a earlier → a wins
    expect(byTimeThenTs(42.177, 3000, 42.177, 2000)).toBeGreaterThan(0); // b earlier → b wins
    expect(byTimeThenTs(42.177, 2000, 42.177, 2000)).toBe(0); // identical
  });
});

describe('byLapsThenTs — тайбрейк за наступним найкращим колом', () => {
  it('різний best-lap: кращий (менший) виграє', () => {
    expect(byLapsThenTs([42.1, 43.0], 1000, [42.2, 42.5], 500)).toBeLessThan(0);
  });

  it('рівний best-lap: виграє кращий за 2-м найкращим колом (кейс Зайцев/Довбиус)', () => {
    // Зайцев: best 43.022, 2nd 43.067. Довбиус: best 43.022, 2nd 43.185.
    const zaitsev = [46.654, 47.559, 43.867, 43.089, 43.798, 43.105, 43.022, 45.122, 43.082, 43.067];
    const dovbius = [46.052, 43.279, 43.022, 43.382, 43.242, 43.847, 43.185, 43.534, 43.241, 44.500];
    // Зайцев поставив best ПІЗНІШЕ (більший ts), але 2-ге коло краще → має бути вище
    expect(byLapsThenTs(zaitsev, 5000, dovbius, 1000)).toBeLessThan(0);
  });

  it('усі спільні кола рівні → fallback на раніший timestamp', () => {
    expect(byLapsThenTs([42.1, 42.5], 1000, [42.1, 42.5], 2000)).toBeLessThan(0);
    expect(byLapsThenTs([42.1, 42.5], 3000, [42.1, 42.5], 2000)).toBeGreaterThan(0);
  });
});

describe('computeStandings — злиття "Карт N" кіл у квалі', () => {
  const mkLap = (pilot: string, kart: number, lap_number: number, lap_time: string, ts: number): SessionLap =>
    ({ pilot, kart, lap_number, lap_time, s1: null, s2: null, position: null, ts });

  it('best-lap квалі враховує кола, записані як "Карт N" (той самий карт, неперервний lap_number)', () => {
    // Пілот на карті 69: спершу timing пише "Карт 69" (кращий час 42.7), потім
    // підтягує ім'я (гірший час 42.9). Без злиття best-lap був би 42.9.
    const sessionLaps = new Map<string, SessionLap[]>([
      ['session-q1', [
        mkLap('Карт 69', 69, 1, '42.700', 1000),
        mkLap('Карт 69', 69, 2, '43.100', 2000),
        mkLap('Колєсніков Дмитро', 69, 3, '42.900', 3000),
        // другий пілот, щоб була група
        mkLap('Інший Пілот', 12, 1, '44.000', 1100),
        mkLap('Інший Пілот', 12, 2, '43.800', 2100),
      ]],
    ]);
    const rows = computeStandings({
      format: 'light_league',
      sessions: [{ sessionId: 'session-q1', phase: 'qualifying_1' }],
      sessionLaps, scoring: mockScoring, edits: {},
      excludedPilots: new Set(['Карт 69']), // як робить UI/аудит — але злиття має перекрити
      maxGroups: 1,
    });
    const kol = rows.find(r => r.pilot === 'Колєсніков Дмитро');
    expect(kol).toBeDefined();
    // best-lap = 42.700 (з "Карт 69" кола), а не 42.900
    expect(kol!.quali!.bestTimeStr).toBe('42.700');
  });
});

