/**
 * Import manual finish-position corrections from the sheet into results.edits.
 *
 * Rule (per organiser): judges return positions for being fouled, so the sheet
 * finish is <= our timing finish. We import only when:
 *   - sheet finish < our finish (positions returned), AND
 *   - (our finish − sheet finish) <= MAX_DELTA (default 3).
 * We do NOT import when the sheet finish is WORSE (>) than ours.
 * Duplicate finish positions in the sheet are legitimate (two pilots credited
 * the same place after a return), so they are allowed.
 *
 * Also DETECTS start-position anomalies (start diffs vs sheet, or dups/missing
 * in sheet start positions) and reports them — those mean "something is wrong".
 *
 * DRY-RUN unless --apply.
 *
 * Usage:
 *   npx tsx scripts/audit/import-finishes.ts <competitionId> <gid|url> [--apply] [--max=3]
 */
import {
  fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv,
  parseLlSheet, llSheetUrl, buildNameMatcher, COLLECTOR,
} from './lib';
import { getCsvExportUrl } from '../../src/utils/sheetsCompare';

const APPLY = process.argv.includes('--apply');
const MAX_DELTA = (() => {
  const a = process.argv.find(x => x.startsWith('--max='));
  return a ? parseInt(a.slice(6)) : 3;
})();

async function main() {
  const compId = process.argv[2];
  const sheetArg = process.argv[3];
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
  const applied: string[] = [];
  const skippedWorse: string[] = [];
  const skippedBig: string[] = [];
  const logEntries: { pilot: string; action: string; detail: string }[] = [];

  for (const sp of sheet) {
    const ours = sheetToOur.get(sp.pilot);
    if (!ours) continue;
    for (let r = 0; r < raceCount; r++) {
      const sheetFin = sp.races[r]?.finishPos ?? 0;
      const ourFin = ours.races[r]?.finishPos ?? 0;
      if (sheetFin === 0 || ourFin === 0) continue;       // no-show / DNF on either side
      if (sheetFin === ourFin) continue;                   // matches
      const key = `${ours.pilot}|${r + 1}`;
      const delta = ourFin - sheetFin;                     // positive = sheet better (returned)
      if (delta < 0) { skippedWorse.push(`  SKIP (sheet worse) ${key.padEnd(26)} our ${ourFin} vs sheet ${sheetFin}`); continue; }
      if (delta > MAX_DELTA) { skippedBig.push(`  SKIP (Δ${delta} > ${MAX_DELTA}) ${key.padEnd(26)} our ${ourFin} vs sheet ${sheetFin}`); continue; }
      const cur = newEdits[key] || {};
      if (cur.finishPos != null && cur.finishPos !== ourFin) continue; // don't clobber existing manual edit
      newEdits[key] = { ...cur, finishPos: sheetFin };
      applied.push(`  ${key.padEnd(26)} finishPos ${ourFin} → ${sheetFin} (повернуто ${delta})`);
      logEntries.push({ pilot: ours.pilot, action: 'edit', detail: `Г${r + 1} finishPos: ${ourFin} → ${sheetFin} (повернуто ${delta} за фол, з таблиці)` });
    }
  }

  // --- START-position anomaly detection (report only) ---
  const startWarnings: string[] = [];
  for (let r = 0; r < raceCount; r++) {
    // per group: collect sheet starts + our starts for matched pilots
    const byGroup = new Map<number, { sheetStarts: number[]; diffs: string[] }>();
    for (const sp of sheet) {
      const sr = sp.races[r];
      if (!sr || sr.group === 0) continue;
      const g = byGroup.get(sr.group) || { sheetStarts: [], diffs: [] };
      if (sr.startPos > 0) g.sheetStarts.push(sr.startPos);
      const ours = sheetToOur.get(sp.pilot);
      const ourStart = ours?.races[r]?.startPos;
      if (ours && ourStart != null && ourStart > 0 && sr.startPos > 0 && ourStart !== sr.startPos) {
        g.diffs.push(`${sp.pilot}: our ${ourStart} vs sheet ${sr.startPos}`);
      }
      byGroup.set(sr.group, g);
    }
    for (const [g, info] of [...byGroup].sort((a, b) => a[0] - b[0])) {
      const sorted = [...info.sheetStarts].sort((a, b) => a - b);
      const dupSet = [...new Set(sorted.filter((x, i) => x === sorted[i + 1]))];
      const missing = Array.from({ length: sorted.length }, (_, i) => i + 1).filter(e => !sorted.includes(e));
      if (info.diffs.length || dupSet.length || missing.length) {
        startWarnings.push(`  R${r + 1} G${g}: ${info.diffs.length ? `startDiffs=[${info.diffs.join('; ')}] ` : ''}${dupSet.length ? `DUP_starts=[${dupSet}] ` : ''}${missing.length ? `MISSING_starts=[${missing}]` : ''}`);
      }
    }
  }

  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'} — finish maxDelta=${MAX_DELTA}, only sheet<ours`);
  console.log(`Competition: ${comp.name}`);
  console.log(`\nFinish corrections to apply (${applied.length}):`);
  applied.forEach(l => console.log(l));
  if (skippedWorse.length) { console.log(`\nSkipped (sheet finish WORSE than ours — kept ours):`); skippedWorse.forEach(l => console.log(l)); }
  if (skippedBig.length) { console.log(`\nSkipped (Δ > ${MAX_DELTA}):`); skippedBig.forEach(l => console.log(l)); }

  if (startWarnings.length) {
    console.log(`\n⚠️  START ANOMALIES (review — щось не так зі стартовими позиціями):`);
    startWarnings.forEach(l => console.log(l));
  } else {
    console.log(`\n✓ start positions OK (no diffs/dups/missing)`);
  }

  if (!APPLY) { console.log('\n(dry-run — re-run with --apply)'); return; }
  if (applied.length === 0) { console.log('\nnothing to write.'); return; }

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
  console.log(`\napplied ${applied.length} finish corrections + ${logEntries.length} editLog entries.`);
}
main().catch(e => { console.error(e); process.exit(1); });

