/**
 * Regression harness: прогоняє replayLinkingForDate для КОЖНОГО дня ЛЧ і
 * порівнює отриману структуру з очікуваною за регламентом (2 квали + 3 гонки
 * × N груп). Ловить і те, що фікс зламав раніше робочі дні.
 *
 * Прод НЕ чіпає: тягне дані в локальну БД і ганяє справжні storage-методи.
 */
import { storage } from '../src/storage.js';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROD = process.env.PROD_URL || 'https://ekarting.duckdns.org';
const getJson = async p => { const r = await fetch(PROD + p); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
const kyiv = ts => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', hour12: false, hour: '2-digit', minute: '2-digit' });
  const p = {}; for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return `${p.hour}:${p.minute}`;
};

const FROM = process.env.FROM_DATE || '2026-06-01';
const db = new Database(join(__dirname, '..', 'data', 'karting.db'));

const all = await getJson('/competitions');
const comps = all.filter(c => c.format === 'champions_league' && (c.date || '') >= FROM)
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

/** Очікувані фази ЛЧ: квали + 3 гонки × groupCount (слабша група перша). */
function expectedRaces(gc) {
  const out = [];
  for (let r = 1; r <= 3; r++) for (let g = gc; g >= 1; g--) out.push(`race_${r}_group_${g}`);
  return out;
}

const report = [];

for (const c of comps) {
  // 1) заливаємо сирі заїзди дня у локальну БД
  db.exec('DELETE FROM competitions; DELETE FROM laps; DELETE FROM events; DELETE FROM sessions;');
  storage._clearCaches();

  const dayRows = await getJson(`/db/sessions?date=${c.date}`);
  const rows = dayRows.slice().sort((a, b) => a.start_time - b.start_time);
  for (const r of rows) {
    const ids = r.merged_session_ids && r.merged_session_ids.length > 1 ? r.merged_session_ids : [r.id];
    for (const id of ids) {
      const laps = await getJson(`/db/laps?session=${id}`).then(x => Array.isArray(x) ? x : (x.laps || [])).catch(() => []);
      const startTs = parseInt(id.replace('session-', ''));
      const lastLapTs = laps.length ? Math.max(...laps.map(l => l.ts)) : startTs;
      const endTime = ids.length > 1 ? lastLapTs + 30000 : r.end_time;
      storage.createSession(id, startTs, r.pilot_count ?? 0, {
        trackId: r.track_id ?? 1, raceNumber: r.race_number ?? null, isRace: r.is_race ?? 0,
      });
      for (const l of laps) storage.addLap(id, {
        pilot: l.pilot, kart: l.kart, lapNumber: l.lap_number, lastLap: l.lap_time,
        s1: l.s1, s2: l.s2, bestLap: l.best_lap, position: l.position, ts: l.ts,
      });
      if (endTime) storage.endSession(id, endTime);
    }
  }

  // 2) replay лінкування з початку дня
  storage.replayLinkingForDate(c.date, rows[0]?.start_time ?? 0);

  // 3) читаємо результат
  const created = db.prepare('SELECT id, name, sessions, results FROM competitions').all();
  const mine = created.find(x => JSON.parse(x.results || '{}') !== null) ?? created[0];
  const sess = mine ? JSON.parse(mine.sessions || '[]') : [];
  const res = mine ? JSON.parse(mine.results || '{}') : {};
  const gc = res.groupCountOverride ?? res.autoDetectedGroups ?? null;

  const phases = sess.map(s => s.phase);
  const uniq = new Set(phases);
  const wantRaces = gc ? expectedRaces(gc) : [];
  const missingRaces = wantRaces.filter(p => !uniq.has(p));
  const hasQuali = [...uniq].some(p => p?.startsWith('qualifying'));

  const ok = gc != null && missingRaces.length === 0 && hasQuali;
  report.push({ date: c.date, name: c.name, gc, total: sess.length, missingRaces, ok, sess });

  console.log(`${ok ? '✅' : '❌'} ${c.date}  gc=${gc ?? '?'}  заїздів=${sess.length}` +
    (missingRaces.length ? `  НЕМА: ${missingRaces.join(', ')}` : ''));
  if (!ok) {
    for (const s of sess.slice().sort((a, b) => (+a.sessionId.replace('session-', '')) - (+b.sessionId.replace('session-', '')))) {
      console.log(`       ${kyiv(+s.sessionId.replace('session-', ''))}  ${s.phase}`);
    }
  }
}

console.log('\n' + '='.repeat(70));
const bad = report.filter(r => !r.ok);
console.log(`РЕЗУЛЬТАТ: ${report.length - bad.length}/${report.length} днів дають ПОВНУ структуру`);
for (const b of bad) console.log(`  ❌ ${b.date}  gc=${b.gc}  заїздів=${b.total}  немає: ${b.missingRaces.join(', ') || '(квал)'}`);
