/**
 * Пілотні набори по заїздах вечора — щоб зрозуміти СПРАВЖНЮ структуру груп.
 * Якщо групи дві, набори пілотів гонок чергуються (A, B, A, B, ...).
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
const fromHHMM = process.argv[3] || '20:00';

const day = (await get(`/db/sessions?date=${date}`)).slice().sort((a, b) => a.start_time - b.start_time);
const rows = [];
for (const r of day) {
  if (kyiv(r.start_time) < fromHHMM) continue;
  let laps = [];
  try { const raw = await get(`/db/laps?session=${r.id}`); laps = Array.isArray(raw) ? raw : (raw.laps || []); } catch {}
  const pil = [...new Set(laps.map(l => l.resolved_pilot || l.pilot))].filter(p => !KART.test(p)).sort();
  if (pil.length === 0) continue;
  rows.push({ t: kyiv(r.start_time), id: r.id, pil, laps: laps.length, isRace: r.is_race, dur: r.end_time ? Math.round((r.end_time - r.start_time) / 1000) : null });
}

// Кластеризація: групуємо заїзди за схожістю наборів пілотів (Jaccard ≥ 0.6)
const clusters = [];
for (const r of rows) {
  let best = null, bestScore = 0;
  for (const c of clusters) {
    const inter = r.pil.filter(p => c.set.has(p)).length;
    const uni = new Set([...r.pil, ...c.set]).size;
    const j = inter / uni;
    if (j > bestScore) { bestScore = j; best = c; }
  }
  if (best && bestScore >= 0.6) { best.rows.push(r); for (const p of r.pil) best.set.add(p); }
  else clusters.push({ set: new Set(r.pil), rows: [r] });
}

console.log(`${date} — заїзди з ${fromHHMM} (${rows.length})\n`);
for (const r of rows) {
  const ci = clusters.findIndex(c => c.rows.includes(r));
  console.log(`  ${r.t}  ${String(r.dur ?? '—').padStart(4)}с кіл=${String(r.laps).padStart(3)} пілотів=${String(r.pil.length).padStart(2)} isRace=${r.isRace ?? '—'}  кластер=${ci + 1}`);
}
console.log(`\n=== КЛАСТЕРИ (≈групи): ${clusters.length}`);
clusters.forEach((c, i) => {
  console.log(`\n  Кластер ${i + 1}: заїздів=${c.rows.length}, унікальних пілотів=${c.set.size}`);
  console.log(`     часи: ${c.rows.map(r => r.t).join(', ')}`);
  console.log(`     пілоти: ${[...c.set].slice(0, 14).join(', ')}`);
});
