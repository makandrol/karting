/**
 * Survey the 75% DNF threshold across all in-scope LL competitions.
 *
 * For each race-session group, compute leader laps and each pilot's valid-lap
 * count, then check whether the sheet assigned that pilot a finish position.
 * Prints pilots whose lap fraction is "borderline" (40%-95%) to reveal where
 * the real cutoff lies.
 */
import { fetchAllCompetitions, fetchLaps, fetchSheetCsv, parseLlSheet, llSheetUrl, LL_TABS, extractSurname } from './lib';
import { parseLapSec } from '../../src/utils/scoring';

// map competition date (YYYY-MM-DD) → LL tab gid (DD.MM)
function gidForDate(date: string): string | null {
  const [, mm, dd] = date.split('-');
  const label = `${dd}.${mm}`;
  for (const [gid, l] of Object.entries(LL_TABS)) if (l === label) return gid;
  return null;
}

async function main() {
  const comps = (await fetchAllCompetitions())
    .filter(c => c.format === 'light_league' && c.date >= '2026-04-14')
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`Surveying ${comps.length} LL competitions for DNF threshold\n`);
  console.log('comp     | race phase        | pilot                  | laps/leader = frac | sheetFinish');
  console.log('-'.repeat(100));

  for (const comp of comps) {
    const gid = gidForDate(comp.date);
    if (!gid) { console.log(`${comp.date}: no sheet gid`); continue; }
    let sheet;
    try { sheet = parseLlSheet(await fetchSheetCsv(llSheetUrl(gid)), 2); }
    catch { console.log(`${comp.date}: sheet fetch failed`); continue; }
    const sheetBy = new Map(sheet.map(sp => [sp.surname, sp]));

    const raceSessions = comp.sessions.filter(s => /^race_\d+_group_\d+$/.test(s.phase || ''));
    for (const rs of raceSessions) {
      const m = rs.phase!.match(/race_(\d+)_/);
      const raceIdx = m ? parseInt(m[1]) - 1 : 0;
      const laps = await fetchLaps(rs.sessionId);
      const cnt = new Map<string, number>();
      for (const l of laps) { const sec = parseLapSec(l.lap_time); if (sec == null || sec < 38) continue; cnt.set(l.pilot, (cnt.get(l.pilot) || 0) + 1); }
      if (cnt.size === 0) continue;
      const leader = Math.max(...cnt.values());
      for (const [pilot, c] of cnt) {
        if (/^Карт\s+\d+$/i.test(pilot)) continue;
        const frac = c / leader;
        if (frac >= 0.95) continue; // clearly finished
        const sp = sheetBy.get(extractSurname(pilot));
        const sheetFin = sp?.races[raceIdx]?.finishPos;
        console.log(`${comp.date} | ${rs.phase!.padEnd(17)} | ${pilot.padEnd(22)} | ${c}/${leader} = ${(frac * 100).toFixed(0)}% | sheet=${sheetFin ?? '(none)'}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
