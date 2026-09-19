/**
 * Fast in-process scan: for every finished competition of a format, compute our
 * standings and compare points + start positions against the official sheet.
 * No writes, no subprocesses — used to measure the effect of scoring changes
 * across the whole season at once.
 *
 * Usage: npx tsx scripts/audit/scan-points.ts [--format=champions_league] [--from=YYYY-MM-DD]
 */
import {
  fetchAllCompetitions, fetchCompetition, fetchScoring, computeOurStandings,
  fetchSheetCsv, parseLlSheet, resolveSheetUrl, buildNameMatcher, type SheetPilotFull,
} from './lib';

const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const FORMAT = argVal('--format') || 'champions_league';
const FROM = argVal('--from');

async function main() {
  const scoring = await fetchScoring();
  let comps = (await fetchAllCompetitions())
    .filter(c => c.format === FORMAT)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (FROM) comps = comps.filter(c => (c.date || '') >= FROM);

  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
  const padR = (s: string, n: number) => s.length >= n ? s : ' '.repeat(n - s.length) + s;
  console.log(`SCAN — ${FORMAT}, ${comps.length} competitions`);
  console.log(`${pad('Дата', 12)}${padR('Бали', 8)}${padR('Старт Δ', 9)}  Нотатки`);
  console.log('-'.repeat(78));

  let okComps = 0, totalPilots = 0, okPilots = 0, totalStartDiffs = 0;
  for (const c0 of comps) {
    const comp = await fetchCompetition(c0.id);
    const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
    const url = resolveSheetUrl(comp.format, firstTs);
    if (!url) { console.log(`${pad(c0.date || '', 12)}${padR('—', 8)}${padR('—', 9)}  немає вкладки в книзі`); continue; }
    const raceCount = comp.format === 'champions_league' ? 3 : 2;
    const our = await computeOurStandings(comp, scoring);
    const sheet = parseLlSheet(await fetchSheetCsv(url), raceCount);
    const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
    const byName = new Map<string, SheetPilotFull>(sheet.map(s => [s.pilot, s]));

    let ok = 0, n = 0, startDiffs = 0;
    const notes: string[] = [];
    const matched = new Set<string>();
    for (const row of our) {
      const m = matchName(row.pilot);
      const sp = m ? byName.get(m) : undefined;
      if (!sp) continue;
      matched.add(m!);
      n++;
      if (Math.abs(row.totalPoints - sp.total) <= 0.05) ok++;
      for (let r = 0; r < raceCount; r++) {
        const lr = row.races[r], sr = sp.races[r];
        if (lr && sr && lr.startPos > 0 && sr.startPos > 0 && (lr.startPos !== sr.startPos || lr.group !== sr.group)) startDiffs++;
      }
    }
    const onlyOurs = our.filter(r => !matchName(r.pilot)).map(r => r.pilot);
    const onlySheet = sheet.filter(s => !matched.has(s.pilot)).map(s => s.pilot);
    if (onlyOurs.length) notes.push(`лише в нас: ${onlyOurs.join(', ')}`);
    if (onlySheet.length) notes.push(`лише в табл: ${onlySheet.join(', ')}`);

    totalPilots += n; okPilots += ok; totalStartDiffs += startDiffs;
    if (ok === n && startDiffs === 0) okComps++;
    console.log(`${pad(c0.date || '', 12)}${padR(`${ok}/${n}`, 8)}${padR(String(startDiffs), 9)}  ${notes.join(' | ')}`);
  }
  console.log('-'.repeat(78));
  console.log(`Ідеальних змагань: ${okComps}/${comps.length} · бали ${okPilots}/${totalPilots} · стартових розбіжностей ${totalStartDiffs}`);
}
main().catch(e => { console.error(e); process.exit(1); });
