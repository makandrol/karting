/**
 * List start/finish position diffs (ours vs sheet) so we can decide which
 * manual edits to apply. Read-only. Groups by race + group for readability.
 *
 * Usage: npx tsx scripts/audit/diff-positions.ts <competitionId> <gid|url>
 */
import {
  fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv,
  parseLlSheet, llSheetUrl, buildNameMatcher, type SheetPilotFull,
} from './lib';
import { getCsvExportUrl } from '../../src/utils/sheetsCompare';

async function main() {
  const compId = process.argv[2];
  const sheetArg = process.argv[3];
  const comp = await fetchCompetition(compId);
  const raceCount = comp.format === 'champions_league' ? 3 : 2;
  const sheetUrl = /^\d+$/.test(sheetArg) ? llSheetUrl(sheetArg) : (getCsvExportUrl(sheetArg) || sheetArg);
  const sheet = parseLlSheet(await fetchSheetCsv(sheetUrl), raceCount);
  const sheetByName = new Map<string, SheetPilotFull>(sheet.map(s => [s.pilot, s]));

  const scoring = await fetchScoring();
  const our = await computeOurStandings(comp, scoring);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));

  for (let r = 0; r < raceCount; r++) {
    console.log(`\n=== RACE ${r + 1} — position diffs (ours → sheet) ===`);
    const rows = our
      .map(row => { const m = matchName(row.pilot); return { row, sp: m ? sheetByName.get(m) : undefined }; })
      .filter(x => x.sp && x.row.races[r])
      .map(x => ({ pilot: x.row.pilot, ours: x.row.races[r]!, sheet: x.sp!.races[r] }))
      .filter(x => x.ours.startPos !== x.sheet.startPos || x.ours.finishPos !== x.sheet.finishPos)
      .sort((a, b) => (a.ours.group - b.ours.group) || (a.ours.startPos - b.ours.startPos));
    for (const x of rows) {
      const stD = x.ours.startPos !== x.sheet.startPos ? `START ${x.ours.startPos}→${x.sheet.startPos}` : '';
      const fiD = x.ours.finishPos !== x.sheet.finishPos ? `FINISH ${x.ours.finishPos}→${x.sheet.finishPos}` : '';
      console.log(`  g${x.ours.group} ${x.pilot.padEnd(22)} ${stD.padEnd(16)} ${fiD}`);
    }
    if (rows.length === 0) console.log('  (no diffs)');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
