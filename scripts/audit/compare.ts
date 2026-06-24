/**
 * Read-only audit of a single LL/CL competition vs its Google Sheet.
 *
 * Usage:
 *   npx tsx scripts/audit/compare.ts <competitionId> <sheetUrlOrGid>
 *
 * NOTHING is written. Prints linking structure + per-pilot comparison.
 */
import {
  fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv,
  parseLlSheet, llSheetUrl, extractSurname, buildNameMatcher, type PilotRow, type SheetPilotFull,
} from './lib';
import { getCsvExportUrl } from '../../src/utils/sheetsCompare';

function f(n: number | undefined | null): string {
  if (n == null || n === undefined) return '·';
  return (Math.round(n * 10) / 10).toString();
}
const d = (a: number | undefined, b: number | undefined, tol = 0.05) =>
  (a != null && b != null && Math.abs(a - b) > tol) ? '*' : ' ';

async function main() {
  const [compId, sheetArg] = process.argv.slice(2);
  if (!compId) { console.error('usage: tsx scripts/audit/compare.ts <competitionId> <sheetUrlOrGid>'); process.exit(1); }

  const comp = await fetchCompetition(compId);
  const raceCount = comp.format === 'champions_league' ? 3 : 2;

  console.log('='.repeat(90));
  console.log(`COMPETITION: ${comp.name}`);
  console.log(`  id=${comp.id} format=${comp.format} date=${comp.date} status=${comp.status}`);
  console.log(`  trackId=${comp.results?.trackId ?? '—'} autoGroups=${comp.results?.autoDetectedGroups ?? '—'} groupOverride=${comp.results?.groupCountOverride ?? '—'} racePilotCount=${comp.results?.racePilotCount ?? '—'}`);
  console.log(`  excludedPilots=${JSON.stringify(comp.results?.excludedPilots ?? [])}`);
  const sortedSess = [...comp.sessions].sort((a, b) => (parseInt(a.sessionId.replace('session-', '')) || 0) - (parseInt(b.sessionId.replace('session-', '')) || 0));
  console.log('  LINKED SESSIONS:');
  for (const s of sortedSess) {
    const ts = parseInt(s.sessionId.replace('session-', '')) || 0;
    console.log(`    ${new Date(ts).toISOString().slice(11, 16)}  ${(s.phase || '—').padEnd(18)} ${s.sessionId}`);
  }

  const scoring = await fetchScoring();
  const our = await computeOurStandings(comp, scoring);
  our.sort((a, b) => b.totalPoints - a.totalPoints);

  let sheetUrl: string;
  if (/^\d+$/.test(sheetArg || '')) sheetUrl = llSheetUrl(sheetArg);
  else sheetUrl = getCsvExportUrl(sheetArg) || sheetArg;
  console.log(`\n  SHEET: ${sheetUrl}`);

  let sheet: SheetPilotFull[] = [];
  try { sheet = parseLlSheet(await fetchSheetCsv(sheetUrl), raceCount); }
  catch (e) { console.log(`  !! sheet failed: ${(e as Error).message}`); }
  console.log(`  sheet pilots: ${sheet.length}`);

  const sheetBy = new Map<string, SheetPilotFull>();
  for (const sp of sheet) sheetBy.set(sp.pilot, sp);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const matchedSheet = new Set<string>();

  // --- Group composition per race (ours vs sheet) ---
  console.log('\n' + '-'.repeat(90));
  console.log('GROUP COMPOSITION (count of pilots per group)');
  for (let r = 0; r < raceCount; r++) {
    const ourG: Record<number, number> = {}, shG: Record<number, number> = {};
    for (const row of our) { const g = row.races[r]?.group; if (g) ourG[g] = (ourG[g] || 0) + 1; }
    for (const sp of sheet) { const g = sp.races[r]?.group; if (g) shG[g] = (shG[g] || 0) + 1; }
    console.log(`  Race ${r + 1}:  ours=${JSON.stringify(ourG)}  sheet=${JSON.stringify(shG)}`);
  }

  console.log('\n' + '-'.repeat(90));
  console.log('PER-PILOT (ours vs sheet) — * marks a diff. fmt: gr st>fi pen =tot');
  console.log('-'.repeat(90));

  let diffPilots = 0, startDiffs = 0, finishDiffs = 0, totalDiffs = 0;
  const onlyOurs: string[] = [];
  for (const row of our) {
    const matchedName = matchName(row.pilot);
    const sp = matchedName ? sheetBy.get(matchedName) : undefined;
    if (sp) matchedSheet.add(matchedName!);
    if (!sp) onlyOurs.push(row.pilot);
    const totM = sp ? d(row.totalPoints, sp.total) : ' ';
    if (totM === '*') totalDiffs++;
    const parts: string[] = [];
    let rowDiff = totM === '*';
    for (let r = 0; r < raceCount; r++) {
      const lr = row.races[r], sr = sp?.races[r];
      const gM = lr && sr ? d(lr.group, sr.group) : ' ';
      const stM = lr && sr ? d(lr.startPos, sr.startPos) : ' ';
      const fiM = lr && sr ? d(lr.finishPos, sr.finishPos) : ' ';
      if (stM === '*') startDiffs++;
      if (fiM === '*') finishDiffs++;
      if (gM === '*' || stM === '*' || fiM === '*') rowDiff = true;
      parts.push(`G${r + 1}[${f(lr?.group)}${gM}${f(lr?.startPos)}>${f(lr?.finishPos)}${stM === '*' || fiM === '*' ? '*' : ''}|sh ${f(sr?.group)} ${f(sr?.startPos)}>${f(sr?.finishPos)} pen${f(sr?.penalties)}]`);
    }
    if (rowDiff) diffPilots++;
    console.log(`${rowDiff ? '*' : ' '}${row.pilot.padEnd(22)} Σ${f(row.totalPoints).padStart(5)}/${(sp ? f(sp.total) : '·').padStart(5)}${totM}  ${parts.join('  ')}`);
  }

  const onlySheet = sheet.filter(sp => !matchedSheet.has(sp.pilot)).map(sp => `${sp.pilot}(#${sp.position})`);

  console.log('\n' + '-'.repeat(90));
  console.log(`SUMMARY: ours=${our.length} sheet=${sheet.length} | pilotsWithDiff=${diffPilots} startDiffs=${startDiffs} finishDiffs=${finishDiffs} totalDiffs=${totalDiffs}`);
  if (onlyOurs.length) console.log(`  ONLY OURS: ${onlyOurs.join(', ')}`);
  if (onlySheet.length) console.log(`  ONLY SHEET: ${onlySheet.join(', ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
