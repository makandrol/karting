/**
 * Unified competition audit: one pass that checks a finished LL/CL competition
 * against its official Google Sheet, applies the agreed automatic corrections,
 * and prints a clear final report.
 *
 * Pipeline:
 *   1. (optional) recreate the competition from its first session
 *   2. import penalties from the sheet           (always; sheet is source of truth)
 *   3. import finish corrections (sheet <= ours, delta <= maxDelta) — "returned positions"
 *   4. rebuild editLog so the page "Журнал змін" shows every change
 *   5. final compare → report:
 *        - remaining POINTS/FINISH mismatches (potential bugs OR sheet errors)
 *        - START-position anomalies (always a red flag → investigate)
 *        - the full list of MANUAL edits applied
 *
 * DRY-RUN by default. Pass --apply to write. Recreate is OFF by default;
 * pass --recreate to enable it (with optional --name / --date overrides).
 *
 * Usage:
 *   npx tsx scripts/audit/audit-competition.ts <competitionId> [sheetGidOrUrl] \
 *       [--apply] [--recreate] [--max=3] [--name="..."] [--date=YYYY-MM-DD]
 *
 * If sheetGidOrUrl is omitted, the sheet is auto-resolved from the competition
 * format + first-session date (LL/CL workbooks).
 */
import { execFileSync } from 'node:child_process';
import {
  fetchCompetition, fetchScoring, computeOurStandings, fetchSheetCsv,
  parseLlSheet, resolveSheetUrl, llSheetUrl, clSheetUrl, buildNameMatcher,
  parseTrackConfig, COLLECTOR, type SheetPilotFull,
} from './lib';
import { getCsvExportUrl } from '../../src/utils/sheetsCompare';

const APPLY = process.argv.includes('--apply');
const RECREATE = process.argv.includes('--recreate');
const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const MAX_DELTA = argVal('--max') ? parseInt(argVal('--max')!) : 3;

function runScript(script: string, args: string[]) {
  const all = [script, ...args];
  console.log(`\n$ tsx ${all.join(' ')}`);
  const out = execFileSync('npx', ['tsx', ...all], { encoding: 'utf8' });
  process.stdout.write(out);
  return out;
}

async function resolveSheet(compId: string): Promise<string> {
  const explicit = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : undefined;
  const comp = await fetchCompetition(compId);
  const firstTs = Math.min(...comp.sessions.map(s => parseInt(s.sessionId.replace('session-', '')) || Infinity));
  if (explicit) return /^\d+$/.test(explicit)
    ? (comp.format === 'champions_league' ? clSheetUrl(explicit) : llSheetUrl(explicit))
    : (getCsvExportUrl(explicit) || explicit);
  const auto = resolveSheetUrl(comp.format, firstTs);
  if (!auto) throw new Error(`No sheet tab known for ${comp.format} on ${new Date(firstTs).toISOString().slice(0, 10)}. Pass gid/url explicitly.`);
  return auto;
}

