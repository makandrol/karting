/**
 * Імпорт стартових слотів Гонзалеса з офіційної Google-таблиці в колектор.
 *
 * Читає жовті мітки з таблиці (див. `parse-sheet.ts`), відновлює `slotOrder`
 * (ланцюг карт + пропуски) та `pilotStartSlots`, ВАЛІДУЄ модель проти реальних
 * кіл у БД (симулює ротацію і зіставляє часи), і лише потім пише
 * `results.gonzalesConfig` через PATCH.
 *
 * DRY-RUN за замовчуванням — без `--apply` нічого не пише.
 *
 * Usage:
 *   npx tsx scripts/gonzales/import-start-slots.ts                       # усі вкладки: звіт
 *   npx tsx scripts/gonzales/import-start-slots.ts 27.07.26              # одна вкладка
 *   npx tsx scripts/gonzales/import-start-slots.ts 27.07.26 --apply      # записати
 *   npx tsx scripts/gonzales/import-start-slots.ts --all --apply         # записати все, що валідне
 *   npx tsx scripts/gonzales/import-start-slots.ts 27.07.26 --force      # писати навіть при низькій точності
 */
import { fetchXlsx, readXlsx, type XlsxSheet } from './xlsx';
import { parseGonzalesSheet, slotLabel, type GonzalesSheetData } from './parse-sheet';

const BOOK_ID = process.env.GONZALES_BOOK_ID || '1CZT-bmDhEQYn_TXvagluKJdEv6rl6uuZ';
const COLLECTOR = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const ALL = args.includes('--all');
const tabArg = args.find(a => !a.startsWith('--')) || null;

/** Мінімальна точність зіставлення з БД, щоб вважати парсинг надійним. */
const MIN_ACCURACY = 0.9;
/** Допуск порівняння часу кола (таблиця тримає 3 знаки). */
const TIME_EPS = 0.0015;
/** Мінімальне валідне коло (як у решті проєкту). */
const MIN_LAP_SEC = 38;

interface CompetitionDto {
  id: string; name: string; format: string; date: string; status: string;
  sessions: { sessionId: string; phase: string | null }[];
  results: any;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${COLLECTOR}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function patchCompetition(id: string, body: unknown): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ADMIN_TOKEN) headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
  const res = await fetch(`${COLLECTOR}/competitions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH /competitions/${id} → ${res.status} ${await res.text().catch(() => '')}`);
}

function parseLapTime(s: unknown): number | null {
  if (s == null) return null;
  const m = String(s).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]) : null;
}

/** Найкращі кола по картах для однієї сесії. */
async function bestByKart(sessionId: string): Promise<Map<number, number>> {
  const raw = await getJson<any>(`/db/laps?session=${encodeURIComponent(sessionId)}`);
  const laps: any[] = Array.isArray(raw) ? raw : (raw.laps || []);
  const best = new Map<number, number>();
  for (const l of laps) {
    const t = parseLapTime(l.lap_time ?? l.lapTime);
    if (t == null || t < MIN_LAP_SEC) continue;
    const k = Number(l.kart);
    if (!best.has(k) || t < best.get(k)!) best.set(k, t);
  }
  return best;
}

interface Validation {
  /** Скільки раундів однозначно зіставилось із якимось кроком ротації. */
  matched: number;
  /** Скільки раундів не зіставилось ні з чим (або замало даних). */
  unmatched: number;
  /** Середня точність по зіставлених раундах (частка збіглих часів). */
  accuracy: number;
  rounds: number;
  /**
   * Раунди, чий крок ротації не дорівнює їхньому номеру — тобто заїзд
   * залінкований не на своє місце (напр. 1-й раунд попав у `qualifying_2`).
   */
  misordered: { phase: string; expected: number; actual: number }[];
}

/** Раунди змагання, відсортовані за номером. Підтримує legacy-фази `round_N_group_M`. */
function roundSessions(comp: CompetitionDto): { sessionId: string; phase: string; num: number }[] {
  return comp.sessions
    .map(s => {
      const m = s.phase?.match(/^round_(\d+)/);
      return m ? { sessionId: s.sessionId, phase: s.phase!, num: +m[1] } : null;
    })
    .filter((s): s is { sessionId: string; phase: string; num: number } => s !== null)
    .sort((a, b) => a.num - b.num);
}

