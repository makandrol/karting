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
    expect(s.leftRow.front).toBeNull();
    expect(s.rightRow.front).toBeNull();
    expect(s.waiting[0].row).toBeNull();
    expect(s.waiting[0].pitElapsedSec).toBeCloseTo(1, 3);
  });

  it('manual override: driver at front, kartIn at back', () => {
    const intervals = [iv({ startKart: 10, startTs: 1000, endTs: 5000, kartIn: 16, kartOut: 20 })];
    const ov: PitRowOverrides = { [pitKey({ startKart: 10, startTs: 1000 })]: 'R' };
    const s = computePitLane(intervals, ov, 2000);
    expect(s.waiting).toHaveLength(0);
    expect(s.rightRow.front?.startKart).toBe(10);
    expect(s.rightRow.front?.rowSource).toBe('manual');
    expect(s.rightRow.frontKart).toBe(20); // kart taken/left on
    expect(s.rightRow.backKart).toBe(16);  // own kart parked behind
    expect(s.leftRow.front).toBeNull();
  });

  it('excludes cars that already left the pit', () => {
    const intervals = [iv({ startKart: 10, startTs: 1000, endTs: 3000, kartIn: 16, kartOut: 20 })];
    const s = computePitLane(intervals, {}, 4000); // after it left
    expect(s.waiting).toHaveLength(0);
    expect(s.leftRow.front).toBeNull();
    expect(s.rightRow.front).toBeNull();
  });

  it('a car leaving the pit frees its row slot', () => {
    const intervals = [iv({ startKart: 10, startTs: 1000, endTs: 3000, kartIn: 16, kartOut: 20 })];
    const ov: PitRowOverrides = { [pitKey({ startKart: 10, startTs: 1000 })]: 'L' };
    const during = computePitLane(intervals, ov, 2000);
    expect(during.leftRow.front?.startKart).toBe(10);
    const after = computePitLane(intervals, ov, 4000);
    expect(after.leftRow.front).toBeNull();
  });
});
