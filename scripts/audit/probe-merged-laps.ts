/**
 * Collect every race lap that looks like a merged (missed-transponder) lap and
 * print, next to it, what the official sheet says about that pilot's finish.
 * Used to derive a precise detection rule instead of guessing thresholds.
 *
 * Usage: npx tsx scripts/audit/probe-merged-laps.ts [--format=champions_league]
 */
import {
  fetchAllCompetitions, fetchCompetition, fetchLaps, fetchScoring, computeOurStandings,
  fetchSheetCsv, parseLlSheet, resolveSheetUrl, buildNameMatcher, type SheetPilotFull,
} from './lib';
import { parseLapSec } from '../../src/utils/scoring';

const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const FORMAT = argVal('--format') || 'champions_league';

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const scoring = await fetchScoring();
  const comps = (await fetchAllCompetitions())
    .filter(c => c.format === FORMAT)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  console.log(`MERGED-LAP PROBE — ${FORMAT}`);
  console.log('дата       гонка гр пілот                  кіл/макс ratio коло#  Δфініш(с)  наш→табл');
  console.log('-'.repeat(104));

  for (const c0 of comps) {
    const comp = await fetchCompetition(c0.id);
    const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
    const url = resolveSheetUrl(comp.format, firstTs);
    const raceCount = comp.format === 'champions_league' ? 3 : 2;
    let sheetByName = new Map<string, SheetPilotFull>();
    let matchName: (n: string) => string | null = () => null;
    let our: Awaited<ReturnType<typeof computeOurStandings>> = [];
    if (url) {
      our = await computeOurStandings(comp, scoring);
      const sheet = parseLlSheet(await fetchSheetCsv(url), raceCount);
      sheetByName = new Map(sheet.map(s => [s.pilot, s]));
      matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
    }

    for (const s of comp.sessions) {
      const m = s.phase?.match(/^race_(\d+)_group_(\d+)$/);
      if (!m) continue;
      const raceNum = parseInt(m[1]), groupNum = parseInt(m[2]);
      const laps = await fetchLaps(s.sessionId);
      const per = new Map<string, { times: number[]; ts: number[]; pos: number[] }>();
      for (const l of laps) {
        const sec = parseLapSec(l.lap_time);
        if (sec == null || sec < 38) continue;
        const e = per.get(l.pilot) || { times: [], ts: [], pos: [] };
        e.times.push(sec); e.ts.push(l.ts); e.pos.push(l.position ?? 99);
        per.set(l.pilot, e);
      }
      if (per.size === 0) continue;
      const maxLaps = Math.max(...[...per.values()].map(v => v.times.length));
      // час фінішу лідера = найраніший останній перетин серед пілотів з повною дистанцією
      const leaderTs = Math.min(...[...per.values()].filter(v => v.times.length === maxLaps).map(v => v.ts[v.ts.length - 1]));

      for (const [pilot, v] of per) {
        const med = median(v.times);
        for (let i = 0; i < v.times.length; i++) {
          const ratio = v.times[i] / med;
          const k = Math.round(ratio);
          if (k < 2 || Math.abs(ratio - k) > 0.2) continue;
          const row = our.find(r => r.pilot === pilot);
          const sp = row ? sheetByName.get(matchName(pilot) || '') : undefined;
          const ourFin = row?.races[raceNum - 1]?.finishPos ?? 0;
          const sheetFin = sp?.races[raceNum - 1]?.finishPos ?? 0;
          const dFinish = ((v.ts[v.ts.length - 1] - leaderTs) / 1000).toFixed(0);
          const verdict = sheetFin === 0 ? '?' : (ourFin === sheetFin ? 'ok' : `${ourFin}→${sheetFin}`);
          console.log(`${(c0.date || '').padEnd(11)}Г${raceNum}   ${groupNum}  ${pilot.padEnd(22)} ${String(v.times.length).padStart(2)}/${String(maxLaps).padStart(2)}   ${ratio.toFixed(2)}  ${String(i + 1).padStart(2)}/${String(v.times.length).padStart(2)}  ${dFinish.padStart(7)}   ${verdict}`);
        }
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
