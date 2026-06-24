/**
 * Recreate a competition from its first session, mirroring the frontend
 * SessionTypeChanger flow (create → link qualifying_1 → auto-link the rest via
 * detectGroupsFromSessionSequence + planAutoLink).
 *
 * DRY-RUN by default. Pass --apply to actually delete+create+link on the
 * collector. Prints the planned structure either way.
 *
 * Usage:
 *   npx tsx scripts/audit/recreate.ts <competitionId> [--apply]
 */
import {
  fetchCompetition, fetchSessionsByDate, fetchLaps, COLLECTOR, type CompetitionDto,
} from './lib';
import { parseLapSec } from '../../src/utils/scoring';
import {
  detectGroupsFromSessionSequence, buildFullPhases,
  type SequentialSession,
} from '../../src/utils/competitionLinking';

const APPLY = process.argv.includes('--apply');
// Optional overrides: --name="..." --date=YYYY-MM-DD
function argVal(flag: string): string | undefined {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
}
const NAME_OVERRIDE = argVal('--name');
const DATE_OVERRIDE = argVal('--date');

function isValidSession(s: { start_time: number; end_time: number | null }): boolean {
  return s.end_time != null && (s.end_time - s.start_time) >= 60000;
}

async function buildSeq(sessionIds: string[]): Promise<SequentialSession[]> {
  const seq: SequentialSession[] = [];
  for (const id of sessionIds) {
    const laps = await fetchLaps(id);
    const pilots = new Set(laps.map(l => l.pilot));
    const lapCounts = new Map<string, number>();
    for (const l of laps) lapCounts.set(l.pilot, (lapCounts.get(l.pilot) || 0) + 1);
    seq.push({ id, pilots, lapCounts, isFinished: true });
  }
  return seq;
}

