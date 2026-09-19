/**
 * Пошук ДУБЛЬОВАНИХ заїздів: різні session-рядки з ідентичними колами.
 *
 * Причина (ЛЧ 02.09): колектор створив другу сесію для того самого фізичного
 * заїзду — 151 коло з ідентичними ts опинились у двох рядках. Такий дубль
 * займає зайвий фазовий слот і зсуває всю структуру.
 *
 * Тільки читає прод.
 */
const BASE = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';
const get = async p => { const r = await fetch(BASE + p); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
const kyiv = ts => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', hour12: false, hour: '2-digit', minute: '2-digit' });
  const p = {}; for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return `${p.hour}:${p.minute}`;
};

const FROM = process.env.FROM_DATE || '2026-06-01';
const all = await get('/competitions');
const comps = all.filter(c => ['champions_league', 'light_league', 'gonzales', 'sprint'].includes(c.format) && (c.date || '') >= FROM)
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

const found = [];
for (const c of comps) {
  const sess = (typeof c.sessions === 'string' ? JSON.parse(c.sessions) : c.sessions)
    .slice().sort((a, b) => (+a.sessionId.replace('session-', '')) - (+b.sessionId.replace('session-', '')));

  // фінгерпринт кіл кожного заїзду
  const fps = [];
  for (const s of sess) {
    let laps = [];
    try { const raw = await get(`/db/laps?session=${s.sessionId}`); laps = Array.isArray(raw) ? raw : (raw.laps || []); } catch {}
    if (laps.length === 0) { fps.push(null); continue; }
    const sig = laps.map(l => `${l.pilot}|${l.lap_time}|${l.ts}`).sort().join(';');
    fps.push({ s, n: laps.length, sig, ts: +s.sessionId.replace('session-', '') });
  }

  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      if (!fps[i] || !fps[j]) continue;
      if (fps[i].sig !== fps[j].sig) continue;
      found.push({
        date: c.date, id: c.id, name: c.name,
        a: `${kyiv(fps[i].ts)} ${fps[i].s.phase}`,
        b: `${kyiv(fps[j].ts)} ${fps[j].s.phase}`,
        laps: fps[i].n,
        dupId: fps[j].s.sessionId,
      });
    }
  }
}

console.log(`Перевірено змагань: ${comps.length}`);
console.log(`ЗНАЙДЕНО ДУБЛЕЙ: ${found.length}\n`);
for (const f of found) {
  console.log(`  ${f.date}  ${f.name}`);
  console.log(`     ${f.a}  ==  ${f.b}   (${f.laps} ідентичних кіл)`);
  console.log(`     дубль-сесія: ${f.dupId}`);
}
