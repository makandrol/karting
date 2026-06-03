import { describe, it, expect } from 'vitest';
import {
  FORMAT_MAX_GROUPS,
  FORMAT_DEFAULT_RACE_PILOTS,
  buildFullPhases,
  filterPhases,
  findNextPhase,
  allPhasesFilled,
  isKartName,
  isGonzalesQualifying,
  detectGroupCountFromOverlap,
  capGroupCount,
  detectGroupsFromSessionSequence,
  planAutoLink,
  type SequentialSession,
} from './competitionLinking';

// Smoke-tests for the shared logic — heavier coverage lives in
// `collector/src/competition-link-utils.test.js`. Here we validate the TS
// re-implementation matches and exercise frontend-specific helpers.

describe('FORMAT_MAX_GROUPS / FORMAT_DEFAULT_RACE_PILOTS (frontend mirror)', () => {
  it('gonzales=2, light_league=3, champions_league=2, sprint=3, marathon=1', () => {
    expect(FORMAT_MAX_GROUPS).toEqual({
      gonzales: 2,
      light_league: 3,
      champions_league: 2,
      sprint: 3,
      marathon: 1,
    });
  });

  it('FORMAT_DEFAULT_RACE_PILOTS: CL=24, LL/Sprint=36', () => {
    expect(FORMAT_DEFAULT_RACE_PILOTS.champions_league).toBe(24);
    expect(FORMAT_DEFAULT_RACE_PILOTS.light_league).toBe(36);
    expect(FORMAT_DEFAULT_RACE_PILOTS.sprint).toBe(36);
  });
});

describe('buildFullPhases / filterPhases (frontend mirror)', () => {
  it('LL has 10 phases', () => {
    expect(buildFullPhases('light_league')).toHaveLength(10);
  });

  it('CL has 8 phases', () => {
    expect(buildFullPhases('champions_league')).toHaveLength(8);
  });

  it('Sprint has 15 phases', () => {
    expect(buildFullPhases('sprint')).toHaveLength(15);
  });

  it('Gonzales: default 2 + 12*2 = 26', () => {
    expect(buildFullPhases('gonzales')).toHaveLength(26);
  });

  it('filterPhases LL/2 groups: 6 phases', () => {
    expect(filterPhases(buildFullPhases('light_league'), 2, 'light_league')).toHaveLength(6);
  });

  it('filterPhases Sprint/1 group: only group_1 phases', () => {
    const filtered = filterPhases(buildFullPhases('sprint'), 1, 'sprint');
    expect(filtered.every(p => /group_1$/.test(p))).toBe(true);
    expect(filtered).toHaveLength(5); // q1, r1, q2, r2, final = 5
  });
});

describe('findNextPhase / allPhasesFilled (frontend)', () => {
  it('null usedPhases entries are ignored', () => {
    expect(findNextPhase(['a', 'b', 'c'], [null, undefined, 'a'])).toBe('b');
  });

  it('all filled', () => {
    expect(allPhasesFilled(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(allPhasesFilled(['a', 'b'], ['a'])).toBe(false);
  });
});

describe('isKartName / isGonzalesQualifying (frontend)', () => {
  it('"Карт N" detection (case-insensitive)', () => {
    expect(isKartName('Карт 5')).toBe(true);
    expect(isKartName('карт 12')).toBe(true);
    expect(isKartName('Іванов')).toBe(false);
    expect(isKartName(null)).toBe(false);
  });

  it('isGonzalesQualifying: real names → true', () => {
    expect(isGonzalesQualifying(['Іванов', 'Петров'], new Map(), false)).toBe(true);
  });

  it('isGonzalesQualifying: "Карт N" + finished + maxLaps>=5 → true (mirrors storage.js)', () => {
    expect(isGonzalesQualifying(['Карт 1'], new Map([['Карт 1', 5]]), true)).toBe(true);
  });
});

describe('detectGroupCountFromOverlap (frontend)', () => {
  it('overlap=100% → race, groupCount=qualiCount', () => {
    const r = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A', 'B']),
      newPilots: new Set(['A', 'B']),
      qualifyingCount: 2,
      format: 'light_league',
    });
    expect(r).toEqual({ groupCount: 2, action: 'race' });
  });

  it('CL caps to 2', () => {
    const r = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A']),
      newPilots: new Set(['A']),
      qualifyingCount: 5,
      format: 'champions_league',
    });
    expect(r.groupCount).toBe(2);
  });
});

describe('capGroupCount (frontend)', () => {
  it('caps and floors', () => {
    expect(capGroupCount(99, 'champions_league')).toBe(2);
    expect(capGroupCount(0, 'sprint')).toBe(1);
    expect(capGroupCount(2, 'light_league')).toBe(2);
  });
});

// ============================================================
// detectGroupsFromSessionSequence — frontend-specific
// ============================================================

function mkSession(id: string, pilots: string[], opts: Partial<SequentialSession> = {}): SequentialSession {
  return {
    id,
    pilots: new Set(pilots),
    lapCounts: opts.lapCounts ?? new Map(),
    isFinished: opts.isFinished ?? true,
  };
}

