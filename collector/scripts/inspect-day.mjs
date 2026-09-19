/**
 * Детальний розбір одного дня: усі заїзди + що залінковано, з race_number,
 * is_race, треком і перетином пілотів. Потрібно, щоб зрозуміти ПРИЧИНУ
 * неправильного лінкування (а не лише факт).
 */
const BASE = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';
const get = async p => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
const kyiv = ts => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', hour12: false, hour: '2-digit', minute: '2-digit' });
  const p = {}; for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return `${p.hour}:${p.minute}`;
};
const KART = /^Карт\s+\d+$/i;

const date = process.argv[2];
const compId = process.argv[3];
if (!date) { console.error('usage: node scripts/inspect-day.mjs <YYYY-MM-DD> [compId]'); process.exit(1); }

const day = (await get(`/db/sessions?date=${date}`)).slice().sort((a, b) => a.start_time - b.start_time);

let linked = new Set(), compName = '', phases = new Map();
if (compId) {
  const c = await get(`/competitions/${compId}`);
  const sess = typeof c.sessions === 'string' ? JSON.parse(c.sessions) : c.sessions;
  compName = c.name;
  for (const s of sess) { linked.add(s.sessionId); phases.set(s.sessionId, s.phase); }
  const res = typeof c.results === 'string' ? JSON.parse(c.results || '{}') : (c.results || {});
  console.log(`${c.name} | ${c.date} | status=${c.status} | gc=${res.groupCountOverride ?? res.autoDetectedGroups ?? '?'}\n`);
}

console.log('час    трив  пілотів трек race# isRace  фаза             пілоти');
console.log('─'.repeat(110));
for (const r of day) {
  const dur = r.end_time ? Math.round((r.end_time - r.start_time) / 1000) : null;
  let laps = [];
  try { const raw = await get(`/db/laps?session=${r.id}`); laps = Array.isArray(raw) ? raw : (raw.laps || []); } catch {}
  const pil = [...new Set(laps.map(l => l.resolved_pilot || l.pilot))];
  const real = pil.filter(p => !KART.test(p));
  const ph = phases.get(r.id) ?? (linked.has(r.id) ? '(?)' : '—');
  const mark = linked.has(r.id) ? '★' : ' ';
  const merged = (r.merged_session_ids || []).length > 1 ? ` merged=${r.merged_session_ids.length}` : '';
  console.log(
    `${mark}${kyiv(r.start_time)} ${String(dur ?? '—').padStart(5)}с ${String(r.pilot_count).padStart(4)}п` +
    ` ${String(r.track_id).padStart(4)} ${String(r.race_number ?? '—').padStart(5)} ${String(r.is_race ?? '—').padStart(6)}  ${String(ph).padEnd(16)} ` +
    `реальних=${String(real.length).padStart(2)}${merged}`
  );
  if (real.length && real.length <= 4) console.log(`         ↳ ${real.join(', ')}`);
}
