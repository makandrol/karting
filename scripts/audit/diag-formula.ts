/**
 * Reverse-engineer the sheet's start-position formula for race 1, group 1
 * of 14.04 LL, where Синяговський (quali rank 10 in group) was a no-show.
 */
import { fetchCompetition, fetchScoring, fetchLaps } from './lib';
import { parseLapSec } from '../../src/utils/scoring';

// sheet race1 starts (group 1), keyed by surname-ish
const SHEET_G1: Record<string, number> = {
  'Сарнацький': 13, 'Верніченко': 12, 'Дулін': 10, 'Кочубей': 9, 'Устінов': 8,
  'Кікоть': 7, 'Кривша': 6, 'Андрій': 5, 'Васильченко': 4, 'Синяговський': 4,
  'Косовський': 3, 'Філатов': 2, 'Білявський': 1,
};
const NOSHOW = 'Синяговський';

async function main() {
  const comp = await fetchCompetition('light_league-2026-04-14-mnyxvquu');
  // group 1 = top 13 quali. Build quali order.
  const qs = comp.sessions.filter(s => s.phase?.startsWith('qualifying'));
  const best = new Map<string, number>();
  for (const s of qs) for (const l of await fetchLaps(s.sessionId)) {
    const sec = parseLapSec(l.lap_time); if (sec == null || sec < 38) continue;
    if (!best.has(l.pilot) || sec < best.get(l.pilot)!) best.set(l.pilot, sec);
  }
  const KART = /^Карт\s+\d+$/i;
  const sorted = [...best.entries()].filter(([p]) => !KART.test(p)).sort((a, b) => a[1] - b[1]).map(([p]) => p);
  const g1 = sorted.slice(0, 13); // group 1

  console.log('Group 1 quali order (rank → pilot → sheetStart):');
  g1.forEach((p, i) => {
    const key = Object.keys(SHEET_G1).find(k => p.includes(k));
    console.log(`  rank${(i + 1).toString().padStart(2)}  ${p.padEnd(22)} sheet=${key ? SHEET_G1[key] : '?'}`);
  });

  // Hypothesis A: full reverse over 13 → st = 13 - rank + 1
  // Hypothesis B: no-show removed from grid; real racers (12) reversed among themselves
  //   keeping their quali rank order; no-show gets full-reverse value.
  const noshowIdx = g1.findIndex(p => p.includes(NOSHOW));
  const racers = g1.filter(p => !p.includes(NOSHOW));
  console.log(`\nno-show rank=${noshowIdx + 1}, racers=${racers.length}`);

  const test = (label: string, fn: (pilot: string, rankInG1: number, rankInRacers: number) => number) => {
    let ok = 0, bad: string[] = [];
    g1.forEach((p, i) => {
      const key = Object.keys(SHEET_G1).find(k => p.includes(k));
      const target = key ? SHEET_G1[key] : null;
      const ri = racers.findIndex(rp => rp === p);
      const got = fn(p, i + 1, ri);
      if (target != null && got === target) ok++;
      else if (target != null) bad.push(`${p}: got ${got} want ${target}`);
    });
    console.log(`\n[${label}] match ${ok}/13`);
    bad.forEach(b => console.log('   ✗ ' + b));
  };

  test('A: full reverse 13', (p, rank) => 14 - rank);
  test('B: no-show removed, racers reverse 1..12 by their order', (p, rank, ri) => {
    if (p.includes(NOSHOW)) return 14 - rank; // ref value
    return racers.length - ri; // reverse among 12 racers
  });
}
main().catch(e => { console.error(e); process.exit(1); });
