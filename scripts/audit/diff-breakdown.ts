/**
 * Per-component points breakdown vs the official sheet: for every pilot/race
 * compare our positionPoints / overtakePoints / speedPoints / penalties with
 * the sheet's own columns. Pinpoints WHICH part of scoring disagrees instead of
 * just showing a total delta.
 *
 * Usage:
 *   npx tsx scripts/audit/diff-breakdown.ts <competitionId>
 *   npx tsx scripts/audit/diff-breakdown.ts --format=champions_league [--from=YYYY-MM-DD]
 */
import {
  fetchAllCompetitions, fetchCompetition, fetchScoring, computeOurStandings,
  fetchSheetCsv, parseLlSheet, resolveSheetUrl, buildNameMatcher, type SheetPilotFull,
} from './lib';

const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const FORMAT = argVal('--format');
const FROM = argVal('--from');
const DETAIL = process.argv.includes('--detail');
const eq = (a: number, b: number) => Math.abs(a - b) <= 0.05;

type Counts = { base: number; overtake: number; speed: number; pen: number; start: number; finish: number; group: number };

async function analyze(compId: string, scoring: any, detail: boolean) {
  const comp = await fetchCompetition(compId);
  const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
  const url = resolveSheetUrl(comp.format, firstTs);
  if (!url) return { date: comp.date, counts: null as Counts | null, note: 'немає вкладки' };
  const raceCount = comp.format === 'champions_league' ? 3 : 2;
  const our = await computeOurStandings(comp, scoring);
  const sheet = parseLlSheet(await fetchSheetCsv(url), raceCount);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const byName = new Map<string, SheetPilotFull>(sheet.map(s => [s.pilot, s]));

  const counts: Counts = { base: 0, overtake: 0, speed: 0, pen: 0, start: 0, finish: 0, group: 0 };
  const lines: string[] = [];
  for (const row of our) {
    const m = matchName(row.pilot);
    const sp = m ? byName.get(m) : undefined;
    if (!sp) continue;
    for (let r = 0; r < raceCount; r++) {
      const lr = row.races[r], sr = sp.races[r];
      if (!lr || !sr) continue;
      // сесію не гоняли / пілот не виїхав — пропускаємо
      if (lr.finishPos === 0 && sr.finishPos === 0) continue;
      const parts: string[] = [];
      if (!eq(lr.group, sr.group)) { counts.group++; parts.push(`гр ${lr.group}→${sr.group}`); }
      if (lr.startPos > 0 && sr.startPos > 0 && lr.startPos !== sr.startPos) { counts.start++; parts.push(`старт ${lr.startPos}→${sr.startPos}`); }
      if (lr.finishPos > 0 && sr.finishPos > 0 && lr.finishPos !== sr.finishPos) { counts.finish++; parts.push(`фініш ${lr.finishPos}→${sr.finishPos}`); }
      if (!eq(lr.positionPoints, sr.basePoints)) { counts.base++; parts.push(`база ${lr.positionPoints}→${sr.basePoints}`); }
      if (!eq(lr.overtakePoints, sr.overtakePoints)) { counts.overtake++; parts.push(`обгони ${lr.overtakePoints}→${sr.overtakePoints}`); }
      if (!eq(lr.speedPoints, sr.speedPoints)) { counts.speed++; parts.push(`швидк ${lr.speedPoints}→${sr.speedPoints}`); }
      if (!eq(lr.penalties, Math.abs(sr.penalties))) { counts.pen++; parts.push(`штраф ${lr.penalties}→${Math.abs(sr.penalties)}`); }
      if (parts.length && detail) lines.push(`    ${row.pilot.padEnd(22)} Г${r + 1}: ${parts.join(', ')}`);
    }
  }
  if (detail) lines.forEach(l => console.log(l));
  return { date: comp.date, counts, note: '' };
}

async function main() {
  const scoring = await fetchScoring();
  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
  const padR = (s: string, n: number) => s.length >= n ? s : ' '.repeat(n - s.length) + s;

  if (!FORMAT) {
    const id = process.argv[2];
    const { counts } = await analyze(id, scoring, true);
    console.log(counts);
    return;
  }

  let comps = (await fetchAllCompetitions())
    .filter(c => c.format === FORMAT)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (FROM) comps = comps.filter(c => (c.date || '') >= FROM);

  console.log(`BREAKDOWN — ${FORMAT}\n`);
  console.log(`${pad('Дата', 12)}${padR('група', 7)}${padR('старт', 7)}${padR('фініш', 7)}${padR('база', 6)}${padR('обгони', 8)}${padR('швидк', 7)}${padR('штраф', 7)}`);
  console.log('-'.repeat(62));
  const tot: Counts = { base: 0, overtake: 0, speed: 0, pen: 0, start: 0, finish: 0, group: 0 };
  for (const c of comps) {
    if (DETAIL) console.log(`\n${c.date}  ${c.name}`);
    const { counts, note } = await analyze(c.id, scoring, DETAIL);
    if (!counts) { console.log(`${pad(c.date || '', 12)}${note}`); continue; }
    for (const k of Object.keys(tot) as (keyof Counts)[]) tot[k] += counts[k];
    console.log(`${pad(c.date || '', 12)}${padR(String(counts.group), 7)}${padR(String(counts.start), 7)}${padR(String(counts.finish), 7)}${padR(String(counts.base), 6)}${padR(String(counts.overtake), 8)}${padR(String(counts.speed), 7)}${padR(String(counts.pen), 7)}`);
  }
  console.log('-'.repeat(62));
  console.log(`${pad('РАЗОМ', 12)}${padR(String(tot.group), 7)}${padR(String(tot.start), 7)}${padR(String(tot.finish), 7)}${padR(String(tot.base), 6)}${padR(String(tot.overtake), 8)}${padR(String(tot.speed), 7)}${padR(String(tot.pen), 7)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
