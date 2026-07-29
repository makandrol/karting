/**
 * Порівняння наших результатів Гонзалеса з офіційною таблицею.
 *
 * Рахує середній час кола кожного пілота за ротацією з колектора і зіставляє
 * з колонкою "Средний ЛК" в таблиці. Тільки читає.
 */
import { fetchXlsx, readXlsx } from './xlsx';
import { parseGonzalesSheet } from './parse-sheet';

const BOOK_ID = process.env.GONZALES_BOOK_ID || '1CZT-bmDhEQYn_TXvagluKJdEv6rl6uuZ';
const COLLECTOR = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';
const MIN_LAP_SEC = 38;

const tab = process.argv[2];
const compId = process.argv[3];
if (!tab || !compId) {
  console.error('usage: npx tsx scripts/gonzales/verify-results.ts <tab> <competitionId>');
  process.exit(1);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${COLLECTOR}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

const parseLapTime = (s: unknown): number | null => {
  if (s == null) return null;
  const m = String(s).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]) : null;
};

const book = readXlsx(await fetchXlsx(BOOK_ID));
const sheet = book.find(s => s.name === tab);
if (!sheet) throw new Error(`вкладку "${tab}" не знайдено`);
const data = parseGonzalesSheet(sheet);

const comp = await getJson<any>(`/competitions/${encodeURIComponent(compId)}`);
const sessions = typeof comp.sessions === 'string' ? JSON.parse(comp.sessions) : comp.sessions;
const results = typeof comp.results === 'string' ? JSON.parse(comp.results || '{}') : (comp.results || {});
const cfg = results.gonzalesConfig;
if (!cfg?.pilotStartSlots) throw new Error('немає gonzalesConfig.pilotStartSlots');

const slotOrder: (number | null)[] = cfg.slotOrder ?? [];
const total = slotOrder.length;
const kartReplacements: Record<number, number> = cfg.kartReplacements ?? {};

const rounds = sessions
  .map((s: any) => { const m = s.phase?.match(/^round_(\d+)/); return m ? { ...s, num: +m[1] } : null; })
  .filter(Boolean)
  .sort((a: any, b: any) => a.num - b.num);

// найкраще коло по карту в кожному раунді
const roundBest: Map<number, number>[] = [];
for (const r of rounds) {
  const raw = await getJson<any>(`/db/laps?session=${encodeURIComponent(r.sessionId)}`);
  const laps: any[] = Array.isArray(raw) ? raw : (raw.laps || []);
  const best = new Map<number, number>();
  for (const l of laps) {
    const t = parseLapTime(l.lap_time ?? l.lapTime);
    if (t == null || t < MIN_LAP_SEC) continue;
    const rawK = Number(l.kart);
    const k = kartReplacements[rawK] ?? rawK;
    if (!best.has(k) || t < best.get(k)!) best.set(k, t);
  }
  roundBest.push(best);
}

console.log(`${comp.name} — ${rounds.length} раундів, ${Object.keys(cfg.pilotStartSlots).length} пілотів\n`);
console.log('Пілот                  наш сер.   табл.     Δ      картів');
console.log('─'.repeat(64));

let okCount = 0, total_ = 0;
const rows: { pilot: string; ours: number | null; sheet: number | null; karts: number }[] = [];

for (const [pilot, start] of Object.entries(cfg.pilotStartSlots) as [string, number][]) {
  const times: number[] = [];
  for (let ri = 0; ri < roundBest.length; ri++) {
    const kart = slotOrder[(start + ri) % total];
    if (kart === null) continue;
    const t = roundBest[ri].get(kart);
    if (t != null) times.push(t);
  }
  const ours = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  // "Средний ЛК" — остання числова колонка рядка пілота
  const sheetRow = data.sheetTimes.get(pilot);
  const sheetAvg = sheetRow && sheetRow.size
    ? [...sheetRow.values()].reduce((a, b) => a + b, 0) / sheetRow.size
    : null;
  rows.push({ pilot, ours, sheet: sheetAvg, karts: times.length });
}

rows.sort((a, b) => (a.ours ?? 99) - (b.ours ?? 99));
for (const r of rows) {
  const d = r.ours != null && r.sheet != null ? r.ours - r.sheet : null;
  const ok = d != null && Math.abs(d) < 0.01;
  if (d != null) { total_++; if (ok) okCount++; }
  console.log(
    `${r.pilot.padEnd(22)} ${r.ours?.toFixed(3).padStart(8) ?? '       —'} ${r.sheet?.toFixed(3).padStart(8) ?? '       —'} ` +
    `${d != null ? (d >= 0 ? '+' : '') + d.toFixed(3) : '    —'}`.padStart(9) + `   ${String(r.karts).padStart(2)}  ${ok ? '✓' : d != null ? '✗' : ''}`
  );
}
console.log('─'.repeat(64));
console.log(`Збігається (Δ<0.01): ${okCount}/${total_}`);
