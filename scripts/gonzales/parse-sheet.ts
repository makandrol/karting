/**
 * Парсер офіційної таблиці Швидкого Гонзалеса → `pilotStartSlots` + `slotOrder`.
 *
 * Формат вкладки (одна вкладка = одне змагання):
 *   r1  A: "Швидкий Гонзалес DD.MM.YYYY конфіг N"
 *   hdr row:  D:<карт> E:"Місце"  F:<карт> G:"Місце"  ...   (12 пар)
 *   pilot rows: A:№  B:<Пілот>  далі пари (час, місце) під кожним картом
 *
 * Стартова позиція пілота позначена ЖОВТОЮ заливкою (FFFF00) — рівно одна на пілота:
 *   - жовта клітинка ЧАСУ (колонка карта)  → пілот стартував з цього карта;
 *   - жовта клітинка МІСЦЯ (колонка справа) → пілот стартував з ПРОПУСКУ, що стоїть
 *     у ротації одразу ПІСЛЯ цього карта (у нього немає часу на цьому карті в 1-му раунді).
 *
 * З цього відновлюється:
 *   1. slotOrder — повний ротаційний ланцюг: карти в порядку заголовка з `null`
 *      (пропуском), вставленим після кожного карта, у чиїй колонці «Місце» є жовта мітка.
 *   2. pilotStartSlots — pilot → 0-based індекс у цьому ланцюзі.
 *
 * Модель перевірена на реальних колах з БД: 27.07 → 225/226 клітинок,
 * а на 20.07/06.07/13.07 — 100% після врахування зсуву лінкування раундів.
 */
import { colNameOf, type XlsxSheet } from './xlsx';

/** Жовтий маркер стартової позиції в таблиці. */
const YELLOW = 'FFFF00';

export interface GonzalesSheetData {
  /** Заголовок вкладки (A1), напр. "Швидкий Гонзалес 27.07.2026 конфіг 4R". */
  title: string | null;
  /** Дата з заголовка у форматі `YYYY-MM-DD`, якщо вдалось розпізнати. */
  date: string | null;
  /** Номери картів у порядку колонок заголовка. */
  karts: number[];
  /** Імена пілотів у порядку рядків таблиці. */
  pilots: string[];
  /** Ротаційний ланцюг: номер карта або `null` для пропуску. */
  slotOrder: (number | null)[];
  /** Пілот → 0-based стартовий слот у `slotOrder`. */
  pilotStartSlots: Record<string, number>;
  /** Пілот → карт → час кола з таблиці (для валідації). */
  sheetTimes: Map<string, Map<number, number>>;
  /**
   * Заміни картів: карт у БД (новий) → карт у таблиці (старий).
   *
   * Організатор інколи посеред змагання підміняє зламаний карт іншим, а в
   * таблиці лишає стару колонку, надписавши новий номер у рядку над
   * заголовком (напр. 27.07: над колонкою карта 18 стоїть 69 — з 18-го
   * раунду їздили на 69-му). Формат навмисне такий, як очікує
   * `effectiveKart` у `scoring.ts`: `kartReplacements[lap.kart] ?? lap.kart`.
   */
  kartReplacements: Record<number, number>;
  /** Пілоти без жовтої мітки (аномалія — треба глянути вручну). */
  unmarked: string[];
  /** Пілоти з більш ніж однією жовтою міткою (аномалія). */
  multiMarked: string[];
}

/**
 * Дата вкладки у форматі `YYYY-MM-DD`.
 *
 * Назва вкладки надійніша за заголовок A1: у книзі є вкладки, скопійовані з
 * попередніх тижнів, де заголовок забули оновити («20.04.26» з титулом
 * «...24.03.2025»). Тому спершу пробуємо назву, і лише потім заголовок.
 * Рік у назві може бути відсутній — беремо його із заголовка або з поточного.
 */
