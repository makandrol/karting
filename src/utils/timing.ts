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
  if (pb !== null && Math.abs(val - pb) < 0.002) return 'green';
  if (pb !== null && val > pb) return 'yellow';
  if (overallBest !== null && val <= overallBest + 0.002) return 'purple';
  return 'green';
}

export const COLOR_CLASSES: Record<TimeColor, string> = {
  purple: 'text-purple-400',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  none: 'text-dark-500',
};

/** "Апанасенко Олексій" → "Апанасенко О." */
export function shortName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1][0]}.`;
}

/** Format bytes to human readable string */
export function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
