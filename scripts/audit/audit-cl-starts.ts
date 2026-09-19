/**
 * Аудит СТАРТОВИХ ПОЗИЦІЙ усіх ЛЧ проти офіційних таблиць.
 *
 * Друга за важливістю річ після лінкування: навіть при правильній структурі
 * старти можуть роз'їхатись (неправильний best-lap квали → інша група → зсув
 * решітки). Використовує справжню frontend-логіку `computeStandings`.
 *
 * Тільки читає (прод + Google Sheets).
 */
import { fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv, parseLlSheet, resolveSheetUrl, buildNameMatcher } from './lib';

const FROM = process.env.FROM_DATE || '2026-06-01';
const COLLECTOR = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';

const all = await fetch(`${COLLECTOR}/competitions`).then(r => r.json());
const comps = (all as any[])
  .filter(c => c.format === 'champions_league' && (c.date || '') >= FROM)
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

const scoring = await fetchScoring();
const summary: { date: string; name: string; startDiffs: number; pts: string; note: string }[] = [];

for (const c of comps) {
  const comp = await fetchCompetition(c.id);
  const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
  const url = resolveSheetUrl(comp.format, firstTs);
  if (!url) { summary.push({ date: c.date, name: c.name, startDiffs: -1, pts: '—', note: 'вкладку не знайдено' }); continue; }

  let sheet;
  try { sheet = parseLlSheet(await fetchSheetCsv(url), 3); }
  catch (e: any) { summary.push({ date: c.date, name: c.name, startDiffs: -1, pts: '—', note: `sheet error: ${e.message}` }); continue; }

  let our;
  try { our = await computeOurStandings(comp, scoring); }
  catch (e: any) { summary.push({ date: c.date, name: c.name, startDiffs: -1, pts: '—', note: `compute error: ${e.message}` }); continue; }

  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const sheetByOur = new Map<string, any>();
  for (const r of our) {
    const m = matchName(r.pilot);
    if (m) sheetByOur.set(r.pilot, sheet.find(s => s.pilot === m));
  }

  // старти
  let diffs = 0, checked = 0;
  const details: string[] = [];
  for (const r of our) {
    const sp = sheetByOur.get(r.pilot);
    if (!sp) continue;
    for (let i = 0; i < 3; i++) {
      const ourStart = r.races?.[i]?.startPos;
      const sheetStart = sp.races?.[i]?.startPos;
      if (!ourStart || !sheetStart) continue;
      checked++;
      if (ourStart !== sheetStart) {
        diffs++;
        if (details.length < 6) details.push(`${r.pilot} Г${i + 1}: наш ${ourStart} vs табл ${sheetStart}`);
      }
    }
  }

  // бали
  let ptsOk = 0, ptsTotal = 0;
  for (const r of our) {
    const sp = sheetByOur.get(r.pilot);
    if (!sp || sp.total == null) continue;
    ptsTotal++;
    if (Math.abs((r.totalPoints ?? 0) - sp.total) < 0.05) ptsOk++;
  }

  const flag = diffs === 0 ? '✅' : '⚠️';
  console.log(`${flag} ${c.date}  ${c.name}`);
  console.log(`      старти: ${checked - diffs}/${checked} збігаються${diffs ? ` (розбіжностей ${diffs})` : ''}   бали: ${ptsOk}/${ptsTotal}`);
  for (const d of details) console.log(`         ${d}`);
  summary.push({ date: c.date, name: c.name, startDiffs: diffs, pts: `${ptsOk}/${ptsTotal}`, note: '' });
}

console.log('\n' + '='.repeat(74));
console.log('ЗВЕДЕННЯ — стартові позиції та бали');
console.log('дата         старт-розб.  бали      примітка');
for (const s of summary) {
  console.log(`${s.date}   ${String(s.startDiffs < 0 ? '—' : s.startDiffs).padStart(10)}  ${s.pts.padEnd(8)}  ${s.note}`);
}
const clean = summary.filter(s => s.startDiffs === 0).length;
console.log(`\nБез розбіжностей стартів: ${clean}/${summary.length}`);