function resolveDate(sheetName: string, title: string | null): string | null {
  const titleMatch = title?.match(/(\d{1,2})[.,\\](\d{1,2})[.,\\]?(\d{2,4})?/);
  const titleYear = titleMatch?.[3];

  const fromName = sheetName.match(/^(\d{1,2})[.,](\d{1,2})(?:[.,](\d{2,4}))?/);
  if (fromName) {
    const [, d, mo, y] = fromName;
    const rawYear = y || titleYear || String(new Date().getFullYear());
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  if (titleMatch) {
    const [, d, mo, y] = titleMatch;
    if (!y) return null;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Чи схожа вкладка на таблицю Гонзалеса (має рядок-заголовок з колонками «Місце»).
 * Порожні шаблони («17 чел», «форма») повертають false.
 */
export function isGonzalesSheet(sheet: XlsxSheet): boolean {
  try {
    const parsed = parseGonzalesSheet(sheet);
    return parsed.pilots.length > 0 && parsed.karts.length > 0;
  } catch {
    return false;
  }
}

export function parseGonzalesSheet(sheet: XlsxSheet): GonzalesSheetData {
  const { cells } = sheet;

  // 1. Рядок-заголовок = той, де найбільше клітинок "Місце".
  const placeCountByRow = new Map<number, number>();
  for (const c of cells.values()) {
    if (typeof c.value === 'string' && c.value.trim() === 'Місце') {
      placeCountByRow.set(c.row, (placeCountByRow.get(c.row) || 0) + 1);
    }
  }
  if (placeCountByRow.size === 0) throw new Error('не знайдено рядок-заголовок з колонками "Місце"');
  const headerRow = [...placeCountByRow.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // 2. Колонки картів — ліва сусідка кожної колонки "Місце".
  const kartCols: number[] = [];
  for (const c of cells.values()) {
    if (c.row === headerRow && typeof c.value === 'string' && c.value.trim() === 'Місце') kartCols.push(c.col - 1);
  }
  kartCols.sort((a, b) => a - b);

  const karts: number[] = [];
  for (const col of kartCols) {
    const c = cells.get(`${colNameOf(col)}${headerRow}`);
    const n = c?.value != null ? Math.round(parseFloat(c.value)) : NaN;
    if (Number.isNaN(n)) throw new Error(`не розпізнано номер карта у колонці ${colNameOf(col)}${headerRow}`);
    karts.push(n);
  }

  // 3. Рядки пілотів — колонка B під заголовком, до підсумкових рядків ("Среднее ...").
  const pilotRows: { row: number; name: string }[] = [];
  for (const c of cells.values()) {
    if (c.col !== 2 || c.row <= headerRow) continue;
    const name = typeof c.value === 'string' ? c.value.trim() : '';
    if (!name || /^Сред/i.test(name)) continue;
    pilotRows.push({ row: c.row, name });
  }
  pilotRows.sort((a, b) => a.row - b.row);

  // 4. Жовті мітки → де стартував кожен пілот.
  type Mark = { kind: 'kart' | 'skip'; kartIdx: number };
  const marks = new Map<string, Mark>();
  const unmarked: string[] = [];
  const multiMarked: string[] = [];
  const skipAfterKartIdx = new Set<number>();

  for (const p of pilotRows) {
    const found: Mark[] = [];
    for (let i = 0; i < kartCols.length; i++) {
      const timeCell = cells.get(`${colNameOf(kartCols[i])}${p.row}`);
      const placeCell = cells.get(`${colNameOf(kartCols[i] + 1)}${p.row}`);
      if (timeCell?.fill === YELLOW) found.push({ kind: 'kart', kartIdx: i });
      if (placeCell?.fill === YELLOW) found.push({ kind: 'skip', kartIdx: i });
    }
    if (found.length === 0) { unmarked.push(p.name); continue; }
    if (found.length > 1) multiMarked.push(p.name);
    const mark = found[found.length - 1];
    marks.set(p.name, mark);
    if (mark.kind === 'skip') skipAfterKartIdx.add(mark.kartIdx);
  }

  // 5. Ротаційний ланцюг: карти в порядку заголовка + пропуски після помічених картів.
  const slotOrder: (number | null)[] = [];
  const slotMeta: Mark[] = [];
  for (let i = 0; i < karts.length; i++) {
    slotOrder.push(karts[i]);
    slotMeta.push({ kind: 'kart', kartIdx: i });
    if (skipAfterKartIdx.has(i)) {
      slotOrder.push(null);
      slotMeta.push({ kind: 'skip', kartIdx: i });
    }
  }

  const pilotStartSlots: Record<string, number> = {};
  for (const [pilot, mark] of marks) {
    const idx = slotMeta.findIndex(s => s.kind === mark.kind && s.kartIdx === mark.kartIdx);
    if (idx >= 0) pilotStartSlots[pilot] = idx;
  }

  // 6. Часи кіл з таблиці (для валідації проти БД).
  const sheetTimes = new Map<string, Map<number, number>>();
  for (const p of pilotRows) {
    const row = new Map<number, number>();
    for (let i = 0; i < kartCols.length; i++) {
      const c = cells.get(`${colNameOf(kartCols[i])}${p.row}`);
      const v = c?.value != null ? parseFloat(c.value) : NaN;
      if (!Number.isNaN(v)) row.set(karts[i], v);
    }
    sheetTimes.set(p.name, row);
  }

  // 7. Заміни картів — число в колонці карта, у рядках МІЖ титулом і заголовком.
  //    Колонки поза картами (напр. C — к-сть пілотів) навмисно ігноруємо.
  const kartReplacements: Record<number, number> = {};
  for (let row = 2; row < headerRow; row++) {
    for (let i = 0; i < kartCols.length; i++) {
      const c = cells.get(`${colNameOf(kartCols[i])}${row}`);
      if (!c || c.value == null) continue;
      const replacement = Math.round(parseFloat(c.value));
      if (Number.isNaN(replacement) || replacement === karts[i]) continue;
      kartReplacements[replacement] = karts[i];
    }
  }

  const title = (cells.get('A1')?.value ?? null) as string | null;
  return {
    title,
    date: resolveDate(sheet.name, title),
    karts,
    pilots: pilotRows.map(p => p.name),
    slotOrder,
    pilotStartSlots,
    sheetTimes,
    kartReplacements,
    unmarked,
    multiMarked,
  };
}

/** Людський опис слоту: "Карт 20" / "Пропуск 3". */
export function slotLabel(slotOrder: (number | null)[], idx: number): string {
  const kart = slotOrder[idx];
  if (kart !== null) return `Карт ${kart}`;
  let n = 0;
  for (let i = 0; i <= idx; i++) if (slotOrder[i] === null) n++;
  return `Пропуск ${n}`;
}
