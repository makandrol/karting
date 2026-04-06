/**
 * Shared timing utilities — parsing lap times, color coding.
 * Used by TimingBoard, SessionReplay, and timingParser.
 */

/** Parse lap time strings to seconds: "39.800" → 39.8, "1:02.222" → 62.222, "00:42.123" → 42.123 */
export function parseTime(t: string | null): number | null {
  if (!t) return null;
  const lapMatch = t.match(/^(\d+):(\d+\.\d+)$/);
  if (lapMatch) return parseInt(lapMatch[1]) * 60 + parseFloat(lapMatch[2]);
  const secMatch = t.match(/^\d+\.\d+$/);
  if (secMatch) return parseFloat(t);
  return null;
}

export type TimeColor = 'purple' | 'green' | 'yellow' | 'none';

export function getTimeColor(value: string | null, personalBest: string | null, overallBest: number | null): TimeColor {
  const val = parseTime(value);
  if (val === null) return 'none';
  if (overallBest !== null && Math.abs(val - overallBest) < 0.002) return 'purple';
  const pb = parseTime(personalBest);
  if (pb === null) return 'green';
  if (Math.abs(val - pb) < 0.002) return 'green';
  if (val > pb) return 'yellow';
  return 'green';
}

export const COLOR_CLASSES: Record<TimeColor, string> = {
  purple: 'text-purple-400',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  none: 'text-dark-500',
};

export const KART_COLOR = 'text-blue-400';

/** "Апанасенко Олексій" → "Апанасенко О.", but keep short names and "Карт X" as-is */
export function shortName(name: string): string {
  if (!name || name.length <= 10 || /^Карт\s/i.test(name)) return name;
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length < 2 || !parts[1]) return name;
  return `${parts[0]} ${parts[1][0]}.`;
}

/** Format bytes to human readable string */
export function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/** Convert any lap time string to seconds display: "01:00.496" → "60.496", "42.574" → "42.574" */
export function toSeconds(t: string | null): string {
  if (!t) return '—';
  const sec = parseTime(t);
  if (sec === null) return t;
  return sec.toFixed(3);
}

/** Like toSeconds but truncated to hundredths: "18.080" → "18.08" */
export function toHundredths(t: string | null): string {
  if (!t) return '—';
  const sec = parseTime(t);
  if (sec === null) return t;
  return sec.toFixed(2);
}

/**
 * Merge laps where pilot name is "Карт X" with subsequent laps from a named pilot on the same kart.
 * The timing system sometimes shows "Карт X" for the first few laps before the real name appears.
 */
export function mergePilotNames<T extends { pilot: string; kart: number }>(laps: T[]): T[] {
  const kartToPilot = new Map<number, string>();

  for (const l of laps) {
    if (!l.pilot.startsWith('Карт ')) {
      kartToPilot.set(l.kart, l.pilot);
    }
  }

  return laps.map(l => {
    if (l.pilot.startsWith('Карт ') && kartToPilot.has(l.kart)) {
      return { ...l, pilot: kartToPilot.get(l.kart)! };
    }
    return l;
  });
}

/**
 * Compute race start positions from qualifying or previous race results.
 * LL/CL: sequential block split, reverse start order (last in quali starts first).
 * Sprint: snake split (reversed when uneven), direct start order, each race uses its own qualifying.
 */
