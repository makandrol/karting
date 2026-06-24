/**
 * Diagnose Race-1 start positions: compare our quali ordering (which drives
 * race-1 start) against the sheet's race-1 start column.
 *
 * Usage: npx tsx scripts/audit/diag-quali.ts <competitionId> <gid>
 */
import { fetchCompetition, fetchScoring, fetchLaps, fetchSheetCsv, parseLlSheet, llSheetUrl, extractSurname, computeOurStandings } from './lib';
import { parseLapSec } from '../../src/utils/scoring';

async function main() {
  const [compId, sheetArg] = process.argv.slice(2);
  const comp = await fetchCompetition(compId);
  const sheet = parseLlSheet(await fetchSheetCsv(/^\d+$/.test(sheetArg) ? llSheetUrl(sheetArg) : sheetArg), 2);

  const scoring = await fetchScoring();
  const ourStandings = await computeOurStandings(comp, scoring);
  const ourRace1 = new Map<string, { group: number; startPos: number; finishPos: number }>();
  for (const row of ourStandings) {
    const r1 = row.races[0];
    if (r1) ourRace1.set(row.pilot, { group: r1.group, startPos: r1.startPos, finishPos: r1.finishPos });
  }

  // our quali best times
  const qualiSessions = comp.sessions.filter(s => s.phase?.startsWith('qualifying'));
  const best = new Map<string, number>();
  for (const qs of qualiSessions) {
    for (const l of await fetchLaps(qs.sessionId)) {
      const sec = parseLapSec(l.lap_time);
      if (sec == null || sec < 38) continue;
      if (!best.has(l.pilot) || sec < best.get(l.pilot)!) best.set(l.pilot, sec);
    }
  }
  const KART = /^Карт\s+\d+$/i;
  const excluded = new Set<string>(comp.results?.excludedPilots || []);
  const ourSorted = [...best.entries()]
    .filter(([p]) => !excluded.has(p) && !KART.test(p.trim()))
    .sort((a, b) => a[1] - b[1]);

  console.log(`OUR quali order: ${ourSorted.length} pilots (excluded=${JSON.stringify([...excluded])})`);
  console.log(`SHEET pilots: ${sheet.length}`);

  // sheet race1 start → pilot (within group). Build global sheet quali order via race1 group+start (reverse).
  // We just print side by side by surname rank.
  const sheetBy = new Map<string, any>();
  for (const sp of sheet) sheetBy.set(sp.surname, sp);

  console.log('\nrank | our pilot (qtime) | OUR r1[g/st/fi] | sheet[g/r1start/r1finish/qkart]');
  ourSorted.forEach(([p, t], i) => {
    const sp = sheetBy.get(extractSurname(p));
    const r1 = sp?.races?.[0];
    const o = ourRace1.get(p);
    console.log(`${String(i + 1).padStart(3)} | ${p.padEnd(22)} ${t.toFixed(3)} | our g${o?.group ?? '·'} st${o?.startPos ?? '·'} fi${o?.finishPos ?? '·'} | ${sp ? `g${r1.group} st${r1.startPos} fi${r1.finishPos} qk${sp.qualiKart}` : 'NOT IN SHEET'}`);
  });

  // sheet-only
  const ourSurn = new Set(ourSorted.map(([p]) => extractSurname(p)));
  const onlySheet = sheet.filter(sp => !ourSurn.has(sp.surname));
  if (onlySheet.length) console.log(`\nSHEET-ONLY: ${onlySheet.map(s => `${s.pilot}(#${s.position})`).join(', ')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
