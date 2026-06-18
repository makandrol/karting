import type { MarathonPitInterval } from './marathon';

/**
 * Marathon pit-lane state.
 *
 * Physical model: 4 karts in 2 rows (left/right), 2 positions each. A car
 * enters a row, the driver takes the FRONT kart (head) and leaves on it; the
 * car's own kart (kartIn) is parked at the BACK of that row.
 *
 * Which row a car uses is chosen LIVE by a marshal (random), so we rely on a
 * manual override (owner assigns left/right). An on-pit car with no override
 * is "waiting" (row unknown). For an assigned car: front = the driver (+ the
 * kart they take, kartOut), back = their parked kart (kartIn).
 */

export type PitRow = 'L' | 'R';

/** Manual row overrides: key = `${startKart}|${startTs}` → 'L' | 'R'. */
export type PitRowOverrides = Record<string, PitRow>;

export interface PitLaneCar {
  /** Stable team id (start slot). */
  startKart: number;
  startTs: number;
  teamName: string;
  pilotName: string;
  kartIn: number | null;
  kartOut: number | null;
  segBestLapSec: number | null;
  segDurationSec: number | null;
  /** Pit elapsed seconds at the queried moment. */
  pitElapsedSec: number;
  /** Resolved row, or null if still unknown. */
  row: PitRow | null;
  /** How the row was resolved. */
  rowSource: 'manual' | 'inferred' | null;
}

export interface PitRowSlots {
  /** Driver currently at the front of this row (took the head kart), or null. */
  front: PitLaneCar | null;
  /** Kart number the front driver leaves on (head), if known. */
  frontKart: number | null;
  /** Kart parked at the back of this row (the front driver's kartIn), if any. */
  backKart: number | null;
}

export interface PitLaneState {
  /** Cars currently on pit, no row yet — in arrival order. */
  waiting: PitLaneCar[];
  /** Left row slots (front driver + back parked kart). */
  leftRow: PitRowSlots;
  /** Right row slots. */
  rightRow: PitRowSlots;
}

export function pitKey(iv: { startKart: number; startTs: number }): string {
  return `${iv.startKart}|${iv.startTs}`;
}

/**
 * Compute pit-lane state at `currentMs`, honoring manual `overrides`.
 *
 * Only cars currently on pit (startTs <= now < endTs) are shown. An assigned
 * car (manual override) occupies the front of its row; its kartIn is the back
 * kart. Unassigned on-pit cars wait (row unknown).
 */
export function computePitLane(
  intervals: MarathonPitInterval[],
  overrides: PitRowOverrides,
  currentMs: number,
): PitLaneState {
  const ordered = [...intervals].sort((a, b) => a.startTs - b.startTs);

  const state: PitLaneState = {
    waiting: [],
    leftRow: { front: null, frontKart: null, backKart: null },
    rightRow: { front: null, frontKart: null, backKart: null },
  };

  const toCar = (iv: MarathonPitInterval, row: PitRow | null, source: 'manual' | 'inferred' | null): PitLaneCar => ({
    startKart: iv.startKart,
    startTs: iv.startTs,
    teamName: iv.teamName,
    pilotName: iv.pilotName,
    kartIn: iv.kartIn,
    kartOut: iv.kartOut,
    segBestLapSec: iv.segBestLapSec,
    segDurationSec: iv.segDurationSec,
    pitElapsedSec: Math.max(0, (currentMs - iv.startTs) / 1000),
    row,
    rowSource: source,
  });

  for (const iv of ordered) {
    if (!(iv.startTs <= currentMs && currentMs < iv.endTs)) continue; // only on-pit now
    const manual = overrides[pitKey(iv)];
    if (manual === 'L' || manual === 'R') {
      const car = toCar(iv, manual, 'manual');
      const slots = manual === 'L' ? state.leftRow : state.rightRow;
      // Front driver: most recent assigned car occupies the front; older ones
      // (rare double-stack) keep their kartIn at back too.
      slots.front = car;
      slots.frontKart = iv.kartOut ?? null;       // kart they take/leave on
      slots.backKart = iv.kartIn ?? slots.backKart; // their own kart parked behind
    } else {
      state.waiting.push(toCar(iv, null, null));
    }
  }

  return state;
}
