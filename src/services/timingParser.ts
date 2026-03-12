import type { TimingEntry } from '../types';

/**
 * Парсер табло timing.karting.ua/board.html
 *
 * Коли сайт працює, HTML містить таблицю з результатами.
 * Ця функція парсить HTML і повертає масив TimingEntry.
 *
 * TODO: Коли картодром запрацює, потрібно буде:
 * 1. Перевірити реальну структуру HTML
 * 2. Налаштувати CSS селектори
 * 3. Можливо додати обробку WebSocket якщо сайт використовує його
 */

const TIMING_URL = 'https://timing.karting.ua/board.html';

/**
 * Парсить HTML з сайту таймінгу і повертає масив записів.
 * Наразі це заглушка — повертає null, сигналізуючи що парсинг не вдався.
 */
export function parseTimingHTML(html: string): TimingEntry[] | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Шукаємо таблицю з результатами
    // TODO: оновити селектори коли побачимо реальну структуру
    const rows = doc.querySelectorAll('table tbody tr');

    if (rows.length === 0) {
      return null;
    }

    const entries: TimingEntry[] = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) return;

      entries.push({
        position: parseInt(cells[0]?.textContent?.trim() || '0', 10),
        pilot: cells[1]?.textContent?.trim() || '',
        kart: parseInt(cells[2]?.textContent?.trim() || '0', 10),
        lastLap: cells[3]?.textContent?.trim() || null,
        s1: cells[4]?.textContent?.trim() || null,
        s2: cells[5]?.textContent?.trim() || null,
        bestLap: cells[6]?.textContent?.trim() || null,
        lapNumber: parseInt(cells[7]?.textContent?.trim() || '0', 10),
        // best sectors ми зберігатимемо окремо
        bestS1: null,
        bestS2: null,
      });
    });

    return entries.length > 0 ? entries : null;
  } catch {
    console.error('Failed to parse timing HTML');
    return null;
  }
}

/**
 * Fetches timing data from the real timing website.
 * Returns null if the site is not available.
 */
export async function fetchTimingFromSite(): Promise<TimingEntry[] | null> {
  try {
    const response = await fetch(TIMING_URL, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    return parseTimingHTML(html);
  } catch {
    // Site is down or CORS blocked — expected during off-hours
    return null;
  }
}

/**
 * Tracks best sector times across polling cycles.
 * Call this after each snapshot to update best sectors.
 */
export function updateBestSectors(
  entries: TimingEntry[],
  bestSectors: Map<string, { bestS1: string | null; bestS2: string | null }>
): TimingEntry[] {
  return entries.map((entry) => {
    const key = entry.pilot;
    const prev = bestSectors.get(key) || { bestS1: null, bestS2: null };

    const bestS1 = getBetterTime(prev.bestS1, entry.s1);
    const bestS2 = getBetterTime(prev.bestS2, entry.s2);

    bestSectors.set(key, { bestS1, bestS2 });

    return { ...entry, bestS1, bestS2 };
  });
}

function getBetterTime(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;

  const a = parseFloat(current);
  const b = parseFloat(candidate);

  return b < a ? candidate : current;
}
