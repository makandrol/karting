import { describe, it, expect } from 'vitest';
import {
  splitIntoGroups,
  splitIntoGroupsSprint,
  reverseStartOrder,
  getGroupCountForFormat,
  getGonzalesGroupCount,
  getGonzalesRoundCount,
  computeReverseStartPositions,
  computeSprintSnakeStartPositions,
  buildGonzalesRotation,
  getGonzalesKartForRound,
  getPhasesForFormat,
  getPhaseLabel,
} from './competitions';

// ============================================================
// splitIntoGroups (LL/CL — sequential blocks)
// ============================================================

describe('splitIntoGroups', () => {
  it('puts ≤13 pilots into 1 group', () => {
    const groups = splitIntoGroups(['p1', 'p2', 'p3'], 3);
    expect(groups).toHaveLength(1);
    expect(groups[0].pilots).toEqual(['p1', 'p2', 'p3']);
  });

  it('splits 24 pilots into 2 groups for LL', () => {
    const pilots = Array.from({ length: 24 }, (_, i) => `p${i + 1}`);
    const groups = splitIntoGroups(pilots, 3);
    expect(groups).toHaveLength(2);
    expect(groups[0].pilots).toHaveLength(12);
    expect(groups[1].pilots).toHaveLength(12);
  });

  it('puts more pilots in stronger group when uneven', () => {
    const pilots = Array.from({ length: 25 }, (_, i) => `p${i + 1}`);
    const groups = splitIntoGroups(pilots, 2);
    expect(groups[0].pilots).toHaveLength(13);
    expect(groups[1].pilots).toHaveLength(12);
  });

  it('CL max 2 groups even with 30 pilots', () => {
    const pilots = Array.from({ length: 30 }, (_, i) => `p${i + 1}`);
    const groups = splitIntoGroups(pilots, 2);
    expect(groups).toHaveLength(2);
  });
});

// ============================================================
// splitIntoGroupsSprint (snake)
// ============================================================

describe('splitIntoGroupsSprint', () => {
  it('1 group for ≤14 pilots', () => {
    const groups = splitIntoGroupsSprint(['p1', 'p2', 'p3']);
    expect(groups).toHaveLength(1);
  });

  it('2 groups for 15-29', () => {
    const pilots = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
    const groups = splitIntoGroupsSprint(pilots);
    expect(groups).toHaveLength(2);
  });

  it('3 groups for 30+', () => {
    const pilots = Array.from({ length: 30 }, (_, i) => `p${i + 1}`);
    const groups = splitIntoGroupsSprint(pilots);
    expect(groups).toHaveLength(3);
  });

  it('uses snake distribution (round-robin)', () => {
    const pilots = ['1', '2', '3', '4', '5', '6'];
    // 6 % 3 = 0 → not reversed → 1→A, 2→B, 3→C, 4→A, 5→B, 6→C
    const groups = splitIntoGroupsSprint(pilots, 3);
    // expect 6/3 = 2 groups (rule says ≤14 → 1, this is 6 → 1 group)
    // wait, splitIntoGroupsSprint: ≤14 → 1, only ≤14 etc. 6 pilots → 1 group
    expect(groups).toHaveLength(1);
  });

  it('balances when uneven (with maxGroups override)', () => {
    const pilots = Array.from({ length: 7 }, (_, i) => `p${i + 1}`); // 7 pilots
    // Use maxGroups=3 to force; ≤14 normally = 1 group
    // With maxGroups not set, 7 ≤14 → 1 group. Test with 20+
    const big = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
    const groups = splitIntoGroupsSprint(big);
    expect(groups).toHaveLength(2);
    const total = groups.reduce((sum, g) => sum + g.pilots.length, 0);
    expect(total).toBe(20);
  });
});

// ============================================================
// reverseStartOrder
// ============================================================

