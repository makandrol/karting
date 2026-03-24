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
 * Returns Map<pilot, position_within_group> (reverse order = last in quali starts first).
 */
export async function fetchRaceStartPositions(
  collectorUrl: string,
  competitionId: string,
  currentPhase: string,
  format: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const raceMatch = currentPhase.match(/^race_(\d+)_group_(\d+)$/);
  if (!raceMatch) return result;

  const raceNum = parseInt(raceMatch[1]);
  const groupNum = parseInt(raceMatch[2]);

  try {
    const comp = await fetch(`${collectorUrl}/competitions/${encodeURIComponent(competitionId)}`).then(r => r.json());
    const sessions: { sessionId: string; phase: string }[] =
      typeof comp.sessions === 'string' ? JSON.parse(comp.sessions) : comp.sessions;
    const rawResults = typeof comp.results === 'string' ? JSON.parse(comp.results) : comp.results;
    const excluded = new Set<string>(rawResults?.excludedPilots || []);

    let sourcePhasePrefix: string;
    if (raceNum === 1) {
      sourcePhasePrefix = 'qualifying';
    } else {
      sourcePhasePrefix = `race_${raceNum - 1}_`;
    }

    const sourceSessions = sessions.filter(s => s.phase.startsWith(sourcePhasePrefix));
    const pilotBest = new Map<string, number>();
    for (const ss of sourceSessions) {
      const laps: { pilot: string; lap_time: string | null }[] =
        await fetch(`${collectorUrl}/db/laps?session=${ss.sessionId}`).then(r => r.json()).catch(() => []);
      for (const l of laps) {
        if (!l.lap_time || excluded.has(l.pilot)) continue;
        const sec = parseTime(l.lap_time);
        if (sec === null || sec < 38) continue;
        const prev = pilotBest.get(l.pilot);
        if (prev === undefined || sec < prev) pilotBest.set(l.pilot, sec);
      }
    }

    const sorted = [...pilotBest.entries()].sort((a, b) => a[1] - b[1]);
    const maxQualified = format === 'champions_league' ? 24 : 36;
    const qualified = sorted.slice(0, maxQualified).map(([p]) => p);

    const maxGroups = format === 'champions_league' ? 2 : 3;
    const n = qualified.length;
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
  } catch { /* ignore */ }

  return result;
}
