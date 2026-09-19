/**
 * Batch wrapper over audit-competition.ts: runs the full audit (penalties +
 * finish corrections + editLog rebuild) for every finished competition of a
 * format and prints one summary table.
 *
 * DRY-RUN by default; pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/audit/audit-batch.ts [--format=champions_league] [--from=YYYY-MM-DD]
 *       [--to=YYYY-MM-DD] [--only=id1,id2] [--apply] [--recreate]
 *
 * Per-competition raw output is kept in docs/audit/logs/<id>.log (gitignored).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fetchAllCompetitions } from './lib';

const APPLY = process.argv.includes('--apply');
const RECREATE = process.argv.includes('--recreate');
const argVal = (flag: string) => {
  const a = process.argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : undefined;
};
const FORMAT = argVal('--format') || 'champions_league';
const FROM = argVal('--from');
const TO = argVal('--to');
const ONLY = argVal('--only')?.split(',').map(s => s.trim()).filter(Boolean);

type Row = {
  id: string; name: string; date: string;
  points: string; startDiffs: string; edits: string; status: string;
};

async function main() {
  const all = await fetchAllCompetitions();
  let comps = all
    .filter(c => c.format === FORMAT)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (ONLY) comps = comps.filter(c => ONLY.includes(c.id));
  if (FROM) comps = comps.filter(c => (c.date || '') >= FROM);
  if (TO) comps = comps.filter(c => (c.date || '') <= TO);

  console.log(`BATCH AUDIT — ${FORMAT}, ${comps.length} competitions, mode=${APPLY ? 'APPLY' : 'DRY-RUN'}, recreate=${RECREATE}`);
  mkdirSync('docs/audit/logs', { recursive: true });

  const rows: Row[] = [];
  for (const c of comps) {
    const args = ['tsx', 'scripts/audit/audit-competition.ts', c.id];
    if (APPLY) args.push('--apply');
    if (RECREATE) args.push('--recreate');
    process.stdout.write(`\n[${rows.length + 1}/${comps.length}] ${c.date} ${c.name} … `);
    const r = spawnSync('npx', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + (r.stderr || '');
    writeFileSync(`docs/audit/logs/${c.id}.log`, out, 'utf8');

    const pts = out.match(/Збігається: (\d+)\/(\d+)/);
    const starts = out.match(/СТАРТОВІ ПОЗИЦІЇ — розбіжності \((\d+)\)/);
    const edits = out.match(/РУЧНІ ЗМІНИ \(results\.edits, (\d+)\)/);
    const noSheet = /No sheet tab known/.test(out);
    let status = 'ok';
    if (noSheet) status = 'НЕМА ВКЛАДКИ';
    else if (r.status !== 0 || !pts) status = 'ПОМИЛКА';
    else if (pts[1] !== pts[2]) status = 'БАЛИ ≠';
    else if (starts && starts[1] !== '0') status = 'старти ≠';

    rows.push({
      id: c.id, name: c.name, date: c.date || '',
      points: pts ? `${pts[1]}/${pts[2]}` : '—',
      startDiffs: starts ? starts[1] : '—',
      edits: edits ? edits[1] : '—',
      status,
    });
    process.stdout.write(`${status} (бали ${rows.at(-1)!.points}, старти Δ${rows.at(-1)!.startDiffs})`);
  }

  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
  const padR = (s: string, n: number) => s.length >= n ? s : ' '.repeat(n - s.length) + s;
  console.log('\n\n' + '='.repeat(84));
  console.log(`SUMMARY — ${FORMAT} (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  console.log('='.repeat(84));
  console.log(`${pad('Дата', 12)}${pad('Назва', 26)}${padR('Бали', 9)}${padR('Старт Δ', 9)}${padR('Правок', 8)}  Статус`);
  console.log('-'.repeat(84));
  for (const r of rows) {
    console.log(`${pad(r.date, 12)}${pad(r.name, 26)}${padR(r.points, 9)}${padR(r.startDiffs, 9)}${padR(r.edits, 8)}  ${r.status}`);
  }
  console.log('-'.repeat(84));
  const bad = rows.filter(r => r.status !== 'ok');
  console.log(`Повністю ok: ${rows.length - bad.length}/${rows.length}`);
  if (bad.length) {
    console.log('Потребує уваги:');
    for (const r of bad) console.log(`  ${r.date} ${r.name} — ${r.status} (бали ${r.points}, старти Δ${r.startDiffs})  log: docs/audit/logs/${r.id}.log`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
