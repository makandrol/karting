/**
 * Локальна перевірка фіксу лінкування Гонзалеса на РЕАЛЬНИХ даних.
 *
 * Тягне сесії + кола реального змагання з прод-колектора у ЛОКАЛЬНУ БД,
 * ганяє `replayLinkingForDate` (той самий код, що live-поллінг) і порівнює
 * отримані фази з очікуваними за таблицею.
 *
 * Прод НЕ чіпає — лише читає.
 *
 * Usage: node collector/scripts/verify-gonzales-linking.mjs <competitionId> [YYYY-MM-DD]
 */
import { storage } from '../src/storage.js';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROD = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';

const compId = process.argv[2];
if (!compId) {
  console.error('usage: node collector/scripts/verify-gonzales-linking.mjs <competitionId>');
  process.exit(1);
}

const getJson = async path => {
  const res = await fetch(`${PROD}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
};

const comp = await getJson(`/competitions/${encodeURIComponent(compId)}`);
const sessions = typeof comp.sessions === 'string' ? JSON.parse(comp.sessions) : comp.sessions;
const results = typeof comp.results === 'string' ? JSON.parse(comp.results || '{}') : (comp.results || {});
const date = process.argv[3] || comp.date;

console.log(`Змагання: ${comp.name} (${compId})`);
console.log(`Фази на проді: ${sessions.map(s => s.phase).join(', ')}\n`);

// --- наповнюємо локальну БД тими самими сесіями/колами ---
const db = new Database(join(__dirname, '..', 'data', 'karting.db'));
db.exec('DELETE FROM competitions; DELETE FROM laps; DELETE FROM events; DELETE FROM sessions;');
storage._clearCaches();

const dayRows = await getJson(`/db/sessions?date=${date}`);
const wanted = new Set(sessions.map(s => s.sessionId));
const rows = (Array.isArray(dayRows) ? dayRows : []).filter(r => wanted.has(r.id)).sort((a, b) => a.start_time - b.start_time);

for (const r of rows) {
  storage.createSession(r.id, r.start_time, r.pilot_count ?? 5, {
    trackId: r.track_id ?? 1, raceNumber: r.race_number ?? null, isRace: r.is_race ?? 0,
  });
  const raw = await getJson(`/db/laps?session=${r.id}`);
  const laps = Array.isArray(raw) ? raw : (raw.laps || []);
  for (const l of laps) {
    storage.addLap(r.id, {
      pilot: l.pilot, kart: l.kart, lapNumber: l.lap_number,
      lastLap: l.lap_time, s1: l.s1, s2: l.s2, bestLap: l.best_lap,
      position: l.position, ts: l.ts,
    });
  }
  if (r.end_time) storage.endSession(r.id, r.end_time);
}
console.log(`Локально відтворено ${rows.length} заїздів, ${db.prepare('SELECT COUNT(*) c FROM laps').get().c} кіл.`);

// --- порожнє змагання + replay лінкування ---
storage.createCompetition({
  id: compId, name: comp.name, format: comp.format, date,
  sessions: [], results: { gonzalesRoundCount: results.gonzalesRoundCount }, status: 'live',
});

const fromTs = rows[0].start_time;
storage.replayLinkingForDate(date, fromTs);

const after = storage.getCompetition(compId);
console.log(`\nФази після replay з фіксом:`);
const byId = new Map(after.sessions.map(s => [s.sessionId, s.phase]));
let shifted = 0;
for (const r of rows) {
  const before = sessions.find(s => s.sessionId === r.id)?.phase ?? '—';
  const now = byId.get(r.id) ?? '(не залінковано)';
  const time = new Date(r.start_time + 3 * 3600e3).toISOString().slice(11, 16);
  const mark = before === now ? ' ' : '≠';
  if (before !== now) shifted++;
  console.log(`  ${time}  ${mark} ${String(before).padEnd(16)} → ${now}`);
}
console.log(`\nЗмінилось фаз: ${shifted}/${rows.length}`);

const roundNums = rows.map(r => byId.get(r.id)).filter(p => p?.startsWith('round_')).map(p => +p.match(/\d+/)[0]);
const sequential = roundNums.every((n, i) => n === i + 1);
console.log(`Раунди послідовні (1..N без пропусків): ${sequential ? 'ТАК' : 'НІ → ' + roundNums.join(',')}`);
