/**
 * Відлінкувати ДУБЛЬ-СЕСІЇ: рядки з побайтово ідентичними колами.
 *
 * Причина дублів — баг поллера (виправлений у v0.3.49): при короткому
 * «блиманні» таймінгу створювалась НОВА сесія, і API віддавав ті самі кола
 * вдруге. Дані вже записані, тож історію чистимо окремо.
 *
 * Лишаємо РАНІШУ сесію (у неї коректний start_time), відлінковуємо пізнішу.
 *
 * DRY-RUN за замовчуванням.
 */
const BASE = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';
const APPLY = process.argv.includes('--apply');
const get = async p => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${p} → ${r.status} ${await r.text().catch(() => '')}`);
  return r.json().catch(() => ({}));
};
const kyiv = ts => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', hour12: false, hour: '2-digit', minute: '2-digit' });
  const p = {}; for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return `${p.hour}:${p.minute}`;
};

const FROM = process.env.FROM_DATE || '2026-06-01';
const all = await get('/competitions');
const comps = all.filter(c => (c.date || '') >= FROM).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

console.log(APPLY ? '*** РЕЖИМ ЗАПИСУ ***\n' : '--- DRY-RUN ---\n');
let total = 0;

for (const c of comps) {
  const sess = (typeof c.sessions === 'string' ? JSON.parse(c.sessions) : c.sessions)
    .slice().sort((a, b) => (+a.sessionId.replace('session-', '')) - (+b.sessionId.replace('session-', '')));

  const sigs = new Map();  // lapSig → перший sessionId
  const dups = [];
  for (const s of sess) {
    let laps = [];
    try { const raw = await get(`/db/laps?session=${s.sessionId}`); laps = Array.isArray(raw) ? raw : (raw.laps || []); } catch {}
    if (laps.length === 0) continue;
    const sig = laps.map(l => `${l.pilot}|${l.lap_time}|${l.ts}`).sort().join(';');
    if (sigs.has(sig)) dups.push({ keep: sigs.get(sig), drop: s, laps: laps.length });
    else sigs.set(sig, s);
  }
  if (dups.length === 0) continue;

  console.log(`${c.date}  ${c.name}`);
  for (const d of dups) {
    const kTs = +d.keep.sessionId.replace('session-', '');
    const dTs = +d.drop.sessionId.replace('session-', '');
    console.log(`   лишаю  ${kyiv(kTs)}  ${d.keep.phase}  (${d.laps} кіл)`);
    console.log(`   прибираю ${kyiv(dTs)}  ${d.drop.phase}  ← дубль тих самих кіл`);
    if (APPLY) {
      await post(`/competitions/${encodeURIComponent(c.id)}/unlink-session`, { sessionId: d.drop.sessionId });
      console.log('   ✓ відлінковано');
    }
    total++;
  }
  console.log('');
}

console.log(`${APPLY ? 'Відлінковано' : 'Знайдено'} дублів: ${total}`);
if (!APPLY && total) console.log('Додай --apply щоб застосувати.');
