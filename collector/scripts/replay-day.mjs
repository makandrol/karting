/**
 * Відтворює лінкування заїздів реального дня в ЛОКАЛЬНІЙ БД.
 *
 * Тягне всі заїзди дня + кола з прод-колектора, ганяє `replayLinkingForDate`
 * (ті самі storage-методи і в тому ж порядку, що live-полінг) і друкує, який
 * заїзд яку фазу отримав. Прод НЕ чіпає — лише читає.
 *
 * Usage: node collector/scripts/replay-day.mjs <YYYY-MM-DD> [HH:MM]
 */
import { storage } from '../src/storage.js';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROD = process.env.PROD_URL || 'https://ekarting.duckdns.org';

const date = process.argv[2];
const fromHHMM = process.argv[3] || null;
if (!date) {
  console.error('usage: node collector/scripts/replay-day.mjs <YYYY-MM-DD> [HH:MM]');
  process.exit(1);
}

const getJson = async path => {
  const res = await fetch(`${PROD}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
};
const kyiv = ts => new Date(ts + 3 * 3600e3).toISOString().slice(11, 16);

const db = new Database(join(__dirname, '..', 'data', 'karting.db'));
db.exec('DELETE FROM competitions; DELETE FROM laps; DELETE FROM events; DELETE FROM sessions;');
storage._clearCaches();

const rows = (await getJson(`/db/sessions?date=${date}`)).slice().sort((a, b) => a.start_time - b.start_time);
console.log(`Заїздів у дні: ${rows.length}`);

// merged_session_ids — це вже злиті для показу; нам потрібні СИРІ рядки.
// /db/sessions повертає merged, тож розкриваємо їх назад через merged_session_ids.
let restored = 0;
for (const r of rows) {
  const ids = r.merged_session_ids && r.merged_session_ids.length > 1 ? r.merged_session_ids : [r.id];
  for (const id of ids) {
    const laps = await getJson(`/db/laps?session=${id}`).then(x => Array.isArray(x) ? x : (x.laps || [])).catch(() => []);
    const startTs = parseInt(id.replace('session-', ''));
    const lastLapTs = laps.length ? Math.max(...laps.map(l => l.ts)) : startTs;
    // end_time для злитих половинок беремо приблизно (останнє коло + 30с);
    // для не-злитих — реальний end_time рядка.
    const endTime = ids.length > 1 ? lastLapTs + 30000 : r.end_time;
    storage.createSession(id, startTs, r.pilot_count ?? 0, {
      trackId: r.track_id ?? 1, raceNumber: r.race_number ?? null, isRace: r.is_race ?? 0,
    });
    for (const l of laps) {
      storage.addLap(id, {
        pilot: l.pilot, kart: l.kart, lapNumber: l.lap_number,
        lastLap: l.lap_time, s1: l.s1, s2: l.s2, bestLap: l.best_lap,
        position: l.position, ts: l.ts,
      });
    }
    if (endTime) storage.endSession(id, endTime);
    restored++;
  }
}
console.log(`Відтворено сирих заїздів: ${restored}, кіл: ${db.prepare('SELECT COUNT(*) c FROM laps').get().c}\n`);

const fromTs = fromHHMM
  ? (() => { const [h, m] = fromHHMM.split(':').map(Number); return Date.parse(`${date}T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`); })()
  : rows[0].start_time;

const trace = storage.replayLinkingForDate(date, fromTs);

console.log('\n=== РЕЗУЛЬТАТ REPLAY ===');
for (const t of trace) {
  const ts = parseInt(t.sessionId.replace('session-', ''));
  console.log(`  ${kyiv(ts)}  ${String(t.action).padEnd(16)} ${String(t.phase ?? '—').padEnd(18)} ${t.sessionId}`);
}

const finalRows = db.prepare('SELECT id, name, status, sessions FROM competitions').all();
for (const row of finalRows) {
  const sessions = JSON.parse(row.sessions || '[]');
  console.log(`\n=== ФІНАЛЬНИЙ СТАН: ${row.name} (${row.status}) — ${sessions.length} заїздів:`);
  for (const s of sessions.slice().sort((a, b) => (+a.sessionId.replace('session-', '')) - (+b.sessionId.replace('session-', '')))) {
    console.log(`  ${kyiv(+s.sessionId.replace('session-', ''))}  ${s.phase}`);
  }
}
