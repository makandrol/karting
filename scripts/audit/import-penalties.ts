/**
 * Import penalties (and optionally manual finish positions) from the Google
 * Sheet into a competition's results.edits.
 *
 * edits key format: `${pilotName}|${raceNumber}` (raceNumber is 1-based).
 * We only import non-zero penalties by default. DRY-RUN unless --apply.
 *
 * Usage:
 *   npx tsx scripts/audit/import-penalties.ts <competitionId> <gid|sheetUrl> [--apply]
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
  const comp = await fetchCompetition(compId);
  const raceCount = comp.format === 'champions_league' ? 3 : 2;

  const sheetUrl = /^\d+$/.test(sheetArg) ? llSheetUrl(sheetArg) : (getCsvExportUrl(sheetArg) || sheetArg);
  const sheet = parseLlSheet(await fetchSheetCsv(sheetUrl), raceCount);

  // match sheet pilot → our canonical name via full-name matcher
  const scoring = await fetchScoring();
  const our = await computeOurStandings(comp, scoring);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  // invert: sheetPilot.pilot → our name (matcher maps our→sheet, so build reverse)
  const ourToSheet = new Map<string, string>();
  for (const r of our) { const m = matchName(r.pilot); if (m) ourToSheet.set(m, r.pilot); }

  const existingEdits: Record<string, any> = { ...(comp.results?.edits || {}) };
  const newEdits: Record<string, any> = { ...existingEdits };
  const log: string[] = [];
  const unmatched: string[] = [];
  const logEntries: { pilot: string; action: string; detail: string }[] = [];

  for (const sp of sheet) {
    const ourName = ourToSheet.get(sp.pilot);
    if (!ourName) { if (sp.races.some(r => r.penalties !== 0)) unmatched.push(`${sp.pilot} (#${sp.position})`); continue; }
    for (let r = 0; r < raceCount; r++) {
      const pen = sp.races[r].penalties; // negative in sheet (e.g. -3)
      if (pen === 0) continue;
      const key = `${ourName}|${r + 1}`;
      const penAbs = Math.abs(pen); // store as positive (scoring subtracts penalties)
      const cur = newEdits[key] || {};
      if (cur.penalties === penAbs) continue;
      newEdits[key] = { ...cur, penalties: penAbs };
      log.push(`  ${key.padEnd(28)} penalties ${cur.penalties ?? 0} → ${penAbs}  (sheet ${pen})`);
      logEntries.push({ pilot: ourName, action: 'edit', detail: `Г${r + 1} penalties: ${cur.penalties ?? '—'} → ${penAbs} (з таблиці)` });
    }
  }

  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Competition: ${comp.name}`);
  console.log(`Penalty edits to set (${log.length}):`);
  log.forEach(l => console.log(l));
  if (unmatched.length) console.log(`\nUNMATCHED sheet pilots with penalties: ${unmatched.join(', ')}`);

  if (!APPLY) { console.log('\n(dry-run — no changes written. Re-run with --apply.)'); return; }
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
  console.log(`\napplied ${log.length} penalties to results.edits + ${logEntries.length} editLog entries.`);
}
main().catch(e => { console.error(e); process.exit(1); });
