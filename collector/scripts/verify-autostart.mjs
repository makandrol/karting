/**
 * Перевірка РЕАЛІЗОВАНОГО правила автостарту на реальних даних.
 *
 * Тягне заїзди днів змагань із прода і прогонює через справжній
 * `isAutoStartCandidate` + `MIN_RENTAL_PILOTS` із competition-link-utils.js
 * (не копію логіки!), симулюючи те, що робитиме колектор: іде по заїздах дня
 * і бере ПЕРШИЙ, що проходить правило.
 *
 * Прод не чіпає — лише читає.
 */
import { isAutoStartCandidate, MIN_RENTAL_PILOTS, COMPETITION_SCHEDULE, getKyivLocalParts } from '../src/competition-link-utils.js';

const PROD = process.env.PROD_URL || 'https://ekarting.duckdns.org';
const getJson = async p => { const r = await fetch(PROD + p); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
const hhmm = ts => { const k = getKyivLocalParts(ts); return `${String(k.hour).padStart(2, '0')}:${String(k.minute).padStart(2, '0')}`; };

const DOW = { 1: 'Пн', 2: 'Вт', 3: 'Ср' };

const all = await getJson('/competitions');
const comps = all
  .filter(c => ['gonzales', 'light_league', 'champions_league'].includes(c.format))
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

const perDay = { 1: [], 2: [], 3: [] };

for (const c of comps) {
  const sess = typeof c.sessions === 'string' ? JSON.parse(c.sessions) : c.sessions;
  if (!sess.length) continue;
  const compIds = new Set(sess.map(s => s.sessionId));

  let day; try { day = await getJson(`/db/sessions?date=${c.date}`); } catch { continue; }
  const raw = day.map(s => ({
    id: s.id, merged: s.merged_session_ids || [], start: s.start_time,
    pilots: s.real_pilot_count ?? s.pilot_count ?? 0,
  })).sort((a, b) => a.start - b.start);

  // перший заїзд змагання — строго за sessionId
  const idx = raw.findIndex(s => compIds.has(s.id) || s.merged.some(x => compIds.has(x)));
  if (idx <= 0) continue;

  const dow = getKyivLocalParts(raw[idx].start).dayOfWeek;
  if (!COMPETITION_SCHEDULE[dow]) continue;
  if (COMPETITION_SCHEDULE[dow].format !== c.format) continue; // напр. ЛЧ у п'ятницю

  // симуляція правила
  let fired = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].pilots < MIN_RENTAL_PILOTS) continue;
    let j = i - 1;
    while (j >= 0 && raw[j].pilots < MIN_RENTAL_PILOTS) j--;
    const v = isAutoStartCandidate({
      sessionStartTs: raw[i].start,
      prevRentalStartTs: j >= 0 ? raw[j].start : null,
    });
    if (v.ok) { fired = i; break; }
  }

  perDay[dow].push({
    date: c.date, name: c.name,
    firstHHMM: hhmm(raw[idx].start),
    firedHHMM: fired >= 0 ? hhmm(raw[fired].start) : null,
    verdict: fired === idx ? 'exact' : fired === -1 ? 'none' : 'early',
    firedPilots: fired >= 0 ? raw[fired].pilots : null,
  });
}

let totalExact = 0, totalEarly = 0, totalNone = 0;
for (const [dow, list] of Object.entries(perDay)) {
  if (!list.length) continue;
  const s = COMPETITION_SCHEDULE[dow];
  const exact = list.filter(x => x.verdict === 'exact').length;
  const early = list.filter(x => x.verdict === 'early');
  const none = list.filter(x => x.verdict === 'none');
  totalExact += exact; totalEarly += early.length; totalNone += none.length;

  console.log(`\n=== ${DOW[dow]} (${s.format}) — поріг ${String(s.startHour).padStart(2, '0')}:${String(s.startMin).padStart(2, '0')}, розрив ≥${s.minGapMin}хв — n=${list.length}`);
  console.log(`   ✅ точно: ${exact}/${list.length}   ⚠️ рано: ${early.length}   ✗ не спрацював: ${none.length}`);
  for (const x of early) console.log(`      ⚠️ ${x.date}: спрацював на ${x.firedHHMM}/${x.firedPilots}п, а треба ${x.firstHHMM}`);
  for (const x of none) console.log(`      ✗ ${x.date}: не спрацював (1-й заїзд ${x.firstHHMM})`);
}

const n = totalExact + totalEarly + totalNone;
console.log(`\n${'='.repeat(60)}`);
console.log(`ВСЬОГО: ${n} змагань → точно ${totalExact} (${(totalExact / n * 100).toFixed(0)}%), рано ${totalEarly}, не спрацював ${totalNone}`);
