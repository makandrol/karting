/**
 * Класифікація розбіжностей стартів: баг логіки чи ручна пересадка організатора?
 *
 * Наш старт = реверс за best-lap квали (швидший стартує позаду). Якщо порядок у
 * таблиці суперечить ЇЇ Ж часам — це ручне рішення організатора, а не наш баг.
 *
 * Для кожної розбіжності перевіряємо: чи узгоджений старт із таблиці з
 * порядком часів квали (монотонність). Якщо ні — це пересадка.
 */
import { fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv, parseLlSheet, resolveSheetUrl, buildNameMatcher } from './lib';

const COLLECTOR = process.env.COLLECTOR_URL || 'https://ekarting.duckdns.org';
const FROM = process.env.FROM_DATE || '2026-06-01';

const all = await fetch(`${COLLECTOR}/competitions`).then(r => r.json());
const comps = (all as any[])
  .filter(c => c.format === 'champions_league' && (c.date || '') >= FROM)
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
const scoring = await fetchScoring();

let totalDiffs = 0, manualReseat = 0, missingPilot = 0, noTimePilot = 0, unexplained = 0;
const unexplainedList: string[] = [];

for (const c of comps) {
  const comp = await fetchCompetition(c.id);
  const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
  const url = resolveSheetUrl(comp.format, firstTs);
  if (!url) continue;
  let sheet, our;
  try { sheet = parseLlSheet(await fetchSheetCsv(url), 3); our = await computeOurStandings(comp, scoring); }
  catch { continue; }

  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const ourByName = new Map(our.map(r => [r.pilot, r]));
  const pairs: { pilot: string; sheet: any; ours: any }[] = [];
  for (const r of our) {
    const m = matchName(r.pilot);
    const sp = m ? sheet.find(s => s.pilot === m) : null;
    if (sp) pairs.push({ pilot: r.pilot, sheet: sp, ours: r });
  }

  // пілоти, яких є в таблиці, але немає в нас (timing їх не записав)
  const ourMatched = new Set(pairs.map(p => matchName(p.pilot)));
  const onlySheet = sheet.filter(s => !ourMatched.has(s.pilot) && s.total != null);

  for (let race = 0; race < 3; race++) {
    // групуємо за групою ТАБЛИЦІ, сортуємо за стартом таблиці
    const byGroup = new Map<number, typeof pairs>();
    for (const p of pairs) {
      const g = p.sheet.races?.[race]?.group;
      if (!g) continue;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(p);
    }

    for (const [, list] of byGroup) {
      const diffs = list.filter(p => {
        const a = p.ours.races?.[race]?.startPos, b = p.sheet.races?.[race]?.startPos;
        return a && b && a !== b;
      });
      if (diffs.length === 0) continue;
      totalDiffs += diffs.length;

      // якщо в групі є пілот лише з таблиці — зсув через відсутнього пілота
      const groupHasMissing = onlySheet.some(s => s.races?.[race]?.group != null);
      // джерело порядку: Г1 → час квали, Г2+ → найкращий час попередньої гонки
      const timeOf = (p: any) => race === 0
        ? (p.ours.quali?.bestTime ?? null)
        : (p.ours.races?.[race - 1]?.bestTime ?? null);
      const num = (v: any) => typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
      const withTime = list.filter(p => timeOf(p) != null && isFinite(num(timeOf(p))));

      // Старт у таблиці має бути РЕВЕРСИВНИЙ за часом: найшвидший стартує
      // останнім. Якщо при спадному старті час НЕ зростає монотонно — таблиця
      // суперечить власним часам, тобто організатор пересадив пілотів вручну.
      const byStartDesc = [...withTime].sort((a, b) => b.sheet.races[race].startPos - a.sheet.races[race].startPos);
      let inversions = 0;
      for (let i = 1; i < byStartDesc.length; i++) {
        if (num(timeOf(byStartDesc[i])) < num(timeOf(byStartDesc[i - 1]))) inversions++;
      }

      // Чи є в цій групі пілот, для якого джерело старту (час квали / час
      // попередньої гонки) відсутнє? Ми ставимо такого останнім, організатор —
      // за власним рішенням, і всі за ним зсуваються на 1.
      const groupSheetPilots = pairs.filter(p => p.sheet.races?.[race]?.group === [...byGroup.keys()].find(g => byGroup.get(g) === list));
      const someoneNoTime = list.some(p => timeOf(p) == null)
        || groupSheetPilots.some(p => timeOf(p) == null);

      if (groupHasMissing) { missingPilot += diffs.length; }
      else if (inversions > 0) { manualReseat += diffs.length; }
      else if (someoneNoTime) {
        // Задокументована норма, не баг. Реальний кейс ЛЧ 03.06: Лобанов без
        // часу Г1 → наш старт 1 vs табл 5, решта групи зсунулась на 1.
        noTimePilot += diffs.length;
      }
      else {
        unexplained += diffs.length;
        if (unexplainedList.length < 12) {
          unexplainedList.push(`${c.date} Г${race + 1}: ${diffs.slice(0, 3).map(p => `${p.pilot} ${p.ours.races[race].startPos}→${p.sheet.races[race].startPos}`).join(', ')}`);
        }
      }
    }
  }
}

console.log('=== КЛАСИФІКАЦІЯ РОЗБІЖНОСТЕЙ СТАРТУ (усі ЛЧ) ===\n');
console.log(`Всього розбіжностей: ${totalDiffs}`);
console.log(`  зсув через ВІДСУТНЬОГО в нас пілота (timing не записав): ${missingPilot}`);
console.log(`  ручна пересадка організатора (старт таблиці суперечить її ж часам): ${manualReseat}`);
console.log(`  пілот без часу в джерелі старту (не доїхав) — ми ставимо останнім: ${noTimePilot}`);
console.log(`  решта (перевіряти вручну): ${unexplained}`);
if (unexplainedList.length) {
  console.log('\nвипадки для ручної перевірки:');
  for (const u of unexplainedList) console.log('  ' + u);
  console.log('\nПеревірені вручну (НЕ баги логіки):');
  console.log('  03.06 Г2 — Лобанов без часу Гонки 1 (не доїхав): ми ставимо останнім,');
  console.log('             організатор дав 5-й → решта групи зсунулась на 1.');
  console.log('  12.08 Г3 — Цаценко і Загірський мають ІДЕНТИЧНИЙ час 42.841:');
  console.log('             тайбрейк byTimeThenTs (хто поставив раніше) — свідоме рішення.');
}
