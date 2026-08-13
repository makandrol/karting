/**
 * Перевіряє, що прокат наступного дня НЕ прилипає до незавершеного змагання.
 *
 * Відтворює ЛЧ 12.08 (з незаповненою останньою фазою, як було на проді),
 * потім прогонює через autoLink перший прокат 13.08 і показує результат.
 */
import { storage } from '../src/storage.js';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROD = 'https://ekarting.duckdns.org';
const getJson = async p => { const r = await fetch(PROD + p); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };

const db = new Database(join(__dirname, '..', 'data', 'karting.db'));
db.exec('DELETE FROM competitions; DELETE FROM laps; DELETE FROM events; DELETE FROM sessions;');
storage._clearCaches();

// сім заїздів змагання 12.08 (без останньої гонки — саме той стан, що був на проді)
const COMP_SESSIONS = [
  ['session-1786555594625', 'qualifying_1'],
  ['session-1786556498306', 'qualifying_2'],
  ['session-1786557679870', 'race_1_group_2'],
  ['session-1786558478166', 'race_1_group_1'],
  ['session-1786559674372', 'race_2_group_2'],
  ['session-1786560438459', 'race_2_group_1'],
  ['session-1786562352864', 'race_3_group_2'],
];
const RENTAL_13 = 'session-1786612281645'; // 13.08 12:11 — "Саша/Ваня/Олег"

async function restore(id) {
  const laps = await getJson(`/db/laps?session=${id}`).then(x => Array.isArray(x) ? x : (x.laps || []));
  const startTs = parseInt(id.replace('session-', ''));
  const lastTs = laps.length ? Math.max(...laps.map(l => l.ts)) : startTs;
  storage.createSession(id, startTs, 12, { trackId: 1, raceNumber: 1, isRace: 0 });
  for (const l of laps) {
    storage.addLap(id, {
      pilot: l.pilot, kart: l.kart, lapNumber: l.lap_number, lastLap: l.lap_time,
      s1: l.s1, s2: l.s2, bestLap: l.best_lap, position: l.position, ts: l.ts,
    });
  }
  storage.endSession(id, lastTs + 30000);
}

for (const [id] of COMP_SESSIONS) await restore(id);
await restore(RENTAL_13);

storage.createCompetition({
  id: 'champions_league-2026-08-12-test', name: 'ЛЧ, 12.08.26, Тр. 5R',
  format: 'champions_league', date: '2026-08-12',
  sessions: COMP_SESSIONS.map(([sessionId, phase]) => ({ sessionId, phase })),
  results: { autoDetectedGroups: 2 }, status: 'live',
});

console.log('Змагання live, 7/8 фаз заповнено; вільна: race_3_group_1');
console.log(`\nПрогоняю прокат 13.08 12:11 (${RENTAL_13}) через autoLink...\n`);

const linked = storage.autoLinkSessionToActiveCompetition(RENTAL_13);
storage.finalizeSessionPhaseOnFirstLap(RENTAL_13);
const row = storage.getSessionsByDate?.('2026-08-13')?.find(s => s.id === RENTAL_13);
storage.finalizeSessionOnEnd(RENTAL_13, parseInt(RENTAL_13.replace('session-', '')), parseInt(RENTAL_13.replace('session-', '')) + 617000);

const after = storage.getCompetition('champions_league-2026-08-12-test');
const stuck = after.sessions.find(s => s.sessionId === RENTAL_13);

console.log(`autoLink вернув: ${JSON.stringify(linked)}`);
console.log(`Заїздів у змаганні: ${after.sessions.length} (було 7)`);
console.log(`\n${stuck ? `❌ ПРОВАЛ: прокат прилип як ${stuck.phase}` : '✅ ОК: прокат НЕ прилип до змагання'}`);
