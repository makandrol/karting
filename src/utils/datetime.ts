/**
 * Date / time / duration formatting helpers (Ukrainian locale).
 *
 * Replaces 8+ duplicated copies that lived in pages and components.
 */

/** Format ms timestamp as "HH:mm:ss" (24-hour, Ukrainian locale). */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format ms timestamp as "HH:mm" (24-hour, no seconds). */
export function fmtTimeShort(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

/** Format Date as "YYYY-MM-DD" (local time, not UTC). */
export function fmtDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Format ms timestamp as "DD.MM" (short date). */
export function fmtDateDM(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

/** Format ms timestamp as "DD.MM, HH:mm:ss". */
export function fmtDateTime(ms: number): string {
  return `${fmtDateDM(ms)}, ${fmtTime(ms)}`;
}

/** Format ms timestamp as "DD.MM, HH:mm" (short — no seconds). */
export function fmtDateTimeShort(ms: number): string {
  return `${fmtDateDM(ms)}, ${fmtTimeShort(ms)}`;
}

/** Format ms timestamp as full "DD.MM.YYYY HH:mm:ss". */
export function fmtDateTimeFull(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${date} ${fmtTime(ms)}`;
}

interface DurationOptions {
  /** Returned when endMs is null/undefined. Default: '—' */
  whenActive?: string;
  /** Returned when both timestamps are 0/identical. */
  whenZero?: string;
}

/** Format duration between two unix-ms timestamps as "Xхв Yс" or "Yс". */
export function fmtDuration(startMs: number, endMs: number | null | undefined, opts: DurationOptions = {}): string {
  if (endMs == null) return opts.whenActive ?? '—';
  const sec = Math.round((endMs - startMs) / 1000);
  if (sec === 0 && opts.whenZero) return opts.whenZero;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}с`;
  return `${m}хв ${s}с`;
}

/** Format a duration in milliseconds (single arg) as "Xхв Yс". */
export function fmtDurationMs(ms: number): string {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}хв ${s}с` : `${s}с`;
}

const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** Format date string "YYYY-MM-DD" as friendly Ukrainian label ("Сьогодні", "Вчора", "Пн 04.04.2026"). */
export function fmtDateLabel(dateStr: string): string {
  const now = new Date();
  const todayStr = fmtDateISO(now);
  if (dateStr === todayStr) return 'Сьогодні';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === fmtDateISO(yesterday)) return 'Вчора';
  const d = new Date(dateStr + 'T00:00:00');
  return `${DAY_NAMES[d.getDay()]} ${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

/** Format Date as friendly Ukrainian label (for components that operate on Date). */
export function fmtDateLabelDate(date: Date): string {
  return fmtDateLabel(fmtDateISO(date));
}