describe('detectGroupsFromSessionSequence (LL/CL/Sprint)', () => {
  it('1 session → groupCount=1, qualiCount=1', () => {
    const r = detectGroupsFromSessionSequence(
      [mkSession('s1', ['A', 'B'])],
      'light_league'
    );
    expect(r).toEqual({ groupCount: 1, qualifyingCount: 1, stoppedAtIndex: 1 });
  });

  it('2 sessions, distinct pilots → 2 groups', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['A', 'B']),
        mkSession('s2', ['C', 'D']),
      ],
      'light_league'
    );
    expect(r.qualifyingCount).toBe(2);
    expect(r.groupCount).toBe(2);
    expect(r.stoppedAtIndex).toBe(2);
  });

  it('3 sessions, distinct → groupCount=3 для LL (max=3)', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['A', 'B']),
        mkSession('s2', ['C', 'D']),
        mkSession('s3', ['E', 'F']),
      ],
      'light_league'
    );
    expect(r.groupCount).toBe(3);
  });

  it('CL: 3 distinct sessions → groupCount capped to 2', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['A']),
        mkSession('s2', ['B']),
        mkSession('s3', ['C']),
      ],
      'champions_league'
    );
    expect(r.qualifyingCount).toBe(3);
    expect(r.groupCount).toBe(2);
  });

  it('stops on overlap >= 50%', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['A', 'B', 'C']), // quali 1
        mkSession('s2', ['A', 'B', 'C']), // race (100% overlap) — stop here
        mkSession('s3', ['X', 'Y']),       // ignored
      ],
      'light_league'
    );
    expect(r.qualifyingCount).toBe(1);
    expect(r.stoppedAtIndex).toBe(1);
  });

  it('skips empty sessions', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', []),                // empty — skipped
        mkSession('s2', ['A', 'B']),
        mkSession('s3', ['C', 'D']),
      ],
      'light_league'
    );
    expect(r.qualifyingCount).toBe(2);
  });
});

describe('detectGroupsFromSessionSequence (Gonzales)', () => {
  it('real names + then "Карт N" з maxLaps>=5 → за поточним кодом обидва qualifying (mirrors storage.js bug)', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['Іванов', 'Петров']),               // quali (real names)
        mkSession('s2', ['Карт 1', 'Карт 2'], {              // також "qualifying" за isHighLapCount
          lapCounts: new Map([['Карт 1', 6]]),
          isFinished: true,
        }),
      ],
      'gonzales'
    );
    expect(r.qualifyingCount).toBe(2);
    expect(r.groupCount).toBe(2);
  });

  it('real names + "Карт N" з maxLaps<5 → друга сесія = round, stops', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['Іванов', 'Петров']),
        mkSession('s2', ['Карт 1', 'Карт 2'], {
          lapCounts: new Map([['Карт 1', 3]]),  // <5
          isFinished: true,
        }),
      ],
      'gonzales'
    );
    expect(r.qualifyingCount).toBe(1);
    expect(r.stoppedAtIndex).toBe(1);
    expect(r.groupCount).toBe(1);
  });

  it('два quali підряд → break після другого, qualiCount=2', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['Іванов', 'Петров']),
        mkSession('s2', ['Сидоров', 'Шевченко']),
        mkSession('s3', ['Карт 1', 'Карт 2'], {
          lapCounts: new Map([['Карт 1', 6]]),
          isFinished: true,
        }),
      ],
      'gonzales'
    );
    expect(r.qualifyingCount).toBe(2);
    expect(r.groupCount).toBe(2);
  });

  it('all real names → 2 qualis (cap)', () => {
    const r = detectGroupsFromSessionSequence(
      [
        mkSession('s1', ['Іванов']),
        mkSession('s2', ['Петров']),
        mkSession('s3', ['Сидоров']),
      ],
      'gonzales'
    );
    // cap to 2
    expect(r.groupCount).toBe(2);
  });
});

// ============================================================
// planAutoLink — used by SessionTypeChanger
// ============================================================

describe('planAutoLink', () => {
  it('LL with 1 group, currentPhaseIdx=0, 3 sessions after → links 3 races', () => {
    const r = planAutoLink({
      format: 'light_league',
      groupCount: 1,
      currentPhaseIdx: 0,
      availableSessionsAfter: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    });
    // LL/1 group: phases = qualifying_1, race_1_group_1, race_2_group_1 (3 phases)
    // currentPhaseIdx=0 → qualifying_1, remaining = 2 phases
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ sessionId: 'a', phaseId: 'race_1_group_1' });
    expect(r[1]).toEqual({ sessionId: 'b', phaseId: 'race_2_group_1' });
  });

  it('Sprint with 2 groups: extends through final', () => {
    const r = planAutoLink({
      format: 'sprint',
      groupCount: 2,
      currentPhaseIdx: 0,
      availableSessionsAfter: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}` })),
    });
    // Sprint/2 groups: 10 phases total, current=0, remaining=9
    expect(r).toHaveLength(9);
    expect(r[r.length - 1].phaseId).toBe('final_group_1');
  });

  it('returns empty when no sessions available', () => {
    const r = planAutoLink({
      format: 'light_league',
      groupCount: 1,
      currentPhaseIdx: 0,
      availableSessionsAfter: [],
    });
    expect(r).toEqual([]);
  });

  it('caps at remaining phases when more sessions provided', () => {
    const r = planAutoLink({
      format: 'champions_league',
      groupCount: 1,
      currentPhaseIdx: 2, // already past quali + race_1
      // CL/1 group: phases = q1, r1g1, r2g1, r3g1 (4 phases)
      // currentPhaseIdx=2 → r2g1, remaining=1 phase (r3g1)
      availableSessionsAfter: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ sessionId: 'a', phaseId: 'race_3_group_1' });
  });

  it('Gonzales with custom roundCount', () => {
    const r = planAutoLink({
      format: 'gonzales',
      groupCount: 1,
      currentPhaseIdx: 0,
      availableSessionsAfter: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}` })),
      gonzalesRoundCount: 3,
    });
    // 1 group, 3 rounds: q1 + round_1_g1 + round_2_g1 + round_3_g1 = 4 phases
    // currentPhaseIdx=0 → q1, remaining=3
    expect(r).toHaveLength(3);
    expect(r.map(x => x.phaseId)).toEqual(['round_1_group_1', 'round_2_group_1', 'round_3_group_1']);
  });
});
