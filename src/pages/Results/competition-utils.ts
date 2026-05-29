/**
 * Date helpers + filter constants + display-name helper for the
 * competition list / detail pages.
 */

import { trackDisplayId } from '../../data/tracks';
import type { Competition } from './competition-types';

export const FORMAT_FILTERS: { key: string; label: string }[] = [
  { key: 'gonzales', label: 'Гонзалес' },
  { key: 'light_league', label: 'ЛЛ' },
  { key: 'champions_league', label: 'ЛЧ' },
  { key: 'sprint', label: 'Спринти' },
  { key: 'marathon', label: 'Марафони' },
];

export const COMP_LIST_NAMES: Record<string, string> = {
  gonzales: 'Гонзалес',
  light_league: 'Лайт ліга',
  champions_league: 'Ліга Чемп',
  sprint: 'Спринт',
  marathon: 'Марафон',
};

export const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const MONTH_NAMES = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get real competition date from first session's timestamp (more accurate than stored date). */
export function getCompRealDate(c: Competition): string {
  if (c.sessions.length > 0) {
    const m = c.sessions[0].sessionId.match(/session-(\d+)/);
    if (m) {
      const d = new Date(parseInt(m[1]));
      return localDateStr(d);
    }
  }
  return c.date || '';
}

/** Monday of the week containing the given date. */
export function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

/** All days of the week starting from `monday`, capped at today. */
export function getWeekDays(monday: Date): string[] {
  const todayStr = localDateStr(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return localDateStr(d);
  }).filter(d => d <= todayStr);
}

/** Weeks of the given month as array of date-string arrays. */
export function getWeeksInMonth(year: number, month: number): string[][] {
  const todayStr = localDateStr(new Date());
  const firstDay = new Date(year, month, 1);
  const monday = getMonday(firstDay);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const weekStart = new Date(monday);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const days = getWeekDays(weekStart).filter(d => {
      const dd = new Date(d + 'T00:00:00');
      return dd.getMonth() === month && d <= todayStr;
    });
    if (days.length > 0) weeks.push(days);
  }
  return weeks;
}

/** Friendly display name for a competition, with track id substituted. */
export function getCompetitionDisplayName(c: Competition): string {
  let name = c.name.replace(/Тр\.\s*/g, 'Траса ');
  if (c.sessions.length > 0) {
    const firstSid = c.sessions[0].sessionId;
    const m = firstSid.match(/session-(\d+)/);
    if (m) {
      const d = new Date(parseInt(m[1]));
      const realDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
      name = name.replace(/\d{2}\.\d{2}\.\d{2}/, realDate);
    }
  }
  const resultsTrackId = (typeof c.results === 'string' ? JSON.parse(c.results) : c.results)?.trackId;
  if (resultsTrackId != null) {
    name = name.replace(/Траса\s*\d+R?/, `Траса ${trackDisplayId(resultsTrackId)}`);
  }
  return name;
}
