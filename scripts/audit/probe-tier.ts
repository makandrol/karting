/**
 * Which pilot count does the official sheet use for the positionPoints tier?
 * For every competition, brute-force the count N that best reproduces the
 * sheet's own base-points column, then compare it against the candidates we
 * could compute (quali participants / actual starters / sheet rows).
 *
 * Usage: npx tsx scripts/audit/probe-tier.ts [--format=champions_league]
 */
import {
  fetchAllCompetitions, fetchCompetition, fetchLaps, fetchScoring,
  fetchSheetCsv, parseLlSheet, resolveSheetUrl,
} from './lib';
import { parseLapSec, getPositionPoints } from '../../src/utils/scoring';

const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const FORMAT = argVal('--format') || 'champions_league';
const KART_RE = /^Карт\s+\d+$/i;

async function main() {
  const scoring = await fetchScoring();
  const comps = (await fetchAllCompetitions())
    .filter(c => c.format === FORMAT)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
  const padR = (s: string, n: number) => s.length >= n ? s : ' '.repeat(n - s.length) + s;
  console.log(`TIER PROBE — ${FORMAT}\n`);
  console.log(`${pad('Дата', 12)}${padR('квала', 7)}${padR('старт', 7)}${padR('табл', 6)}${padR('N best', 8)}  влучань`);
  console.log('-'.repeat(62));

  for (const c0 of comps) {
    const comp = await fetchCompetition(c0.id);
    const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
    const url = resolveSheetUrl(comp.format, firstTs);
    if (!url) { console.log(`${pad(c0.date || '', 12)}немає вкладки`); continue; }
    const raceCount = comp.format === 'champions_league' ? 3 : 2;
    const sheet = parseLlSheet(await fetchSheetCsv(url), raceCount);

    const quali = new Set<string>(), raced = new Set<string>();
    for (const s of comp.sessions) {
      const target = s.phase?.startsWith('qualifying') ? quali : (s.phase?.startsWith('race_') ? raced : null);
      if (!target) continue;
      for (const l of await fetchLaps(s.sessionId)) {
        const sec = parseLapSec(l.lap_time);
        if (sec == null || sec < 38) continue;
        if (KART_RE.test((l.pilot || '').trim())) continue;
        target.add(l.pilot);
      }
    }

    // перебір N: скільки клітинок "база" з таблиці відтворює кожен N
    let best = { n: 0, hits: -1 };
    for (let n = 5; n <= 60; n++) {
      let hits = 0, total = 0;
      for (const sp of sheet) for (let r = 0; r < raceCount; r++) {
        const sr = sp.races[r];
        if (!sr || sr.finishPos < 1 || sr.group < 1) continue;
        const label = sr.group === 1 ? 'I' : sr.group === 2 ? 'II' : 'III';
        total++;
        if (Math.abs(getPositionPoints(scoring, n, label, sr.finishPos, comp.format) - sr.basePoints) <= 0.05) hits++;
      }
      if (hits > best.hits) best = { n, hits: hits };
    }
    // скільки всього клітинок
    let total = 0;
    for (const sp of sheet) for (let r = 0; r < raceCount; r++) {
      const sr = sp.races[r];
      if (sr && sr.finishPos >= 1 && sr.group >= 1) total++;
    }
    const mark = best.n === quali.size ? ' = квала' : best.n === raced.size ? ' = стартувальники' : best.n === sheet.length ? ' = рядків у табл' : '';
    console.log(`${pad(c0.date || '', 12)}${padR(String(quali.size), 7)}${padR(String(raced.size), 7)}${padR(String(sheet.length), 6)}${padR(String(best.n), 8)}  ${best.hits}/${total}${mark}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
