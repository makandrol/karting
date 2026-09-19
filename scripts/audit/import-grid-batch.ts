/**
 * Batch grid import: for every competition of a format, find races whose start
 * grid disagrees with the official sheet and import the sheet's grid for those
 * races only (organiser's manual reseats — see import-grid.ts).
 *
 * DRY-RUN unless --apply.
 *
 * Usage: npx tsx scripts/audit/import-grid-batch.ts [--format=champions_league] [--apply]
 */
import { spawnSync } from 'node:child_process';
import {
  fetchAllCompetitions, fetchCompetition, fetchScoring, computeOurStandings,
  fetchSheetCsv, parseLlSheet, resolveSheetUrl, buildNameMatcher, type SheetPilotFull,
} from './lib';

const APPLY = process.argv.includes('--apply');
const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const FORMAT = argVal('--format') || 'champions_league';
// Змагання, де дані таймінгу самі зіпсовані (часткові імена «Славон», «Карт 16»
// замість повних), тож зіставлення з таблицею недостовірне — решітку не
// імпортуємо, бо правки прив'язалися б до сміттєвих імен.
const SKIP = new Set((argVal('--skip') || 'champions_league-2026-05-07-moukhapx').split(',').filter(Boolean));

async function main() {
  const scoring = await fetchScoring();
  const comps = (await fetchAllCompetitions())
    .filter(c => c.format === FORMAT)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  console.log(`GRID IMPORT BATCH — ${FORMAT}, mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  for (const c0 of comps) {
    if (SKIP.has(c0.id)) { console.log(`${c0.date}  ${c0.name} — ПРОПУСК (зіпсовані імена в таймінгу)`); continue; }
    const comp = await fetchCompetition(c0.id);
    const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
    const url = resolveSheetUrl(comp.format, firstTs);
    if (!url) continue;
    const raceCount = comp.format === 'champions_league' ? 3 : 2;
    const our = await computeOurStandings(comp, scoring);
    const sheet = parseLlSheet(await fetchSheetCsv(url), raceCount);
    const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
    const byName = new Map<string, SheetPilotFull>(sheet.map(s => [s.pilot, s]));

    const diffsByRace = new Array(raceCount).fill(0);
    for (const row of our) {
      const m = matchName(row.pilot);
      const sp = m ? byName.get(m) : undefined;
      if (!sp) continue;
      for (let r = 0; r < raceCount; r++) {
        const lr = row.races[r], sr = sp.races[r];
        if (lr && sr && lr.startPos > 0 && sr.startPos > 0 && (lr.startPos !== sr.startPos || lr.group !== sr.group)) diffsByRace[r]++;
      }
    }
    const races = diffsByRace.map((n, i) => n > 0 ? i + 1 : 0).filter(Boolean);
    if (races.length === 0) continue;
    console.log(`${c0.date}  ${comp.name} — розбіжності решітки в гонках: ${races.map(r => `Г${r} (${diffsByRace[r - 1]})`).join(', ')}`);
    for (const r of races) {
      const args = ['tsx', 'scripts/audit/import-grid.ts', comp.id, `--race=${r}`];
      if (APPLY) args.push('--apply');
      const res = spawnSync('npx', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      const out = (res.stdout || '') + (res.stderr || '');
      const n = out.match(/Зміни \((\d+)\)/);
      console.log(`    Г${r}: ${APPLY ? 'записано' : 'буде записано'} ${n ? n[1] : '?'} правок`);
    }
  }
  if (!APPLY) console.log('\n(dry-run — додай --apply щоб застосувати)');
}
main().catch(e => { console.error(e); process.exit(1); });
