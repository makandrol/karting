/**
 * Парсер HTML з timing.karting.ua/board.html
 *
 * Повертає масив записів з табла.
 * TODO: оновити селектори коли побачимо реальну структуру HTML.
 */

import { parse } from 'node-html-parser';

/**
 * @param {string} html
 * @returns {Array<{position: number, pilot: string, kart: number, lastLap: string|null, s1: string|null, s2: string|null, bestLap: string|null, lapNumber: number}>|null}
 */
export function parseTimingHtml(html) {
  try {
    const root = parse(html);
    const rows = root.querySelectorAll('table tbody tr');

    if (!rows.length) return null;

    const entries = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) continue;

      const getText = (idx) => cells[idx]?.textContent?.trim() || '';

      const position = parseInt(getText(0)) || 0;
      const pilot = getText(1);
      const kart = parseInt(getText(2)) || 0;
      const lastLap = getText(3) || null;
      const s1 = getText(4) || null;
      const s2 = getText(5) || null;
      const bestLap = getText(6) || null;
      const lapNumber = parseInt(getText(7)) || 0;

      if (!pilot) continue;

      entries.push({
        position, pilot, kart, lastLap, s1, s2, bestLap, lapNumber,
      });
    }

    return entries.length > 0 ? entries : null;
  } catch (err) {
    console.error('Parse error:', err.message);
    return null;
  }
}
