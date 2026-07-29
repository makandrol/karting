import { describe, it, expect } from 'vitest';
import { parseGonzalesSheet, slotLabel } from './parse-sheet';
import { colNameOf, type XlsxCell, type XlsxSheet } from './xlsx';

const YELLOW = 'FFFF00';

/**
 * Будує синтетичну вкладку у форматі таблиці Гонзалеса.
 *
 * `starts` — для кожного пілота: `{ kart }` (стартував з карта) або
 * `{ skipAfterKart }` (стартував із пропуску після вказаного карта).
 */
function makeSheet(opts: {
  name?: string;
  title?: string;
  karts: number[];
  pilots: { name: string; kart?: number; skipAfterKart?: number }[];
}): XlsxSheet {
  const cells = new Map<string, XlsxCell>();
  const set = (col: number, row: number, value: string | null, fill: string | null = null) => {
    cells.set(`${colNameOf(col)}${row}`, { row, col, value, fill });
  };

  set(1, 1, opts.title ?? 'Швидкий Гонзалес 27.07.2026 конфіг 4R');

  // Заголовок: пари (карт, "Місце") починаючи з колонки D (4).
  const headerRow = 4;
  const kartColOf = (i: number) => 4 + i * 2;
  set(3, headerRow, 'Дод Вага');
  opts.karts.forEach((k, i) => {
    set(kartColOf(i), headerRow, String(k));
    set(kartColOf(i) + 1, headerRow, 'Місце');
  });

  opts.pilots.forEach((p, pi) => {
    const row = headerRow + 1 + pi;
    set(1, row, String(pi + 1));
    set(2, row, p.name);
    opts.karts.forEach((k, i) => {
      const isStartKart = p.kart === k;
      const isSkipAfter = p.skipAfterKart === k;
      set(kartColOf(i), row, (42 + i * 0.1).toFixed(3), isStartKart ? YELLOW : null);
      set(kartColOf(i) + 1, row, String(i + 1), isSkipAfter ? YELLOW : null);
    });
  });

  // Підсумковий рядок має ігноруватись.
  set(1, headerRow + 1 + opts.pilots.length, 'Среднее время первых лучших');

  return { name: opts.name ?? '27.07.26', cells };
}

describe('parseGonzalesSheet', () => {
  it('читає карти, пілотів і стартові карти без пропусків', () => {
    const sheet = makeSheet({
      karts: [15, 16, 17],
      pilots: [
        { name: 'Овчарук Антон', kart: 16 },
        { name: 'Ковшар Климентій', kart: 15 },
        { name: 'Маніло Денис', kart: 17 },
      ],
    });
    const d = parseGonzalesSheet(sheet);

    expect(d.karts).toEqual([15, 16, 17]);
    expect(d.pilots).toEqual(['Овчарук Антон', 'Ковшар Климентій', 'Маніло Денис']);
    expect(d.slotOrder).toEqual([15, 16, 17]);
    expect(d.pilotStartSlots).toEqual({
      'Овчарук Антон': 1,
      'Ковшар Климентій': 0,
      'Маніло Денис': 2,
    });
    expect(d.unmarked).toEqual([]);
  });

  it('вставляє пропуск після карта, у чиїй колонці «Місце» стоїть жовта мітка', () => {
    const sheet = makeSheet({
      karts: [15, 16, 17],
      pilots: [
        { name: 'A', kart: 15 },
        { name: 'B', skipAfterKart: 15 },
        { name: 'C', kart: 16 },
        { name: 'D', kart: 17 },
        { name: 'E', skipAfterKart: 17 },
      ],
    });
    const d = parseGonzalesSheet(sheet);

    expect(d.slotOrder).toEqual([15, null, 16, 17, null]);
    expect(d.pilotStartSlots).toEqual({ A: 0, B: 1, C: 2, D: 3, E: 4 });
  });

  it('кількість слотів дорівнює кількості пілотів, коли пілотів більше за карти', () => {
    const sheet = makeSheet({
      karts: [1, 2, 3, 4],
      pilots: [
        { name: 'A', kart: 1 },
        { name: 'B', skipAfterKart: 1 },
        { name: 'C', kart: 2 },
        { name: 'D', kart: 3 },
        { name: 'E', skipAfterKart: 3 },
        { name: 'F', kart: 4 },
      ],
    });
    const d = parseGonzalesSheet(sheet);

    expect(d.slotOrder).toHaveLength(6);
    expect(d.slotOrder.filter(v => v === null)).toHaveLength(2);
    expect(new Set(Object.values(d.pilotStartSlots)).size).toBe(6);
  });

  it('повідомляє про пілотів без жовтої мітки', () => {
    const sheet = makeSheet({
      karts: [1, 2],
      pilots: [{ name: 'A', kart: 1 }, { name: 'Без мітки' }],
    });
    const d = parseGonzalesSheet(sheet);

    expect(d.unmarked).toEqual(['Без мітки']);
    expect(d.pilotStartSlots).toEqual({ A: 0 });
  });

  it('бере дату з назви вкладки, а не з застарілого заголовка', () => {
    const sheet = makeSheet({
      name: '20.04.26',
      title: 'Швидкий Гонзалес 24.03.2025 конфіг 2',
      karts: [1],
      pilots: [{ name: 'A', kart: 1 }],
    });
    expect(parseGonzalesSheet(sheet).date).toBe('2026-04-20');
  });

  it('добирає рік із заголовка, якщо в назві вкладки його немає', () => {
    const sheet = makeSheet({
      name: '20.07',
      title: 'Швидкий Гонзалес 20.07.2026 конфіг 3',
      karts: [1],
      pilots: [{ name: 'A', kart: 1 }],
    });
    expect(parseGonzalesSheet(sheet).date).toBe('2026-07-20');
  });

  it('кидає помилку на вкладці без рядка-заголовка', () => {
    const cells = new Map<string, XlsxCell>();
    cells.set('A1', { row: 1, col: 1, value: 'Порожній шаблон', fill: null });
    expect(() => parseGonzalesSheet({ name: 'форма', cells })).toThrow(/Місце/);
  });
});

describe('slotLabel', () => {
  it('нумерує пропуски по порядку', () => {
    const slots = [15, null, 16, 17, null];
    expect(slotLabel(slots, 0)).toBe('Карт 15');
    expect(slotLabel(slots, 1)).toBe('Пропуск 1');
    expect(slotLabel(slots, 3)).toBe('Карт 17');
    expect(slotLabel(slots, 4)).toBe('Пропуск 2');
  });
});