async function main() {
  const compId = process.argv[2];
  if (!compId) { console.error('usage: tsx scripts/audit/audit-competition.ts <competitionId> [sheetGidOrUrl] [--apply] [--recreate]'); process.exit(1); }

  const sheetUrl = await resolveSheet(compId);
  console.log('='.repeat(90));
  console.log(`AUDIT ${compId}`);
  console.log(`MODE: ${APPLY ? 'APPLY' : 'DRY-RUN'}  recreate=${RECREATE}  maxFinishDelta=${MAX_DELTA}`);
  console.log(`SHEET: ${sheetUrl}`);

  const applyFlag = APPLY ? ['--apply'] : [];

  // 1. recreate
  if (RECREATE) {
    const reArgs = [compId, ...applyFlag];
    const name = argVal('--name'); if (name) reArgs.push(`--name=${name}`);
    const date = argVal('--date'); if (date) reArgs.push(`--date=${date}`);
    runScript('scripts/audit/recreate.ts', reArgs);
  }

  // 1.5 track: set from sheet only when ours is empty; warn (never change) if differs
  const sheetCsvForTrack = await fetchSheetCsv(sheetUrl);
  const sheetTrack = parseTrackConfig(sheetCsvForTrack);
  {
    const compNow = await fetchCompetition(compId);
    const ourTrack = compNow.results?.trackId ?? null;
    if (sheetTrack == null) {
      console.log(`\n[track] таблиця не вказує конфігурацію — пропускаю`);
    } else if (ourTrack == null) {
      console.log(`\n[track] у нас траси немає → ставлю з таблиці: trackId=${sheetTrack}`);
      if (APPLY) {
        const merged = { ...(compNow.results || {}), trackId: sheetTrack };
        const res = await fetch(`${COLLECTOR}/competitions/${encodeURIComponent(compId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results: merged }) });
        if (!res.ok) throw new Error(`track PATCH → ${res.status}`);
        // also propagate to linked sessions' track_id
        await fetch(`${COLLECTOR}/competitions/${encodeURIComponent(compId)}/update-track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: sheetTrack }) }).catch(() => {});
        console.log(`[track] застосовано trackId=${sheetTrack}`);
      }
    } else if (ourTrack !== sheetTrack) {
      console.log(`\n⚠️  [track] РОЗБІЖНІСТЬ: у нас trackId=${ourTrack}, таблиця=${sheetTrack} — НЕ змінюю (розберись вручну)`);
    } else {
      console.log(`\n[track] збігається (trackId=${ourTrack}) ✓`);
    }
  }

  // 2. penalties + 3. finishes (these scripts take gid/url as 2nd arg)
  runScript('scripts/audit/import-penalties.ts', [compId, sheetUrl, ...applyFlag]);
  runScript('scripts/audit/import-finishes.ts', [compId, sheetUrl, ...applyFlag, `--max=${MAX_DELTA}`]);

  // 4. rebuild editLog
  if (APPLY) runScript('scripts/audit/rebuild-editlog.ts', [compId, '--apply']);

  // 5. final report
  const comp = await fetchCompetition(compId);
  const raceCount = comp.format === 'champions_league' ? 3 : 2;
  const scoring = await fetchScoring();
  const our = await computeOurStandings(comp, scoring);
  our.sort((a, b) => b.totalPoints - a.totalPoints);
  const sheet = parseLlSheet(await fetchSheetCsv(sheetUrl), raceCount);
  const matchName = buildNameMatcher(our.map(r => r.pilot), sheet.map(s => s.pilot));
  const sheetByName = new Map<string, SheetPilotFull>(sheet.map(s => [s.pilot, s]));

  const pointMismatches: string[] = [];
  const startMismatches: string[] = [];
  const matched = new Set<string>();
  // Повна таблиця балів по всіх зматчених пілотах (для друку в кінці).
  const pointsTable: { pilot: string; ours: number; sheet: number; diff: number; match: boolean }[] = [];
  // Деталі стартів по гонках (для діагностичних табличок при розбіжностях).
  // Г1: джерело старту — квала (bestTime квалі). Г2: джерело — результат Г1 (bestTime Г1).
  type StartRow = { pilot: string; ourGroup: number; ourStart: number; sheetStart: number; srcGroup: number | null; srcTime: string };
  const startRowsByRace: StartRow[][] = Array.from({ length: raceCount }, () => []);
  for (const row of our) {
    const m = matchName(row.pilot);
    const sp = m ? sheetByName.get(m) : undefined;
    if (sp) matched.add(m!);
    if (!sp) continue;
    const diff = Math.round((row.totalPoints - sp.total) * 10) / 10;
    const isMatch = Math.abs(diff) <= 0.05;
    pointsTable.push({ pilot: row.pilot, ours: row.totalPoints, sheet: sp.total, diff, match: isMatch });
    if (!isMatch) {
      const reasons: string[] = [];
      for (let r = 0; r < raceCount; r++) {
        const lr = row.races[r], sr = sp.races[r];
        if (!lr || !sr) continue;
        if (lr.finishPos !== sr.finishPos && lr.finishPos > 0 && sr.finishPos > 0) {
          const dir = sr.finishPos > lr.finishPos ? 'таблиця опустила (лишаємо наше)' : 'розбіжність';
          reasons.push(`Г${r + 1} фініш наш ${lr.finishPos} vs табл ${sr.finishPos} [${dir}]`);
        }
      }
      pointMismatches.push(`  ${row.pilot.padEnd(22)} Σ наш ${row.totalPoints} vs табл ${sp.total}${reasons.length ? ' — ' + reasons.join('; ') : ''}`);
    }
    for (let r = 0; r < raceCount; r++) {
      const lr = row.races[r], sr = sp.races[r];
      if (lr && sr && lr.startPos > 0 && sr.startPos > 0 && lr.startPos !== sr.startPos) {
        startMismatches.push(`  ${row.pilot.padEnd(22)} Г${r + 1} старт наш ${lr.startPos} vs табл ${sr.startPos}`);
      }
      // Збираємо деталі старту для табличок (усі пілоти, що стартували в гонці).
      if (lr && lr.startPos > 0) {
        // Джерело старту: Г1 — час квалі; Г2+ — час/група попередньої гонки.
        const srcGroup = r === 0 ? null : (row.races[r - 1]?.group ?? null);
        const srcTime = r === 0
          ? (row.quali?.bestTimeStr ?? '·')
          : (row.races[r - 1]?.bestTimeStr ?? '·');
        startRowsByRace[r].push({
          pilot: row.pilot, ourGroup: lr.group, ourStart: lr.startPos,
          sheetStart: sr?.startPos ?? 0, srcGroup, srcTime,
        });
      }
    }
  }

  // start-grid dup/missing detection in sheet (red flag for start positions)
  const startGridWarnings: string[] = [];
  for (let r = 0; r < raceCount; r++) {
    const byGroup = new Map<number, number[]>();
    for (const sp of sheet) {
      const sr = sp.races[r];
      if (sr?.group && sr.startPos > 0) {
        if (!byGroup.has(sr.group)) byGroup.set(sr.group, []);
        byGroup.get(sr.group)!.push(sr.startPos);
      }
    }
    for (const [g, starts] of [...byGroup].sort((a, b) => a[0] - b[0])) {
      const s = [...starts].sort((a, b) => a - b);
      const dups = [...new Set(s.filter((x, i) => x === s[i + 1]))];
      const miss = Array.from({ length: s.length }, (_, i) => i + 1).filter(e => !s.includes(e));
      if (dups.length || miss.length) startGridWarnings.push(`  R${r + 1} G${g}: DUP_starts=[${dups}] MISSING_starts=[${miss}]`);
    }
  }

  const onlyOurs = our.filter(r => !matchName(r.pilot)).map(r => r.pilot);
  const onlySheet = sheet.filter(sp => !matched.has(sp.pilot)).map(sp => `${sp.pilot}(#${sp.position})`);

  // manual edits applied
  const edits = comp.results?.edits || {};

  console.log('\n' + '='.repeat(90));
  console.log(`FINAL REPORT — ${comp.name}`);
  console.log('='.repeat(90));

  console.log(`\n⚠️  СТАРТОВІ ПОЗИЦІЇ — розбіжності (${startMismatches.length}) [це сигнал бага, треба фіксити]:`);
  startMismatches.length ? startMismatches.forEach(l => console.log(l)) : console.log('  (немає — старти збігаються ✓)');
  if (startGridWarnings.length) { console.log('  Дублі/пропуски стартів у таблиці:'); startGridWarnings.forEach(l => console.log(l)); }

  // Детальні таблички стартів — тільки коли є розбіжності. Одна таблиця на гонку,
  // усі пілоти, сортування за (група, старт у таблиці). Джерело старту:
  // Г1 — квала (час кола квалі); Г2+ — попередня гонка (група + час кола там).
  if (startMismatches.length) {
    const padR2 = (s: string, n: number) => s.length >= n ? s : ' '.repeat(n - s.length) + s;
    for (let r = 0; r < raceCount; r++) {
      const rows = [...startRowsByRace[r]].sort((a, b) =>
        (a.ourGroup - b.ourGroup) || (b.sheetStart - a.sheetStart) || (b.ourStart - a.ourStart));
      if (rows.length === 0) continue;
      const srcLabel = r === 0 ? 'Кв-час' : `Г${r}-грр Г${r}-час`;
      console.log(`\n── ГОНКА ${r + 1}, старт (${rows.length}) — ${r === 0 ? 'джерело: квала' : `джерело: Гонка ${r}`}:`);
      console.log(`  ${'Пілот'.padEnd(22)}${padR2('стрт-табл', 10)}${padR2('стрт-наш', 9)}  ✓  ${srcLabel}`);
      console.log(`  ${'-'.repeat(22)}${padR2('----', 10)}${padR2('----', 9)}  -  ${'-'.repeat(14)}`);
      let prevGroup = -1;
      for (const row of rows) {
        if (row.ourGroup !== prevGroup) { console.log(`  · група ${row.ourGroup} ·`); prevGroup = row.ourGroup; }
        const mark = row.sheetStart === row.ourStart ? '✓' : '✗';
        const sheetStr = row.sheetStart > 0 ? String(row.sheetStart) : '—';
        const src = r === 0 ? row.srcTime : `Гр${row.srcGroup ?? '?'}  ${row.srcTime}`;
        console.log(`  ${row.pilot.padEnd(22)}${padR2(sheetStr, 10)}${padR2(String(row.ourStart), 9)}  ${mark}  ${src}`);
      }
    }
  }

  console.log(`\n◆ БАЛИ — всі пілоти (${pointsTable.length}):`);
  const padR = (s: string, n: number) => s.length >= n ? s : ' '.repeat(n - s.length) + s;
  console.log(`  ${'Пілот'.padEnd(24)}${padR('Бали', 7)}${padR('Табл', 8)}${padR('Δ', 7)}  ✓`);
  console.log(`  ${'-'.repeat(24)}${padR('----', 7)}${padR('----', 8)}${padR('---', 7)}  -`);
  for (const t of pointsTable) {
    const diffStr = t.diff === 0 ? '0' : (t.diff > 0 ? `+${t.diff}` : `${t.diff}`);
    const mark = t.match ? '✓' : '✗';
    console.log(`  ${t.pilot.padEnd(24)}${padR(String(t.ours), 7)}${padR(String(t.sheet), 8)}${padR(diffStr, 7)}  ${mark}`);
  }
  const okCount = pointsTable.filter(t => t.match).length;
  console.log(`  ${'-'.repeat(48)}`);
  console.log(`  Збігається: ${okCount}/${pointsTable.length}`);

  console.log(`\n◆ БАЛИ / ФІНІШІ — розбіжності (${pointMismatches.length}):`);
  pointMismatches.length ? pointMismatches.forEach(l => console.log(l)) : console.log('  (немає — бали збігаються ✓)');

  if (onlyOurs.length) console.log(`\n  Лише в нас (немає в таблиці): ${onlyOurs.join(', ')}`);
  if (onlySheet.length) console.log(`  Лише в таблиці (немає в нас): ${onlySheet.join(', ')}`);

  console.log(`\n✎ РУЧНІ ЗМІНИ (results.edits, ${Object.keys(edits).length}):`);
  Object.entries(edits).sort().forEach(([k, v]: [string, any]) => {
    const parts = [];
    if (v.startPos != null) parts.push(`старт→${v.startPos}`);
    if (v.finishPos != null) parts.push(`фініш→${v.finishPos}`);
    if (v.penalties != null && v.penalties !== 0) parts.push(`штраф ${v.penalties}`);
    if (parts.length) console.log(`  ${k.padEnd(28)} ${parts.join(', ')}`);
  });
  if (Object.keys(edits).length === 0) console.log('  (немає)');

  console.log('\n' + (APPLY ? '✓ зміни застосовано' : '(dry-run — додай --apply щоб застосувати)'));
}
main().catch(e => { console.error(e); process.exit(1); });
