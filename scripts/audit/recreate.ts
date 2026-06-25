/**
 * Recreate a competition from its first session using the COLLECTOR's REAL
 * linking logic (the same code the live poller runs):
 *   1. remember current linked sessions
 *   2. delete the competition
 *   3. create an empty `live` competition (so autoLink targets it)
 *   4. restore preserved results fields
 *   5. POST /competitions/:id/replay-link → collector replays
 *        autoLinkSessionToActiveCompetition + finalizeSessionPhaseOnFirstLap +
 *        autoUnlinkSession for every session of the day, exactly like the poller
 *   6. set status back to finished
 *   7. print what the real logic produced vs the previous structure
 *
 * No client-side detection — we test the actual production logic.
 *
 * DRY-RUN by default (only prints current structure). --apply to execute.
 * Optional: --name="..." --date=YYYY-MM-DD (fix a mislabeled competition).
 *
 * Usage: npx tsx scripts/audit/recreate.ts <competitionId> [--apply] [--name=] [--date=]
 */
import { fetchCompetition, fetchSessionsByDate, COLLECTOR, kyivTime } from './lib';
import { isCompetitionTime } from '../../collector/src/competition-link-utils.js';

const APPLY = process.argv.includes('--apply');
const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};

async function main() {
  const compId = process.argv[2];
  if (!compId) { console.error('usage: tsx scripts/audit/recreate.ts <competitionId> [--apply]'); process.exit(1); }

  const comp = await fetchCompetition(compId);
  const sortedSess = [...comp.sessions].sort((a, b) => (parseInt(a.sessionId.replace('session-', '')) || 0) - (parseInt(b.sessionId.replace('session-', '')) || 0));
  const firstSession = sortedSess[0]?.sessionId;
  if (!firstSession) { console.error('competition has no sessions'); process.exit(1); }
  const firstTs = parseInt(firstSession.replace('session-', ''));

  // day from FIRST SESSION (comp.date can be wrong, e.g. LL 28.04 saved as 29.04)
  const fd = new Date(firstTs);
  const date = `${fd.getUTCFullYear()}-${String(fd.getUTCMonth() + 1).padStart(2, '0')}-${String(fd.getUTCDate()).padStart(2, '0')}`;

  // fromTs для replay має дорівнювати РЕАЛЬНОМУ start_time першої ВАЛІДНОЇ
  // сесії змагання, а не timestamp з sessionId першої *залінкованої* сесії.
  // Дві причини:
  //  1) sessionId присвоюється на ~100-200мс ПІЗНІШЕ за start_time → фільтр
  //     `start_time >= fromTs` у replayLinkingForDate викидав би першу сесію.
  //  2) Якщо перша квала вже відлінкована (баг), вона зникає зі списку
  //     comp.sessions — тож firstSession вказує на ДРУГУ квалу. Беремо
  //     найранішу сесію дня у вікні змагання (≥19:45 Kyiv) з реальними колами.
  const daySessions = await fetchSessionsByDate(date);
  const firstValid = [...daySessions]
    .sort((a, b) => a.start_time - b.start_time)
    .find(s => isCompetitionTime(s.start_time) && (s.pilot_count ?? 0) > 0);
  const linkedRow = daySessions.find(s => s.id === firstSession || (s.merged_session_ids || []).includes(firstSession));
  // Беремо ранішу з двох (валідна у вікні vs перша залінкована) — щоб не
  // пропустити квалу, яка випала, але й не почати раніше за вікно змагання.
  const replayFromTs = Math.min(
    firstValid ? firstValid.start_time : Infinity,
    linkedRow ? linkedRow.start_time : firstTs,
  );

  console.log(`MODE: ${APPLY ? 'APPLY (will write!)' : 'DRY-RUN'}`);
  console.log(`Competition: ${comp.name} (${comp.format}) ${comp.id}`);
  console.log(`First session: ${kyivTime(firstTs)} (${date}) ${firstSession}`);
  console.log(`Replay fromTs: ${kyivTime(replayFromTs)} (${replayFromTs})`);
  if (date !== comp.date) console.log(`⚠️  comp.date=${comp.date} but first session is on ${date}`);
  console.log(`Current linked sessions (${comp.sessions.length}):`);
  for (const s of sortedSess) console.log(`  ${kyivTime(parseInt(s.sessionId.replace('session-', '')))}  ${(s.phase || '—').padEnd(18)} ${s.sessionId}`);

  const keep = comp.results || {};
  const preserved: any = {
    trackId: keep.trackId, racePilotCount: keep.racePilotCount,
    excludedPilots: keep.excludedPilots, excludedLaps: keep.excludedLaps,
    groupCountOverride: keep.groupCountOverride,
    totalPilotsOverride: keep.totalPilotsOverride, totalPilotsLocked: keep.totalPilotsLocked,
    edits: keep.edits, editLog: keep.editLog,
  };
  const preservedClean = Object.fromEntries(Object.entries(preserved).filter(([, v]) => v !== undefined));
  console.log(`\nPreserved results: ${JSON.stringify(preservedClean)}`);

  if (!APPLY) { console.log('\n(dry-run — re-run with --apply to delete+recreate via collector logic)'); return; }

  const post = async (path: string, body: any) => {
    const res = await fetch(`${COLLECTOR}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const patch = async (path: string, body: any) => {
    const res = await fetch(`${COLLECTOR}${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const del = async (path: string) => {
    const res = await fetch(`${COLLECTOR}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
    return res.json();
  };

  console.log('\n=== APPLYING (real collector linking) ===');
  await del(`/competitions/${encodeURIComponent(comp.id)}`);
  const newName = argVal('--name') ?? comp.name;
  const newDate = argVal('--date') ?? date;
  // create LIVE so autoLinkSessionToActiveCompetition targets it
  await post('/competitions', { id: comp.id, name: newName, format: comp.format, date: newDate, sessions: [], status: 'live' });
  if (Object.keys(preservedClean).length) await patch(`/competitions/${encodeURIComponent(comp.id)}`, { results: preservedClean });
  console.log(`created live competition (name="${newName}", date=${newDate})`);

  // replay the real poller linking over the day's recorded sessions
  const { trace } = await post(`/competitions/${encodeURIComponent(comp.id)}/replay-link`, { date, fromTs: replayFromTs });
  await patch(`/competitions/${encodeURIComponent(comp.id)}`, { status: 'finished' });

  // report
  const fresh = await fetchCompetition(comp.id);
  const freshSorted = [...fresh.sessions].sort((a, b) => (parseInt(a.sessionId.replace('session-', '')) || 0) - (parseInt(b.sessionId.replace('session-', '')) || 0));
  console.log(`\nRESULT — collector linked ${fresh.sessions.length} sessions (autoDetectedGroups=${fresh.results?.autoDetectedGroups ?? '—'}):`);
  for (const s of freshSorted) console.log(`  ${kyivTime(parseInt(s.sessionId.replace('session-', '')))}  ${(s.phase || '—').padEnd(18)} ${s.sessionId}`);

  const before = new Map(sortedSess.map(s => [s.sessionId, s.phase]));
  const afterMap = new Map(freshSorted.map(s => [s.sessionId, s.phase]));
  const same = before.size === afterMap.size && [...afterMap].every(([sid, ph]) => before.get(sid) === ph);
  console.log(`\nSTRUCTURE vs BEFORE: ${same ? 'SAME ✓' : 'CHANGED ✗'}`);
  if (!same) {
    for (const [sid, ph] of afterMap) if (before.get(sid) !== ph) console.log(`  ${sid}: ${before.get(sid) ?? 'unlinked'} → ${ph}`);
    for (const [sid, ph] of before) if (!afterMap.has(sid)) console.log(`  ${sid}: ${ph} → DROPPED`);
  }
  console.log('DONE');
}
main().catch(e => { console.error(e); process.exit(1); });
