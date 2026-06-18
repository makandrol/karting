import type { MarathonPitInterval } from './marathon';

/**
 * Marathon pit-lane state.
 *
 * Physical model: 4 karts in 2 FIFO rows (left/right), 2 karts each. A car
 * enters a row, the driver takes the FRONT kart (row head) and leaves on it;
 * the car's own kart (kartIn) is parked at the BACK (tail) of that row.
 *
 * Which row a car uses is chosen LIVE by a marshal (random), so it can't be
 * derived reliably ahead of time. We determine the row by:
 *   1. a manual override (owner assigns left/right), OR
 *   2. inference once the car has LEFT — its kartOut was the row head, so the
 *      row whose head matched kartOut is the one it used; its kartIn then sits
 *      at that row's tail.
 *
 * A car that is still on pit with no manual row is "waiting" (row unknown).
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

export interface PitLaneState {
  /** Cars currently on pit, no row yet — in arrival order. */
  waiting: PitLaneCar[];
  /** Cars currently on pit assigned to left row — arrival order. */
  left: PitLaneCar[];
  /** Cars currently on pit assigned to right row — arrival order. */
  right: PitLaneCar[];
  /** Tail karts parked in each row (most recent first), for the back slot. */
  leftParked: number[];
  rightParked: number[];
}

export function pitKey(iv: { startKart: number; startTs: number }): string {
  return `${iv.startKart}|${iv.startTs}`;
}

/**
 * Compute pit-lane state at `currentMs`, honoring manual `overrides`.
 *
 * Inference: simulate the two row queues over ALL completed pits up to now to
 * learn which row each completed car used (head match on kartOut), so a car
 * still on pit can be auto-placed once a later signal reveals its row. For the
 * live snapshot we only auto-resolve a still-on-pit car's row if a manual
 * override exists; otherwise it waits (row truly unknown until it leaves).
 */
export function computePitLane(
  intervals: MarathonPitInterval[],
  overrides: PitRowOverrides,
  currentMs: number,
): PitLaneState {
  const ordered = [...intervals].sort((a, b) => a.startTs - b.startTs);

  // Simulate row queues to infer rows for COMPLETED pits (kartOut known).
  const queues: Record<PitRow, number[]> = { L: [], R: [] };
  const inferredRow = new Map<string, PitRow>();

  for (const iv of ordered) {
    const key = pitKey(iv);
    const manual = overrides[key];
    const out = iv.kartOut;

    let row: PitRow | null = manual ?? null;
    if (!row && out != null && out > 0) {
      if (queues.L[0] === out) row = 'L';
      else if (queues.R[0] === out) row = 'R';
      else if (queues.L.length === 0) row = 'L';
      else if (queues.R.length === 0) row = 'R';
      else row = queues.L.length <= queues.R.length ? 'L' : 'R';
    }
    if (row) {
      inferredRow.set(key, row);
      // apply queue effect only for cars that have actually left (endTs <= now)
      // so the live "current head" reflects reality.
      if (iv.endTs <= currentMs) {
        if (out != null && queues[row][0] === out) queues[row].shift();
        if (iv.kartIn != null && iv.kartIn > 0) queues[row].push(iv.kartIn);
        while (queues[row].length > 2) queues[row].shift();
      }
    }
  }

  const state: PitLaneState = {
    waiting: [], left: [], right: [],
    leftParked: [...queues.L].reverse(),
    rightParked: [...queues.R].reverse(),
  };

  for (const iv of ordered) {
    if (!(iv.startTs <= currentMs && currentMs < iv.endTs)) continue; // only on-pit now
    const key = pitKey(iv);
    const manual = overrides[key];
    const row: PitRow | null = manual ?? null; // on-pit, unknown unless manual
    const car: PitLaneCar = {
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
      rowSource: manual ? 'manual' : null,
    };
    if (row === 'L') state.left.push(car);
    else if (row === 'R') state.right.push(car);
    else state.waiting.push(car);
  }

  return state;
}
