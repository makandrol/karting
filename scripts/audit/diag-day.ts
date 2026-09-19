/**
 * Ad-hoc day diagnostic: list every session of a date with its competition
 * link, phase, pilot count and (optionally) whether given pilots appear.
 *
 * Usage: npx tsx scripts/audit/diag-day.ts YYYY-MM-DD [pilotSubstr,...]
 */
import { fetchSessionsByDate, fetchLaps, fetchAllCompetitions, kyivTime } from './lib';
import { parseLapSec } from '../../src/utils/scoring';

async function main() {
  const date = process.argv[2];
  const want = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean);
  const sessions = await fetchSessionsByDate(date);
  const comps = await fetchAllCompetitions();
  const linkMap = new Map<string, { id: string; phase: string }>();
  for (const c of comps) for (const s of c.sessions || []) linkMap.set(s.sessionId, { id: c.id, phase: s.phase || '?' });

  console.log(`DAY ${date} — ${sessions.length} sessions\n`);
  for (const s of sessions) {
    const id = s.id;
    const ts = s.start_time || parseInt(String(id).replace('session-', ''));
    const laps = await fetchLaps(id);
    const pilots = new Map<string, number>();
    for (const l of laps) {
      const sec = parseLapSec(l.lap_time);
      if (sec == null || sec < 38) continue;
      pilots.set(l.pilot, Math.min(pilots.get(l.pilot) ?? 999, sec));
    }
    const link = linkMap.get(id);
    const lastTs = laps.length ? Math.max(...laps.map((l: any) => l.ts || 0)) : 0;
    const durSec = lastTs ? Math.round((lastTs - ts) / 1000) : 0;
    const hits = want.filter(w => [...pilots.keys()].some(p => p.includes(w)));
    console.log(`${kyivTime(ts)}  ${id}  pilots=${String(pilots.size).padStart(2)}  ~${String(durSec).padStart(4)}s  ${link ? `${link.phase} → ${link.id}` : 'НЕ ЗАЛІНКОВАНА'}`);
    if (want.length) console.log(`    містить: ${hits.length ? hits.join(', ') : '—'}`);
    if (process.argv.includes('--pilots')) console.log(`    ${[...pilots.keys()].sort().join(', ')}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
