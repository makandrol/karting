/**
 * Import the sheet's finish ORDER for a race group when our order differs by a
 * single coherent shift.
 *
 * Why this is not "fitting to the sheet": the judges' decision is always one
 * pilot moved (demoted for a foul, or credited a lap the timing lost), and the
 * whole group behind him shifts by exactly one place. Our per-pilot rule
 * "sheet lowered → keep ours" then leaves 10-20 wrong finishes in that race.
 * So we import the group's order only when the diff pattern matches that
 * signature:
 *   - at least MIN_DIFFS pilots differ, AND
 *   - all but at most 2 of them differ by exactly +1 (our place is better by 1).
 *
 * Anything else (scattered diffs) is left alone and reported.
 *
 * DRY-RUN unless --apply.
 *
 * Usage:
 *   npx tsx scripts/audit/import-finish-order.ts <competitionId> [--apply] [--min=3]
 */
import {
  fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv,
  parseLlSheet, resolveSheetUrl, buildNameMatcher, COLLECTOR, type SheetPilotFull,
} from './lib';

const APPLY = process.argv.includes('--apply');
const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const MIN_DIFFS = parseInt(argVal('--min') || '3');

async function main() {
  const compId = process.argv[2];
  if (!compId) { console.error('usage: tsx scripts/audit/import-finish-order.ts <competitionId> [--apply]'); process.exit(1); }
  const comp = await fetchCompetition(compId);
  const raceCount = comp.format === 'champions_league' ? 3 : 2;
  const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
  const url = resolveSheetUrl(comp.format, firstTs);
  if (!url) { console.log('немає вкладки в книзі — пропуск'); return; }

  const scoring = await fetchScoring();
  const our = await computeOurStandings(comp, scoring);
  const sheet = parseLlSheet(await fetchSheetCsv(url), raceCount);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const byName = new Map<string, SheetPilotFull>(sheet.map(s => [s.pilot, s]));

  const newEdits: Record<string, any> = { ...(comp.results?.edits || {}) };
  const logEntries: { pilot: string; action: string; detail: string }[] = [];
  let importedGroups = 0;
  const reports: string[] = [];

  for (let r = 0; r < raceCount; r++) {
    // збираємо розбіжності по групах ТАБЛИЦІ
    const groups = new Map<number, { pilot: string; ourFin: number; sheetFin: number }[]>();
    for (const row of our) {
      const m = matchName(row.pilot);
      const sp = m ? byName.get(m) : undefined;
      if (!sp) continue;
      const lr = row.races[r], sr = sp.races[r];
      if (!lr || !sr || lr.finishPos < 1 || sr.finishPos < 1) continue;
      const g = sr.group || lr.group;
      const list = groups.get(g) || [];
      list.push({ pilot: row.pilot, ourFin: lr.finishPos, sheetFin: sr.finishPos });
      groups.set(g, list);
    }
    for (const [g, list] of [...groups].sort((a, b) => a[0] - b[0])) {
      const diffs = list.filter(x => x.ourFin !== x.sheetFin);
      if (diffs.length === 0) continue;
      const shiftedByOne = diffs.filter(x => x.sheetFin - x.ourFin === 1).length;
      const outliers = diffs.length - shiftedByOne;
      const signature = diffs.length >= MIN_DIFFS && outliers <= 2;
      reports.push(`  Г${r + 1} гр${g}: розбіжностей ${diffs.length} (зсув +1: ${shiftedByOne}, інших: ${outliers}) → ${signature ? 'ІМПОРТ' : 'пропуск'}`);
      if (!signature) continue;
      importedGroups++;
      for (const d of diffs) {
        const key = `${d.pilot}|${r + 1}`;
        const cur = newEdits[key] || {};
        newEdits[key] = { ...cur, finishPos: d.sheetFin };
        logEntries.push({ pilot: d.pilot, action: 'edit', detail: `Г${r + 1} finishPos: ${d.ourFin} → ${d.sheetFin} (порядок фінішу з офіційної таблиці)` });
      }
    }
  }

  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'} — ${comp.name}`);
  reports.forEach(l => console.log(l));
  console.log(`Груп до імпорту: ${importedGroups}, правок: ${logEntries.length}`);

  if (!APPLY || logEntries.length === 0) { if (!APPLY) console.log('(dry-run)'); return; }
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
  console.log(`записано ${logEntries.length} правок фінішу.`);
}
main().catch(e => { console.error(e); process.exit(1); });