async function main() {
  const compId = process.argv[2];
  if (!compId) { console.error('usage: tsx scripts/audit/recreate.ts <competitionId> [--apply]'); process.exit(1); }

  const comp = await fetchCompetition(compId);
  const sortedSess = [...comp.sessions].sort((a, b) => (parseInt(a.sessionId.replace('session-', '')) || 0) - (parseInt(b.sessionId.replace('session-', '')) || 0));
  const firstSession = sortedSess[0]?.sessionId;
  if (!firstSession) { console.error('competition has no sessions'); process.exit(1); }
  const firstTs = parseInt(firstSession.replace('session-', ''));

  console.log(`MODE: ${APPLY ? 'APPLY (will write!)' : 'DRY-RUN'}`);
  console.log(`Competition: ${comp.name} (${comp.format}) ${comp.id}`);
  console.log(`First session: ${firstSession} @ ${new Date(firstTs).toISOString()}`);
  console.log(`Current linked sessions (${comp.sessions.length}):`);
  for (const s of sortedSess) console.log(`  ${(s.phase || '—').padEnd(18)} ${s.sessionId}`);

  // Preserve key results fields we must not lose
  const keep = comp.results || {};
  const preserved: any = {
    trackId: keep.trackId,
    racePilotCount: keep.racePilotCount,
    excludedPilots: keep.excludedPilots,
    excludedLaps: keep.excludedLaps,
    groupCountOverride: keep.groupCountOverride,
    totalPilotsOverride: keep.totalPilotsOverride,
    totalPilotsLocked: keep.totalPilotsLocked,
    edits: keep.edits,
    editLog: keep.editLog,
  };
  console.log(`\nPreserved results fields: ${JSON.stringify(Object.fromEntries(Object.entries(preserved).filter(([, v]) => v !== undefined)))}`);

  // --- Plan auto-link from the first session, like the frontend ---
  // IMPORTANT: derive the day from the FIRST SESSION timestamp, not comp.date
  // (comp.date can be wrong, as seen with the LL 28.04 mislabeled as 29.04).
  const firstSessDate = new Date(firstTs);
  const date = `${firstSessDate.getUTCFullYear()}-${String(firstSessDate.getUTCMonth() + 1).padStart(2, '0')}-${String(firstSessDate.getUTCDate()).padStart(2, '0')}`;
  if (date !== comp.date) console.log(`\n⚠️  comp.date=${comp.date} but first session is on ${date} — using ${date}`);
  const all = await fetchSessionsByDate(date);
  const after = all
    .filter(s => isValidSession(s) && s.best_lap_time != null)
    .filter(s => s.start_time > firstTs)
    .filter(s => !s.competition_id || s.competition_id === comp.id)
    .sort((a, b) => a.start_time - b.start_time)
    .map(s => (s.merged_session_ids?.[0] || s.id));

  const detectOrder = [firstSession, ...after];
  const seq = await buildSeq(detectOrder);
  const { groupCount, qualifyingCount } = detectGroupsFromSessionSequence(seq, comp.format);

  // Build the phase list correctly: qualifying phases are capped by the number
  // of QUALIFYING sessions (can be up to 4 for LL), while race group_N phases
  // are capped by groupCount. (filterPhases alone caps qualifying_N by
  // groupCount too, which wrongly drops qualifying_4 when groupCount=3.)
  const allPhases = buildFullPhases(comp.format);
  const phases = allPhases.filter(p => {
    if (p.startsWith('qualifying_') && !/group_/.test(p)) {
      const num = parseInt(p.split('_')[1]);
      return num <= Math.max(qualifyingCount, groupCount);
    }
    const gm = p.match(/group_(\d+)/);
    if (gm) return parseInt(gm[1]) <= groupCount;
    return true;
  });
  console.log(`\nDetected groupCount=${groupCount} (qualifyingCount=${qualifyingCount})`);
  console.log(`Phases (${phases.length}): ${phases.join(', ')}`);

  // Sequentially assign phases to the chronological sessions (first + after).
  const orderedSessions = [firstSession, ...after];
  const plannedLinks = phases.slice(0, orderedSessions.length).map((phase, i) => ({
    sessionId: orderedSessions[i], phase,
  }));
  console.log(`\nPLANNED LINKS (${plannedLinks.length}):`);
  for (const l of plannedLinks) {
    const ts = parseInt(l.sessionId.replace('session-', '')) || 0;
    console.log(`  ${new Date(ts).toISOString().slice(11, 16)}  ${(l.phase || '—').padEnd(18)} ${l.sessionId}`);
  }

  // Compare planned vs current
  const curMap = new Map(sortedSess.map(s => [s.sessionId, s.phase]));
  const planMap = new Map(plannedLinks.map(l => [l.sessionId, l.phase]));
  const same = sortedSess.length === plannedLinks.length &&
    [...planMap].every(([sid, ph]) => curMap.get(sid) === ph);
  console.log(`\nSTRUCTURE MATCHES CURRENT: ${same ? 'YES ✓' : 'NO ✗'}`);
  if (!same) {
    for (const [sid, ph] of planMap) if (curMap.get(sid) !== ph) console.log(`  planned ${sid} → ${ph} (was ${curMap.get(sid) ?? 'unlinked'})`);
    for (const [sid, ph] of curMap) if (!planMap.has(sid)) console.log(`  current ${sid} → ${ph} would be DROPPED`);
  }

  if (!APPLY) { console.log('\n(dry-run — no changes written. Re-run with --apply to execute.)'); return; }

  // --- APPLY ---
  console.log('\n=== APPLYING ===');
  const post = async (path: string, body: any) => {
    const res = await fetch(`${COLLECTOR}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const del = async (path: string) => {
    const res = await fetch(`${COLLECTOR}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
    return res.json();
  };

  // 1) delete old competition
  await del(`/competitions/${encodeURIComponent(comp.id)}`);
  console.log('deleted old competition');

  // 2) recreate with same id, optionally overriding name/date
  const newName = NAME_OVERRIDE ?? comp.name;
  const newDate = DATE_OVERRIDE ?? comp.date;
  await post('/competitions', { id: comp.id, name: newName, format: comp.format, date: newDate, sessions: [], status: 'finished' });
  console.log(`created competition (name="${newName}", date=${newDate})`);

  // 3) set preserved results (groupCount detection etc.)
  const resultsPatch = { ...preserved, autoDetectedGroups: groupCount };
  await fetch(`${COLLECTOR}/competitions/${encodeURIComponent(comp.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: resultsPatch }) });
  console.log('patched results (preserved fields + autoDetectedGroups)');

  // 4) link sessions
  for (const l of plannedLinks) {
    await post(`/competitions/${encodeURIComponent(comp.id)}/link-session`, { sessionId: l.sessionId, phase: l.phase });
  }
  console.log(`linked ${plannedLinks.length} sessions`);
  console.log('DONE');
}
main().catch(e => { console.error(e); process.exit(1); });