export async function fetchRaceStartPositions(
  collectorUrl: string,
  competitionId: string,
  currentPhase: string,
  format: string,
): Promise<{ positions: Map<string, number>; totalQualified: number }> {
  const result = new Map<string, number>();
  const raceMatch = currentPhase.match(/^race_(\d+)_group_(\d+)$/);
  const finalMatch = !raceMatch ? currentPhase.match(/^final_group_(\d+)$/) : null;
  if (!raceMatch && !finalMatch) return { positions: result, totalQualified: 0 };

  const raceNum = raceMatch ? parseInt(raceMatch[1]) : 3;
  const groupNum = raceMatch ? parseInt(raceMatch[2]) : parseInt(finalMatch![1]);
  const isSprint = format === 'sprint';

  try {
    const comp = await fetch(`${collectorUrl}/competitions/${encodeURIComponent(competitionId)}`).then(r => r.json());
    const sessions: { sessionId: string; phase: string }[] =
      typeof comp.sessions === 'string' ? JSON.parse(comp.sessions) : comp.sessions;
    const rawResults = typeof comp.results === 'string' ? JSON.parse(comp.results) : comp.results;
    const excluded = new Set<string>(rawResults?.excludedPilots || []);
    const excludedLapKeys = new Set<string>(rawResults?.excludedLaps || []);

    let sourcePhasePrefix: string;
    if (isSprint) {
      sourcePhasePrefix = `qualifying_${raceNum}_`;
    } else if (raceNum === 1) {
      sourcePhasePrefix = 'qualifying';
    } else {
      sourcePhasePrefix = `race_${raceNum - 1}_`;
    }

    const sourceSessions = sessions.filter(s => s.phase.startsWith(sourcePhasePrefix));
    const pilotBest = new Map<string, number>();
    for (const ss of sourceSessions) {
      const laps: { pilot: string; lap_time: string | null; ts: number }[] =
        await fetch(`${collectorUrl}/db/laps?session=${ss.sessionId}`).then(r => r.json()).catch(() => []);
      for (const l of laps) {
        if (!l.lap_time || excluded.has(l.pilot)) continue;
        if (excludedLapKeys.has(`${ss.sessionId}|${l.pilot}|${l.ts}`)) continue;
        const sec = parseTime(l.lap_time);
        if (sec === null || sec < 38) continue;
        const prev = pilotBest.get(l.pilot);
        if (prev === undefined || sec < prev) pilotBest.set(l.pilot, sec);
      }
    }

    const sorted = [...pilotBest.entries()].sort((a, b) => a[1] - b[1]);
    const maxQualified = format === 'champions_league' ? 24 : 36;
    const qualified = sorted.slice(0, maxQualified).map(([p]) => p);
    const n = qualified.length;

    if (isSprint) {
      if (finalMatch) {
        const getSprintPosPoints = (pos: number) => {
          if (pos < 1) return 0;
          if (pos === 1) return 40;
          if (pos === 2) return 37;
          return Math.max(35 - (pos - 3) * 2, 0);
        };

        const fetchLapsForPhase = async (prefix: string) => {
          const phaseSessions = sessions.filter(s => s.phase.startsWith(prefix));
          const allLaps: { pilot: string; lap_time: string; ts: number; group: number }[] = [];
          for (const ss of phaseSessions) {
            const gMatch = ss.phase.match(/group_(\d+)/);
            const gNum = gMatch ? parseInt(gMatch[1]) : 0;
            const laps: { pilot: string; lap_time: string | null; ts: number; position?: number }[] =
              await fetch(`${collectorUrl}/db/laps?session=${ss.sessionId}`).then(r => r.json()).catch(() => []);
            for (const l of laps) {
              if (!l.lap_time || excluded.has(l.pilot)) continue;
              if (excludedLapKeys.has(`${ss.sessionId}|${l.pilot}|${l.ts}`)) continue;
              const sec = parseTime(l.lap_time);
              if (sec === null || sec < 38) continue;
              allLaps.push({ pilot: l.pilot, lap_time: l.lap_time, ts: l.ts, group: gNum });
            }
          }
          return allLaps;
        };

        const q1Laps = await fetchLapsForPhase('qualifying_1_');
        const q2Laps = await fetchLapsForPhase('qualifying_2_');
        const r1Laps = await fetchLapsForPhase('race_1_');
        const r2Laps = await fetchLapsForPhase('race_2_');

        const bestTimeByPilot = (laps: typeof q1Laps) => {
          const map = new Map<string, number>();
          for (const l of laps) {
            const sec = parseTime(l.lap_time);
            if (sec === null) continue;
            const ex = map.get(l.pilot);
            if (!ex || sec < ex) map.set(l.pilot, sec);
          }
          return map;
        };

        const q1Best = bestTimeByPilot(q1Laps);
        const q2Best = bestTimeByPilot(q2Laps);

        const raceFinish = (laps: typeof r1Laps) => {
          const byGroup = new Map<number, Map<string, { lapCount: number; lastPos: number; lastTs: number; bestTime: number }>>();
          for (const l of laps) {
            const sec = parseTime(l.lap_time);
            if (sec === null) continue;
            let gMap = byGroup.get(l.group);
            if (!gMap) { gMap = new Map(); byGroup.set(l.group, gMap); }
            const ex = gMap.get(l.pilot);
            if (!ex) {
              gMap.set(l.pilot, { lapCount: 1, lastPos: 99, lastTs: l.ts, bestTime: sec });
            } else {
              ex.lapCount++;
              if (l.ts > ex.lastTs) ex.lastTs = l.ts;
              if (sec < ex.bestTime) ex.bestTime = sec;
            }
          }
          const finishMap = new Map<string, { finishPos: number; group: number; bestTime: number }>();
          for (const [group, pilots] of byGroup) {
            const arr = [...pilots.entries()].sort((a, b) => {
              if (a[1].lapCount !== b[1].lapCount) return b[1].lapCount - a[1].lapCount;
              return a[1].lastTs - b[1].lastTs;
            });
            arr.forEach(([pilot, data], i) => finishMap.set(pilot, { finishPos: i + 1, group, bestTime: data.bestTime }));
          }
          return finishMap;
        };

        const r1Finish = raceFinish(r1Laps);
        const r2Finish = raceFinish(r2Laps);

        const speedForRace = (finishData: Map<string, { finishPos: number; group: number; bestTime: number }>) => {
          const groups = new Map<number, { pilot: string; time: number }[]>();
          for (const [pilot, d] of finishData) {
            let arr = groups.get(d.group);
            if (!arr) { arr = []; groups.set(d.group, arr); }
            arr.push({ pilot, time: d.bestTime });
          }
          const speedMap = new Map<string, number>();
          for (const [, pilots] of groups) {
            pilots.sort((a, b) => a.time - b.time);
            if (pilots.length > 0) speedMap.set(pilots[0].pilot, 1);
          }
          return speedMap;
        };

        const r1Speed = speedForRace(r1Finish);
        const r2Speed = speedForRace(r2Finish);

        const q1Sorted = [...q1Best.entries()].sort((a, b) => a[1] - b[1]);
        const q1Fastest = q1Sorted.length > 0 ? q1Sorted[0][0] : null;
        const q2Sorted = [...q2Best.entries()].sort((a, b) => a[1] - b[1]);
        const q2Fastest = q2Sorted.length > 0 ? q2Sorted[0][0] : null;

        const allPilots = new Set([...q1Best.keys(), ...q2Best.keys()]);
        const pointsMap = new Map<string, number>();
        for (const pilot of allPilots) {
          if (excluded.has(pilot)) continue;
          let pts = 0;
          if (pilot === q1Fastest) pts += 1;
          if (pilot === q2Fastest) pts += 1;
          const r1 = r1Finish.get(pilot);
          if (r1) pts += getSprintPosPoints(r1.finishPos) + (r1Speed.get(pilot) || 0);
          const r2 = r2Finish.get(pilot);
          if (r2) pts += getSprintPosPoints(r2.finishPos) + (r2Speed.get(pilot) || 0);
          pointsMap.set(pilot, pts);
        }

        const sortedPilots = [...pointsMap.entries()]
          .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return (q1Best.get(a[0]) ?? Infinity) - (q1Best.get(b[0]) ?? Infinity);
          });

        const totalN = sortedPilots.length;
        let gc = totalN <= 14 ? 1 : totalN <= 29 ? 2 : 3;
        const bSize = Math.floor(totalN / gc);
        let rem = totalN % gc;
        let bIdx = 0;
        for (let g = 0; g < gc; g++) {
          const size = bSize + (rem > 0 ? 1 : 0);
          if (rem > 0) rem--;
          if (g + 1 === groupNum) {
            const gPilots = sortedPilots.slice(bIdx, bIdx + size);
            gPilots.forEach(([p], pi) => { result.set(p, pi + 1); });
            break;
          }
          bIdx += size;
        }
        return { positions: result, totalQualified: totalN };
      }

      let groupCount: number;
      if (n <= 14) groupCount = 1;
      else if (n <= 29) groupCount = 2;
      else groupCount = 3;

      const reversed = n % groupCount !== 0;
      const buckets: string[][] = Array.from({ length: groupCount }, () => []);
      for (let i = 0; i < n; i++) {
        const gi = reversed ? (groupCount - 1) - (i % groupCount) : i % groupCount;
        buckets[gi].push(qualified[i]);
      }

      const groupPilots = buckets[groupNum - 1] || [];
      groupPilots.forEach((p, pi) => {
        result.set(p, pi + 1);
      });
      return { positions: result, totalQualified: n };
    }

    const maxGroups = format === 'champions_league' ? 2 : 3;
    let groupCount: number;
    if (maxGroups >= 3) {
      if (n <= 13) groupCount = 1;
      else if (n <= 26) groupCount = 2;
      else groupCount = 3;
    } else {
      if (n <= 13) groupCount = 1;
      else groupCount = 2;
    }

    const baseSize = Math.floor(n / groupCount);
    let remainder = n % groupCount;
    let idx = 0;
    for (let g = 0; g < groupCount; g++) {
      const size = baseSize + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      if (g + 1 === groupNum) {
        const groupPilots = qualified.slice(idx, idx + size);
        groupPilots.forEach((p, pi) => {
          result.set(p, groupPilots.length - pi);
        });
        break;
      }
      idx += size;
    }
    return { positions: result, totalQualified: qualified.length };
  } catch { /* ignore */ }

  return { positions: result, totalQualified: 0 };
}

const MIN_SESSION_DURATION_MS = 180000;

export function isValidSession(session: { end_time?: number | null; start_time?: number; end_time_ms?: number | null; start_time_ms?: number }): boolean {
  const start = session.start_time ?? session.start_time_ms ?? 0;
  const end = session.end_time ?? session.end_time_ms ?? null;
  if (!end) return true;
  return (end - start) >= MIN_SESSION_DURATION_MS;
}
