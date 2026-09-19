/**
 * Import the sheet's start grid (group + start position) for a whole race.
 *
 * Used when the organiser deviated from the automatic reverse grid — e.g. a
 * pilot demoted to the back of the last group as a penalty, which shifts every
 * other start by one. Our reverse grid is then "correct by the rules" but does
 * not match the official result, so the sheet becomes the source of truth for
 * that race only.
 *
 * Writes `results.edits[pilot|race] = { group, startPos }` + editLog entries.
 * DRY-RUN unless --apply.
 *
 * Usage:
 *   npx tsx scripts/audit/import-grid.ts <competitionId> --race=N [gid|url] [--apply]
 */
import {
  fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv,
  parseLlSheet, resolveSheetUrl, clSheetUrl, llSheetUrl, buildNameMatcher, COLLECTOR,
} from './lib';
import { getCsvExportUrl } from '../../src/utils/sheetsCompare';

const APPLY = process.argv.includes('--apply');
const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};

async function main() {
  const compId = process.argv[2];
  const race = parseInt(argVal('--race') || '0');
  if (!compId || !race) { console.error('usage: tsx scripts/audit/import-grid.ts <competitionId> --race=N [gid|url] [--apply]'); process.exit(1); }

  const comp = await fetchCompetition(compId);
  const raceCount = comp.format === 'champions_league' ? 3 : 2;
  const explicit = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
  const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
  const sheetUrl = explicit
    ? (/^\d+$/.test(explicit)
      ? (comp.format === 'champions_league' ? clSheetUrl(explicit) : llSheetUrl(explicit))
      : (getCsvExportUrl(explicit) || explicit))
    : resolveSheetUrl(comp.format, firstTs)!;
  const sheet = parseLlSheet(await fetchSheetCsv(sheetUrl), raceCount);

  const scoring = await fetchScoring();
  const our = await computeOurStandings(comp, scoring);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const sheetToOur = new Map<string, typeof our[number]>();
  for (const r of our) { const m = matchName(r.pilot); if (m) sheetToOur.set(m, r); }

  const newEdits: Record<string, any> = { ...(comp.results?.edits || {}) };
  const log: string[] = [];
  const logEntries: { pilot: string; action: string; detail: string }[] = [];
  let skipped = 0;

  for (const sp of sheet) {
    const sr = sp.races[race - 1];
    if (!sr || sr.startPos < 1 || sr.group < 1) continue;
    const ours = sheetToOur.get(sp.pilot);
    if (!ours) { log.push(`  ! ${sp.pilot} — не зматчений у наших результатах`); continue; }
    const lr = ours.races[race - 1];
    if (!lr) { log.push(`  ! ${ours.pilot} — немає даних гонки ${race}`); continue; }
    if (lr.startPos === sr.startPos && lr.group === sr.group) { skipped++; continue; }
    const key = `${ours.pilot}|${race}`;
    const cur = newEdits[key] || {};
    newEdits[key] = { ...cur, startPos: sr.startPos, group: sr.group };
    const what = [
      lr.group !== sr.group ? `група ${lr.group}→${sr.group}` : null,
      lr.startPos !== sr.startPos ? `старт ${lr.startPos}→${sr.startPos}` : null,
    ].filter(Boolean).join(', ');
    log.push(`  ${key.padEnd(28)} ${what}`);
    logEntries.push({ pilot: ours.pilot, action: 'edit', detail: `Г${race}: ${what} (стартова решітка з офіційної таблиці)` });
  }

  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'} — ${comp.name}, гонка ${race}`);
  console.log(`SHEET: ${sheetUrl}`);
  console.log(`Вже збігається: ${skipped}`);
  console.log(`Зміни (${logEntries.length}):`);
  log.forEach(l => console.log(l));

  if (!APPLY) { console.log('\n(dry-run — додай --apply щоб записати)'); return; }
  if (logEntries.length === 0) { console.log('\nнічого писати.'); return; }

  const ts = Date.now();
  const merged = {
    ...(comp.results || {}),
    edits: newEdits,
    editLog: [...(comp.results?.editLog || []), ...logEntries.map((e, i) => ({ ...e, user: 'audit-script', ts: ts + i }))],
  };
  const res = await fetch(`${COLLECTOR}/competitions/${encodeURIComponent(comp.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: merged }),
  });
  if (!res.ok) throw new Error(`PATCH → ${res.status}: ${await res.text()}`);
  console.log(`\nзаписано ${logEntries.length} правок решітки.`);
}
main().catch(e => { console.error(e); process.exit(1); });
