/**
 * Огляд лінкування всіх ЛЧ: чи структура фаз коректна і повна.
 *
 * Для ЛЧ очікуємо (groupCount=2): 2 квали + 3 гонки × 2 групи = 8 фаз,
 * порядок гонок `race_N_group_2` → `race_N_group_1` (слабша група перша).
 * При groupCount=1: 1-2 квали + 3 гонки.
 *
 * Перевіряє:
 *   - чи є дублі фаз (merge-continuation це норма, решта — баг);
 *   - чи немає пропущених фаз у середині структури;
 *   - чи не залінковані заїзди іншого дня;
 *   - чи немає вільних «схожих на змагання» заїздів того ж вечора (пропущені);
 *   - чи порядок фаз відповідає хронології.
 *
 * Тільки читає прод.
 */
const BASE = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';
const get = async p => {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
};

const kyiv = ts => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = {}; for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return { hhmm: `${p.hour}:${p.minute}`, mins: +p.hour * 60 + +p.minute, dow: p.weekday };
};
const KART = /^Карт\s+\d+$/i;
const MIN_DATE = process.env.FROM_DATE || '2026-06-01';

function expectedPhases(groupCount) {
  const races = [];
  for (let r = 1; r <= 3; r++) {
    for (let g = groupCount; g >= 1; g--) races.push(`race_${r}_group_${g}`);
  }
  return races;
}

(async () => {
  const all = await get('/competitions');
  const comps = all
    .filter(c => c.format === 'champions_league' && (c.date || '') >= MIN_DATE)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  console.log(`ЛЧ з ${MIN_DATE}: ${comps.length} змагань\n`);
  const problems = [];

  for (const c of comps) {
    const sess = (typeof c.sessions === 'string' ? JSON.parse(c.sessions) : c.sessions)
      .slice().sort((a, b) => (+a.sessionId.replace('session-', '')) - (+b.sessionId.replace('session-', '')));
    const res = typeof c.results === 'string' ? JSON.parse(c.results || '{}') : (c.results || {});
    const gc = res.groupCountOverride ?? res.autoDetectedGroups ?? null;

    let day = [];
    try { day = await get(`/db/sessions?date=${c.date}`); } catch {}
    const linkedIds = new Set(sess.map(s => s.sessionId));

    // деталі кожного залінкованого заїзду
    const rows = [];
    for (const s of sess) {
      const ts = +s.sessionId.replace('session-', '');
      let laps = [];
      try { const raw = await get(`/db/laps?session=${s.sessionId}`); laps = Array.isArray(raw) ? raw : (raw.laps || []); } catch {}
      const pilots = [...new Set(laps.map(l => l.resolved_pilot || l.pilot))];
      const real = pilots.filter(p => !KART.test(p.trim()));
      rows.push({ ...s, ts, laps: laps.length, pilots: pilots.length, real: real.length, pilotNames: pilots, date: new Date(ts).toISOString().slice(0, 10) });
    }

    const issues = [];

    // 1. дублі фаз
    const phaseCount = {};
    for (const r of rows) phaseCount[r.phase] = (phaseCount[r.phase] || 0) + 1;
    const dupes = Object.entries(phaseCount).filter(([, n]) => n > 1);
    if (dupes.length) issues.push(`дублі фаз: ${dupes.map(([p, n]) => `${p}×${n}`).join(', ')}`);

    // 2. повнота структури
    if (gc) {
      const want = expectedPhases(gc);
      const have = new Set(rows.map(r => r.phase));
      const missing = want.filter(p => !have.has(p));
      if (missing.length) issues.push(`НЕМА фаз: ${missing.join(', ')}`);
    } else {
      issues.push('groupCount не визначено');
    }

    // 3. заїзди іншої дати
    const otherDay = rows.filter(r => r.date !== c.date && Math.abs(r.ts - (+rows[0].ts)) > 6 * 3600e3);
    if (otherDay.length) issues.push(`заїзди іншого дня: ${otherDay.map(r => kyiv(r.ts).hhmm).join(', ')}`);

    // 4. хронологія vs порядок фаз
    const raceRows = rows.filter(r => r.phase?.startsWith('race_'));
    const wantOrder = gc ? expectedPhases(gc) : [];
    const actualOrder = raceRows.map(r => r.phase);
    const expectedSeq = wantOrder.filter(p => actualOrder.includes(p));
    if (gc && JSON.stringify(actualOrder.filter((p, i, a) => a.indexOf(p) === i)) !== JSON.stringify(expectedSeq)) {
      issues.push(`порядок гонок не за регламентом: ${actualOrder.join(' → ')}`);
    }

    // 5. Вільні заїзди того вечора, які СПРАВДІ схожі на пропущену частину
    //    змагання: перетинаються пілотами із залінкованими заїздами.
    //    Проста перевірка «≥8 пілотів після 19:00» не годиться — вечірній
    //    прокат теж буває на 14 машин, і він давав шум у кожному змаганні.
    const compPilots = new Set();
    for (const r of rows) for (const p of r.pilotNames || []) if (!KART.test(p)) compPilots.add(p);

    const freeCandidates = [];
    for (const r of day) {
      if (linkedIds.has(r.id) || (r.merged_session_ids || []).some(x => linkedIds.has(x))) continue;
      const k = kyiv(r.start_time);
      if (k.mins < 19 * 60) continue;
      if ((r.pilot_count ?? 0) < 8) continue;
      let laps = [];
      try { const raw = await get(`/db/laps?session=${r.id}`); laps = Array.isArray(raw) ? raw : (raw.laps || []); } catch {}
      const pil = [...new Set(laps.map(l => l.resolved_pilot || l.pilot))].filter(p => !KART.test(p));
      if (pil.length === 0) continue;
      const overlap = pil.filter(p => compPilots.has(p)).length / pil.length;
      if (overlap >= 0.5) {
        freeCandidates.push(`${k.hhmm}/${pil.length}п overlap=${Math.round(overlap * 100)}%${r.is_race === 1 ? '(гонка)' : ''}`);
      }
    }
    if (freeCandidates.length) issues.push(`ПРОПУЩЕНІ заїзди змагання: ${freeCandidates.join(', ')}`);

    const flag = issues.length ? '❌' : '✅';
    console.log(`${flag} ${c.date}  ${c.name}  [gc=${gc ?? '?'}, заїздів=${rows.length}]`);
    for (const r of rows) {
      console.log(`      ${kyiv(r.ts).hhmm}  ${String(r.phase).padEnd(16)} кіл=${String(r.laps).padStart(3)} пілотів=${String(r.pilots).padStart(2)} реальних=${String(r.real).padStart(2)}`);
    }
    for (const i of issues) console.log(`      ⚠️  ${i}`);
    if (issues.length) problems.push({ id: c.id, date: c.date, name: c.name, issues });
    console.log('');
  }

  console.log('='.repeat(78));
  console.log(`ПРОБЛЕМНИХ: ${problems.length}/${comps.length}`);
  for (const p of problems) console.log(`  ${p.date}  ${p.id}\n      ${p.issues.join('\n      ')}`);
})();
