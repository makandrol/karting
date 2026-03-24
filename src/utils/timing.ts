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
