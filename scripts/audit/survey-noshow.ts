/**
 * Survey: for every competition of a format, compare the number of pilots that
 * appear in qualifying vs the number that actually raced. Quali-only no-shows
 * inflate `totalPilots`, which flips the positionPoints tier and reshuffles
 * group splitting — the usual root cause of "everything is off by a bit".
 *
 * Usage: npx tsx scripts/audit/survey-noshow.ts [--format=champions_league]
 */
import { fetchAllCompetitions, fetchCompetition, fetchLaps } from './lib';
import { parseLapSec } from '../../src/utils/scoring';

const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const FORMAT = argVal('--format') || 'champions_league';
const KART_RE = /^Карт\s+\d+$/i;

async function main() {
  const all = (await fetchAllCompetitions())
    .filter(c => c.format === FORMAT)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  console.log(`NO-SHOW SURVEY — ${FORMAT}, ${all.length} competitions\n`);
  console.log('Дата        Квала  Гонки  Тільки квала');
  console.log('-'.repeat(80));
  for (const c0 of all) {
    const c = await fetchCompetition(c0.id);
    const quali = new Set<string>();
    const raced = new Set<string>();
    const raceSessions = c.sessions.filter(s => s.phase?.startsWith('race_'));
    for (const s of c.sessions) {
      const laps = await fetchLaps(s.sessionId);
      const target = s.phase?.startsWith('qualifying') ? quali : (s.phase?.startsWith('race_') ? raced : null);
      if (!target) continue;
      for (const l of laps) {
        const sec = parseLapSec(l.lap_time);
        if (sec == null || sec < 38) continue;
        if (KART_RE.test((l.pilot || '').trim())) continue;
        target.add(l.pilot);
      }
    }
    const only = [...quali].filter(p => !raced.has(p));
    const mark = only.length ? '  ← ' + only.join(', ') : '';
    console.log(`${(c0.date || '').padEnd(12)}${String(quali.size).padStart(5)}${String(raced.size).padStart(7)}${String(only.length).padStart(7)}${mark}  [${raceSessions.length} race-сесій]`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
