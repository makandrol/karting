import { describe, it, expect } from 'vitest';
import { computePitLane, pitKey, type PitRowOverrides } from './marathonPitLane';
import type { MarathonPitInterval } from './marathon';

function iv(p: Partial<MarathonPitInterval> & { startKart: number; startTs: number; endTs: number }): MarathonPitInterval {
  return {
    teamName: `T${p.startKart}`,
    pilotName: `P${p.startKart}`,
    kartIn: null,
    kartOut: null,
    segBestLapSec: null,
    segDurationSec: null,
    pitIndex: 1,
    ...p,
  };
}

describe('computePitLane', () => {
  it('puts an on-pit car with no override in waiting', () => {
    const intervals = [iv({ startKart: 10, startTs: 1000, endTs: 5000, kartIn: 16 })];
    const s = computePitLane(intervals, {}, 2000);
    expect(s.waiting).toHaveLength(1);
    expect(s.left).toHaveLength(0);
    expect(s.right).toHaveLength(0);
    expect(s.waiting[0].row).toBeNull();
    expect(s.waiting[0].pitElapsedSec).toBeCloseTo(1, 3);
  });

  it('manual override places a car in the chosen row', () => {
    const intervals = [iv({ startKart: 10, startTs: 1000, endTs: 5000, kartIn: 16 })];
    const ov: PitRowOverrides = { [pitKey({ startKart: 10, startTs: 1000 })]: 'R' };
    const s = computePitLane(intervals, ov, 2000);
    expect(s.right).toHaveLength(1);
    expect(s.waiting).toHaveLength(0);
    expect(s.right[0].rowSource).toBe('manual');
  });

  it('excludes cars that already left the pit', () => {
    const intervals = [iv({ startKart: 10, startTs: 1000, endTs: 3000, kartIn: 16, kartOut: 20 })];
    const s = computePitLane(intervals, {}, 4000); // after it left
    expect(s.waiting).toHaveLength(0);
    expect(s.left).toHaveLength(0);
    expect(s.right).toHaveLength(0);
  });

  it('parks the kartIn at the row tail after a car leaves (queue effect)', () => {
    // Car A enters row R (manual), leaves on kartOut=20, parks kartIn=16.
    const intervals = [
      iv({ startKart: 10, startTs: 1000, endTs: 3000, kartIn: 16, kartOut: 20 }),
    ];
    const ov: PitRowOverrides = { [pitKey({ startKart: 10, startTs: 1000 })]: 'R' };
    const s = computePitLane(intervals, ov, 4000);
    expect(s.rightParked).toContain(16);
  });

  it('infers row via kartOut head match for the next car', () => {
    // A: row R, leaves on 20, parks 16 → R head now 16.
    // B: kartOut = 16 → must be inferred to row R.
    const intervals = [
      iv({ startKart: 10, startTs: 1000, endTs: 3000, kartIn: 16, kartOut: 20 }),
      iv({ startKart: 11, startTs: 5000, endTs: 7000, kartIn: 33, kartOut: 16 }),
    ];
    const ov: PitRowOverrides = { [pitKey({ startKart: 10, startTs: 1000 })]: 'R' };
    // query while B is still on pit but row known via override? B has no override,
    // it's on pit → waiting (live unknown). After B leaves, queue reflects R.
    const after = computePitLane(intervals, ov, 8000);
    expect(after.rightParked).toContain(33); // B parked into R
  });
});