/**
 * Валідація моделі проти реальних кіл у БД.
 *
 * Для КОЖНОГО заїзду окремо шукаємо крок ротації, на якому часи з таблиці
 * сходяться з часами в БД. Пораунднево (а не одним глобальним зсувом) — бо
 * лінкування заїздів до фаз місцями збите (пропущений/дубльований раунд), і
 * глобальний зсув маскував би коректний парсинг як помилку.
 *
 * Якщо кожен заїзд знаходить свій крок із високою точністю — парсинг таблиці
 * правильний. Розходження `expected ≠ actual` — це вже баг лінкування.
 */
async function validate(data: GonzalesSheetData, comp: CompetitionDto): Promise<Validation> {
  const rounds = roundSessions(comp);
  const total = data.slotOrder.length;
  const result: Validation = { matched: 0, unmatched: 0, accuracy: 0, rounds: rounds.length, misordered: [] };
  if (total === 0 || rounds.length === 0) return result;

  const accuracies: number[] = [];

  for (let ri = 0; ri < rounds.length; ri++) {
    const best = await bestByKart(rounds[ri].sessionId).catch(() => new Map<number, number>());

    let bestFit: { step: number; score: number } | null = null;
    for (let step = 0; step < total; step++) {
      let ok = 0, bad = 0;
      for (const [pilot, start] of Object.entries(data.pilotStartSlots)) {
        const kart = data.slotOrder[(start + step) % total];
        if (kart === null) continue;
        const sheetT = data.sheetTimes.get(pilot)?.get(kart);
        const dbT = best.get(kart);
        if (sheetT == null || dbT == null) continue;
        if (Math.abs(sheetT - dbT) < TIME_EPS) ok++; else bad++;
      }
      if (ok + bad < 3) continue;
      const score = ok / (ok + bad);
      if (!bestFit || score > bestFit.score) bestFit = { step, score };
    }

    if (!bestFit || bestFit.score < 0.5) { result.unmatched++; continue; }
    result.matched++;
    accuracies.push(bestFit.score);
    if (bestFit.step !== ri) {
      result.misordered.push({ phase: rounds[ri].phase, expected: ri + 1, actual: bestFit.step + 1 });
    }
  }

  result.accuracy = accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : 0;
  return result;
}

function matchCompetition(comps: CompetitionDto[], data: GonzalesSheetData): CompetitionDto | null {
  if (!data.date) return null;
  return comps.find(c => c.format === 'gonzales' && c.date === data.date)
    // дата змагання може відставати на день (сесії після півночі UTC)
    ?? comps.find(c => {
      if (c.format !== 'gonzales') return false;
      const d = new Date(`${data.date}T00:00:00Z`).getTime();
      const cd = new Date(`${c.date}T00:00:00Z`).getTime();
      return Math.abs(d - cd) <= 86400e3;
    })
    ?? null;
}