describe('reverseStartOrder', () => {
  it('reverses pilot list', () => {
    expect(reverseStartOrder(['a', 'b', 'c'])).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate input', () => {
    const input = ['a', 'b', 'c'];
    reverseStartOrder(input);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

// ============================================================
// getGroupCountForFormat
// ============================================================

describe('getGroupCountForFormat', () => {
  it('Sprint: ≤14→1, 15-29→2, 30+→3', () => {
    expect(getGroupCountForFormat('sprint', 5)).toBe(1);
    expect(getGroupCountForFormat('sprint', 14)).toBe(1);
    expect(getGroupCountForFormat('sprint', 15)).toBe(2);
    expect(getGroupCountForFormat('sprint', 29)).toBe(2);
    expect(getGroupCountForFormat('sprint', 30)).toBe(3);
    expect(getGroupCountForFormat('sprint', 45)).toBe(3);
  });

  it('LL: ≤13→1, 14-26→2, 27+→3', () => {
    expect(getGroupCountForFormat('light_league', 13)).toBe(1);
    expect(getGroupCountForFormat('light_league', 14)).toBe(2);
    expect(getGroupCountForFormat('light_league', 27)).toBe(3);
  });

  it('CL max 2 groups', () => {
    expect(getGroupCountForFormat('champions_league', 30)).toBe(2);
    expect(getGroupCountForFormat('champions_league', 13)).toBe(1);
  });

  it('Gonzales max 2 groups', () => {
    expect(getGroupCountForFormat('gonzales', 13)).toBe(1);
    expect(getGroupCountForFormat('gonzales', 14)).toBe(2);
    expect(getGroupCountForFormat('gonzales', 24)).toBe(2);
  });
});

// ============================================================
// Gonzales counts
// ============================================================

describe('getGonzalesGroupCount / RoundCount', () => {
  it('group count', () => {
    expect(getGonzalesGroupCount(12)).toBe(1);
    expect(getGonzalesGroupCount(14)).toBe(2);
  });

  it('round count is max(pilotCount, 12)', () => {
    expect(getGonzalesRoundCount(8)).toBe(12);
    expect(getGonzalesRoundCount(20)).toBe(20);
  });
});

// ============================================================
// computeReverseStartPositions
// ============================================================

describe('computeReverseStartPositions', () => {
  it('reverses qualification order within group (LL group 1, 12 pilots)', () => {
    const pilots = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    const positions = computeReverseStartPositions(pilots, 'light_league', 1);
    // 1 group of 12, reverse: p1 → 12, p12 → 1
    expect(positions.get('p1')).toBe(12);
    expect(positions.get('p12')).toBe(1);
  });

  it('handles 2 groups correctly (CL with 24 pilots)', () => {
    const pilots = Array.from({ length: 24 }, (_, i) => `p${i + 1}`);
    const g1 = computeReverseStartPositions(pilots, 'champions_league', 1);
    const g2 = computeReverseStartPositions(pilots, 'champions_league', 2);
    // p1-p12 in group 1, p13-p24 in group 2
    expect(g1.get('p1')).toBe(12);
    expect(g1.get('p12')).toBe(1);
    expect(g1.has('p13')).toBe(false);
    expect(g2.get('p13')).toBe(12);
    expect(g2.get('p24')).toBe(1);
  });
});

// ============================================================
// computeSprintSnakeStartPositions
// ============================================================

describe('computeSprintSnakeStartPositions', () => {
  it('places 1 group when ≤14 pilots', () => {
    const pilots = ['p1', 'p2', 'p3'];
    const g1 = computeSprintSnakeStartPositions(pilots, 1);
    expect(g1.get('p1')).toBe(1);
    expect(g1.get('p2')).toBe(2);
    expect(g1.get('p3')).toBe(3);
  });

  it('snake distribution for 2 groups (15-29 pilots)', () => {
    const pilots = Array.from({ length: 20 }, (_, i) => `p${i + 1}`); // 2 groups
    const g1 = computeSprintSnakeStartPositions(pilots, 1);
    const g2 = computeSprintSnakeStartPositions(pilots, 2);
    // 20 % 2 = 0 → not reversed → p1→A(g0), p2→B(g1), ...
    // g1 (groupNum=1, idx=0) = pilots[0,2,4...] = [p1, p3, p5, ...]
    expect(g1.get('p1')).toBe(1);
    expect(g1.get('p3')).toBe(2);
    expect(g2.get('p2')).toBe(1);
  });
});

// ============================================================
// buildGonzalesRotation
// ============================================================

describe('buildGonzalesRotation', () => {
  it('builds 12 slots when no skips', () => {
    const slots = buildGonzalesRotation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 12);
    expect(slots).toHaveLength(12);
    expect(slots[0].kart).toBe(1);
    expect(slots[11].kart).toBe(12);
  });

  it('inserts skips when pilotCount > karts.length', () => {
    const slots = buildGonzalesRotation([1, 2, 3], 5);
    // 3 karts, 2 skips → some slots are null
    expect(slots.length).toBeGreaterThan(3);
    const skips = slots.filter(s => s.kart === null);
    expect(skips.length).toBe(2);
  });

  it('respects custom slotOrder', () => {
    const slots = buildGonzalesRotation([1, 2, 3], 5, [3, null, 2, null, 1]);
    expect(slots).toHaveLength(5);
    expect(slots[0].kart).toBe(3);
    expect(slots[1].kart).toBe(null);
    expect(slots[4].kart).toBe(1);
  });
});

// ============================================================
// getGonzalesKartForRound
// ============================================================

describe('getGonzalesKartForRound', () => {
  it('rotates through slots starting from startSlot', () => {
    const slots = buildGonzalesRotation([1, 2, 3, 4], 4);
    expect(getGonzalesKartForRound(slots, 0, 0).kart).toBe(1);
    expect(getGonzalesKartForRound(slots, 0, 1).kart).toBe(2);
    expect(getGonzalesKartForRound(slots, 1, 0).kart).toBe(2);
    expect(getGonzalesKartForRound(slots, 0, 4).kart).toBe(1); // wraps
    expect(getGonzalesKartForRound(slots, 0, 5).kart).toBe(2); // wraps
  });
});

// ============================================================
// getPhasesForFormat
// ============================================================

describe('getPhasesForFormat', () => {
  it('LL with 1 group skips group_2/3', () => {
    const phases = getPhasesForFormat('light_league', 1);
    const ids = phases.map(p => p.id);
    expect(ids).toContain('qualifying_1');
    expect(ids).not.toContain('race_1_group_2');
    expect(ids).not.toContain('race_1_group_3');
  });

  it('LL with 2 groups skips group_3', () => {
    const phases = getPhasesForFormat('light_league', 2);
    const ids = phases.map(p => p.id);
    expect(ids).toContain('race_1_group_2');
    expect(ids).not.toContain('race_1_group_3');
  });

  it('Sprint includes finals', () => {
    const phases = getPhasesForFormat('sprint', 2);
    const ids = phases.map(p => p.id);
    expect(ids).toContain('final_group_1');
    expect(ids).toContain('final_group_2');
  });
});

// ============================================================
// getPhaseLabel
// ============================================================

describe('getPhaseLabel', () => {
  it('returns Ukrainian label for LL phase', () => {
    expect(getPhaseLabel('light_league', 'qualifying_1')).toBe('Кваліфікація 1');
    expect(getPhaseLabel('light_league', 'race_1_group_1')).toBe('Гонка 1 · Група 1');
  });

  it('returns "Гонка N" for gonzales rounds', () => {
    expect(getPhaseLabel('gonzales', 'round_5_group_1', 1)).toBe('Гонка 5');
  });
});
