/**
 * Rebuild results.editLog from the current results.edits so the competition
 * page's "Журнал змін" reflects all manual edits (penalties / finishPos /
 * startPos) that were applied via the audit scripts or migrations.
 *
 * Idempotent-ish: replaces editLog entries that have user 'audit-script'
 * derived from edits; preserves any pre-existing UI-made entries.
 *
 * DRY-RUN unless --apply.
 *
 * Usage: npx tsx scripts/audit/rebuild-editlog.ts <competitionId> [--apply]
 */
import { fetchCompetition, COLLECTOR } from './lib';

const APPLY = process.argv.includes('--apply');

async function main() {
  const compId = process.argv[2];
  const comp = await fetchCompetition(compId);
  const edits: Record<string, any> = comp.results?.edits || {};
  const existingLog: any[] = comp.results?.editLog || [];

  // keep entries that were authored by humans via UI (not our script)
  const humanLog = existingLog.filter(e => e.user !== 'audit-script');

  const ts = Date.now();
  const derived: any[] = [];
  let i = 0;
  for (const [key, val] of Object.entries(edits)) {
    const [pilot, race] = key.split('|');
    if (val.startPos != null) derived.push({ pilot, action: 'edit', detail: `Г${race} startPos → ${val.startPos} (ручне розставлення з таблиці)`, user: 'audit-script', ts: ts + i++ });
    if (val.finishPos != null) derived.push({ pilot, action: 'edit', detail: `Г${race} finishPos → ${val.finishPos} (корекція з таблиці)`, user: 'audit-script', ts: ts + i++ });
    if (val.penalties != null && val.penalties !== 0) derived.push({ pilot, action: 'edit', detail: `Г${race} penalties → ${val.penalties} (з таблиці)`, user: 'audit-script', ts: ts + i++ });
  }

  const newLog = [...humanLog, ...derived];

  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Competition: ${comp.name}`);
  console.log(`edits: ${Object.keys(edits).length}, human log entries kept: ${humanLog.length}, derived: ${derived.length}`);
  derived.forEach(e => console.log(`  ${e.pilot} — ${e.detail}`));

  if (!APPLY) { console.log('\n(dry-run — re-run with --apply)'); return; }

  const merged = { ...(comp.results || {}), editLog: newLog };
  const res = await fetch(`${COLLECTOR}/competitions/${encodeURIComponent(comp.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: merged }),
  });
  if (!res.ok) throw new Error(`PATCH → ${res.status}: ${await res.text()}`);
  console.log(`\nrebuilt editLog (${newLog.length} entries).`);
}
main().catch(e => { console.error(e); process.exit(1); });
