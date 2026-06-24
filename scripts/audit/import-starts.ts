/**
 * Import explicit start positions from the sheet for a specific race+group
 * into results.edits (key `${pilot}|${race}`). Used for manual cases where the
 * organiser deviated from the automatic reverse grid (e.g. newcomers sent to
 * the back of the grid).
 *
 * DRY-RUN unless --apply.
 *
 * Usage:
 *   npx tsx scripts/audit/import-starts.ts <competitionId> <gid|url> <race> <group> [--apply]
 */
import {
  fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv,
  parseLlSheet, llSheetUrl, buildNameMatcher, COLLECTOR, type SheetPilotFull,
} from './lib';
import { getCsvExportUrl } from '../../src/utils/sheetsCompare';

const APPLY = process.argv.includes('--apply');

async function main() {
  const compId = process.argv[2];
  const sheetArg = process.argv[3];
  const race = parseInt(process.argv[4]);   // 1-based
  const group = parseInt(process.argv[5]);  // 1-based
  const comp = await fetchCompetition(compId);
  const raceCount = comp.format === 'champions_league' ? 3 : 2;
  const sheetUrl = /^\d+$/.test(sheetArg) ? llSheetUrl(sheetArg) : (getCsvExportUrl(sheetArg) || sheetArg);
  const sheet = parseLlSheet(await fetchSheetCsv(sheetUrl), raceCount);

  const scoring = await fetchScoring();
  const our = await computeOurStandings(comp, scoring);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const sheetToOur = new Map<string, typeof our[number]>();
  for (const r of our) { const m = matchName(r.pilot); if (m) sheetToOur.set(m, r); }

  const existingEdits: Record<string, any> = { ...(comp.results?.edits || {}) };
  const newEdits: Record<string, any> = { ...existingEdits };
  const log: string[] = [];
  const logEntries: { pilot: string; action: string; detail: string }[] = [];

  // sheet pilots in this race+group
  const inGroup = sheet.filter(sp => sp.races[race - 1]?.group === group);
  for (const sp of inGroup) {
    const ours = sheetToOur.get(sp.pilot);
    if (!ours) { log.push(`  ! ${sp.pilot} not matched in our standings`); continue; }
    const sheetStart = sp.races[race - 1].startPos;
    const ourStart = ours.races[race - 1]?.startPos;
    if (sheetStart === 0) continue;
    if (ourStart === sheetStart) continue; // already matches
    const key = `${ours.pilot}|${race}`;
    const cur = newEdits[key] || {};
    newEdits[key] = { ...cur, startPos: sheetStart };
    log.push(`  ${key.padEnd(28)} startPos ${ourStart} → ${sheetStart}`);
    logEntries.push({ pilot: ours.pilot, action: 'edit', detail: `Г${race} startPos: ${ourStart ?? '—'} → ${sheetStart} (ручне розставлення з таблиці)` });
  }

  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'} — race ${race}, group ${group}`);
  console.log(`Competition: ${comp.name}`);
  console.log(`Start edits (${log.length}):`);
  log.forEach(l => console.log(l));

  if (!APPLY) { console.log('\n(dry-run — re-run with --apply)'); return; }
  if (log.length === 0) { console.log('\nnothing to write.'); return; }

  const ts = Date.now();
  const newEditLog = [
    ...(comp.results?.editLog || []),
    ...logEntries.map((e, i) => ({ ...e, user: 'audit-script', ts: ts + i })),
  ];
  const merged = { ...(comp.results || {}), edits: newEdits, editLog: newEditLog };
  const res = await fetch(`${COLLECTOR}/competitions/${encodeURIComponent(comp.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: merged }),
  });
  if (!res.ok) throw new Error(`PATCH → ${res.status}: ${await res.text()}`);
  console.log(`\napplied ${log.length} start positions + ${logEntries.length} editLog entries.`);
}
main().catch(e => { console.error(e); process.exit(1); });