async function main() {
  console.log(`Книга: ${BOOK_ID}`);
  console.log(`Колектор: ${COLLECTOR}`);
  console.log(APPLY ? '\n*** РЕЖИМ ЗАПИСУ (--apply) ***\n' : '\n--- DRY-RUN (нічого не пишеться) ---\n');

  const [book, comps] = await Promise.all([
    fetchXlsx(BOOK_ID).then(readXlsx),
    getJson<any[]>('/competitions').then(arr => arr.map(c => ({
      ...c, sessions: Array.isArray(c.sessions) ? c.sessions : JSON.parse(c.sessions || '[]'),
      results: typeof c.results === 'string' ? JSON.parse(c.results || '{}') : (c.results || {}),
    })) as CompetitionDto[]),
  ]);

  const sheets: XlsxSheet[] = tabArg ? book.filter(s => s.name === tabArg) : book;
  if (tabArg && sheets.length === 0) {
    console.log(`Вкладку "${tabArg}" не знайдено. Доступні:\n  ${book.map(s => s.name).join(', ')}`);
    process.exit(1);
  }

  let written = 0, skipped = 0;

  for (const sheet of sheets) {
    let data: GonzalesSheetData;
    try {
      data = parseGonzalesSheet(sheet);
    } catch {
      continue; // не таблиця Гонзалеса (шаблон / форма)
    }
    if (data.pilots.length === 0 || Object.keys(data.pilotStartSlots).length === 0) continue;

    const comp = matchCompetition(comps, data);
    const skips = data.slotOrder.filter(v => v === null).length;

    console.log('─'.repeat(78));
    console.log(`Вкладка "${sheet.name}"  ${data.title || ''}`);
    console.log(`  пілотів=${data.pilots.length}  картів=${data.karts.length}  пропусків=${skips}  слотів=${data.slotOrder.length}`);
    console.log(`  ротація: ${data.slotOrder.map(v => v === null ? '·' : v).join(' → ')}`);
    if (data.unmarked.length) console.log(`  ⚠️  без жовтої мітки: ${data.unmarked.join(', ')}`);
    if (data.multiMarked.length) console.log(`  ⚠️  кілька міток: ${data.multiMarked.join(', ')}`);

    if (!comp) {
      console.log(`  ⚠️  змагання на ${data.date || '?'} не знайдено в колекторі — пропускаю`);
      skipped++;
      continue;
    }
    console.log(`  → ${comp.id} (${comp.name}, ${comp.status})`);

    const v = await validate(data, comp);
    const pct = (v.accuracy * 100).toFixed(1);
    console.log(`  валідація по колах з БД: зіставлено ${v.matched}/${v.rounds} заїздів, точність ${pct}%`);
    if (v.unmatched > 0) {
      console.log(`  ⚠️  ${v.unmatched} заїзд(ів) не зіставлено з жодним кроком ротації`);
    }
    if (v.misordered.length) {
      const shifts = new Set(v.misordered.map(m => m.actual - m.expected));
      if (shifts.size === 1 && v.misordered.length > 2) {
        const shift = [...shifts][0];
        console.log(`  ⚠️  лінкування: ${v.misordered.length} заїздів зсунуто на ${shift > 0 ? '+' : ''}${shift} (перший раунд, схоже, залінкований як qualifying)`);
      } else {
        const list = v.misordered.map(m => `${m.phase}=крок ${m.actual}`).join(', ');
        console.log(`  ⚠️  лінкування збите: ${list}`);
      }
      console.log('     (парсинг таблиці коректний — це проблема прив\'язки заїздів до фаз)');
    }

    console.log('  стартові слоти:');
    for (const [p, s] of Object.entries(data.pilotStartSlots).sort((a, b) => a[1] - b[1])) {
      console.log(`     ${String(s).padStart(2)}  ${slotLabel(data.slotOrder, s).padEnd(10)} ${p}`);
    }

    const existing = comp.results?.gonzalesConfig || {};
    const hasExisting = existing.pilotStartSlots && Object.keys(existing.pilotStartSlots).length > 0;
    if (hasExisting) {
      const diffs: string[] = [];
      const oldSlots: Record<string, number> = existing.pilotStartSlots;
      for (const [p, s] of Object.entries(data.pilotStartSlots)) {
        if (oldSlots[p] !== s) diffs.push(`${p}: ${oldSlots[p] ?? '—'} → ${s}`);
      }
      console.log(diffs.length
        ? `  наявний конфіг відрізняється (${diffs.length}): ${diffs.slice(0, 6).join('; ')}${diffs.length > 6 ? ' …' : ''}`
        : '  наявний конфіг уже збігається');
      if (existing.configLocked) console.log('  ⚠️  configLocked=true — конфіг зафіксовано в UI');
    }

    if (v.rounds > 0 && v.matched === 0) {
      console.log(`  ✗ жодного заїзду не зіставлено — НЕ пишу (додай --force щоб перезаписати)`);
      if (!FORCE) { skipped++; continue; }
    } else if (v.rounds > 0 && v.accuracy < MIN_ACCURACY) {
      console.log(`  ✗ точність < ${(MIN_ACCURACY * 100).toFixed(0)}% — НЕ пишу (додай --force щоб перезаписати)`);
      if (!FORCE) { skipped++; continue; }
    }

    if (!APPLY) { skipped++; continue; }

    const cfg = {
      ...existing,
      kartList: data.karts,
      slotOrder: data.slotOrder,
      pilotStartSlots: data.pilotStartSlots,
      // фіксуємо, щоб авто-призначення в UI не перезатерло імпорт
      configLocked: true,
    };
    await patchCompetition(comp.id, { results: { ...comp.results, gonzalesConfig: cfg } });
    console.log('  ✓ записано (configLocked=true)');
    written++;
  }

  console.log('─'.repeat(78));
  console.log(APPLY ? `Записано: ${written}, пропущено: ${skipped}` : `Оброблено вкладок: ${written + skipped} (dry-run)`);
}

main().catch(e => { console.error(e); process.exit(1); });
