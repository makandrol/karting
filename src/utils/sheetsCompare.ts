import type { PilotRow } from './scoring';

export interface SheetPilotData {
  position: number;
  pilot: string;
  surname: string;
  races: {
    group: number;
    startPos: number;
    finishPos: number;
    penalties: number;
    raceTotal: number;
  }[];
  total: number;
}

export interface ComparisonDiff {
  pilot: string;
  sheetPilot: string;
  diffs: { field: string; ours: string | number; theirs: string | number }[];
}

export interface ComparisonRow {
  pilot: string;
  sheetPilot: string;
  matched: boolean;
  /** only in our table */
  onlyLocal: boolean;
  /** only in sheet */
  onlySheet: boolean;
  fields: ComparisonField[];
}

export interface ComparisonField {
  key: string;
  label: string;
  ours: number | string;
  theirs: number | string;
  diff: boolean;
}

export interface MatchDebugEntry {
  localPilot: string;
  localSurname: string;
  sheetPilot: string;
  sheetSurname: string;
  matched: boolean;
}

function parseSheetsUrl(url: string): { id: string; gid: string } | null {
  const m = url.match(/\/spreadsheets\/d\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return { id, gid };
}

export function getCsvExportUrl(url: string): string | null {
  const parsed = parseSheetsUrl(url);
  if (!parsed) return null;
  return `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv&gid=${parsed.gid}`;
}

function parseNum(v: string): number {
  if (!v || v === '—' || v === '-') return 0;
  const clean = v.replace(/\\/g, '').replace(/,/g, '.').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(cell);
        cell = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(cell);
        cell = '';
        rows.push(current);
        current = [];
        if (ch === '\r') i++;
      } else {
        cell += ch;
      }
    }
  }
  if (cell || current.length > 0) {
    current.push(cell);
    rows.push(current);
  }
  return rows;
}

function extractSurname(name: string): string {
  return name.split(/\s+/)[0].toLowerCase().trim()
    .replace(/ё/g, 'е')
    .replace(/ъ/g, '')
    .replace(/'/g, '')
    .replace(/'/g, '')
    .replace(/ʼ/g, '');
}

/**
 * Parse a karting results Google Sheet (LL / LCh / Sprint formats).
 *
 * The sheet uses multi-row merged headers. The CSV export puts merged cell
 * content in the top-left cell only, leaving the rest blank.
 *
 * Strategy: scan header rows for known Ukrainian keywords to build a column map.
 * Header keywords we look for (any of the 3 header rows):
 *   - "старт"  → start position for a race
 *   - "фініш"  → finish position for a race
 *   - "група"  → group for a race
 *   - "штрафи" → penalties for a race
 *   - "сума"   → total points
 *
 * For each race we need: group, start, finish, penalties columns.
 * Race blocks are detected as sets of (група, Старт, Фініш) repeating in headers.
 */
export function parseSheetData(csv: string, raceCount: number): SheetPilotData[] {
  const rows = parseCsv(csv);
  if (rows.length < 6) return [];

  // Find data start row — first row where col 0 is a number
  let dataStart = -1;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][0]?.trim();
    if (v && /^\d+$/.test(v)) {
      dataStart = i;
      break;
    }
  }
  if (dataStart < 0) return [];

  // Collect all header rows (up to 4 rows before data)
  const headerStart = Math.max(0, dataStart - 4);
  const allHeaderRows = rows.slice(headerStart, dataStart);

  // Build a flat merged header: for each column index, gather all non-empty header values
  const maxCols = Math.max(...allHeaderRows.map(r => r.length), rows[dataStart]?.length || 0);
  const colHeaders: string[][] = Array.from({ length: maxCols }, () => []);
  for (const hr of allHeaderRows) {
    for (let c = 0; c < hr.length; c++) {
      const v = hr[c]?.trim().toLowerCase();
      if (v) colHeaders[c].push(v);
    }
  }

  // Find key columns by keyword matching
  const findCols = (keyword: string): number[] => {
    const result: number[] = [];
    for (let c = 0; c < colHeaders.length; c++) {
      if (colHeaders[c].some(h => h === keyword)) result.push(c);
    }
    return result;
  };

  const startCols = findCols('старт');
  const finishCols = findCols('фініш');
  const groupCols = findCols('група');
  const penaltyCols = findCols('штрафи');

  // Find "сума" column
  let sumaCol = -1;
  for (let c = 0; c < colHeaders.length; c++) {
    if (colHeaders[c].some(h => h === 'сума')) { sumaCol = c; break; }
  }

  // Find race total columns: look for "заїзд" or headers that are just "1", "2", "3" in the last header row
  const raceTotalCols: number[] = [];
  for (let c = 0; c < colHeaders.length; c++) {
    if (colHeaders[c].some(h => h.startsWith('заїзд'))) raceTotalCols.push(c);
  }
  // If we didn't find "заїзд" headers, try to find columns with race number markers
  if (raceTotalCols.length === 0) {
    const lastHeader = allHeaderRows[allHeaderRows.length - 1] || [];
    for (let c = 2; c < lastHeader.length; c++) {
      const v = lastHeader[c]?.trim();
      if (v && /^заїзд\s*\d+$/i.test(v)) raceTotalCols.push(c);
    }
  }

  const pilots: SheetPilotData[] = [];

  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const posStr = row[0]?.trim();
    if (!posStr || !/^\d+$/.test(posStr)) {
      // Check if it's a "Всього учасників" row — stop
      if (row[0]?.trim().toLowerCase().includes('всього') || row[1]?.trim().toLowerCase().includes('всього')) break;
      continue;
    }

    const position = parseInt(posStr);
    const pilotRaw = row[1]?.trim() || '';
    const pilotName = pilotRaw.split('/')[0].trim();
    const surname = extractSurname(pilotName);

    const races: SheetPilotData['races'] = [];
    for (let r = 0; r < raceCount; r++) {
      races.push({
        group: groupCols[r] !== undefined ? parseNum(row[groupCols[r]] || '') : 0,
        startPos: startCols[r] !== undefined ? parseNum(row[startCols[r]] || '') : 0,
        finishPos: finishCols[r] !== undefined ? parseNum(row[finishCols[r]] || '') : 0,
        penalties: penaltyCols[r] !== undefined ? parseNum(row[penaltyCols[r]] || '') : 0,
        raceTotal: raceTotalCols[r] !== undefined ? parseNum(row[raceTotalCols[r]] || '') : 0,
      });
    }

    const total = sumaCol >= 0 ? parseNum(row[sumaCol] || '') : 0;

    pilots.push({ position, pilot: pilotName, surname, races, total });
  }

  return pilots;
}

/** Debug helper: returns detected column mapping for troubleshooting */
export function debugParseColumns(csv: string): {
  dataStart: number;
  headers: { col: number; labels: string[] }[];
  startCols: number[];
  finishCols: number[];
  groupCols: number[];
  penaltyCols: number[];
  sumaCol: number;
  sampleRow: string[];
} | null {
  const rows = parseCsv(csv);
  let dataStart = -1;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i][0]?.trim();
    if (v && /^\d+$/.test(v)) { dataStart = i; break; }
  }
  if (dataStart < 0) return null;

  const headerStart = Math.max(0, dataStart - 4);
  const allHeaderRows = rows.slice(headerStart, dataStart);
  const maxCols = Math.max(...allHeaderRows.map(r => r.length), rows[dataStart]?.length || 0);
  const colHeaders: string[][] = Array.from({ length: maxCols }, () => []);
  for (const hr of allHeaderRows) {
    for (let c = 0; c < hr.length; c++) {
      const v = hr[c]?.trim().toLowerCase();
      if (v) colHeaders[c].push(v);
    }
  }

  const findCols = (keyword: string): number[] => {
    const result: number[] = [];
    for (let c = 0; c < colHeaders.length; c++) {
      if (colHeaders[c].some(h => h === keyword)) result.push(c);
    }
    return result;
  };

  let sumaCol = -1;
  for (let c = 0; c < colHeaders.length; c++) {
    if (colHeaders[c].some(h => h === 'сума')) { sumaCol = c; break; }
  }

  return {
    dataStart,
    headers: colHeaders.map((labels, col) => ({ col, labels })).filter(h => h.labels.length > 0),
    startCols: findCols('старт'),
    finishCols: findCols('фініш'),
    groupCols: findCols('група'),
    penaltyCols: findCols('штрафи'),
    sumaCol,
    sampleRow: rows[dataStart] || [],
  };
}

export function buildComparisonTable(
  local: PilotRow[],
  sheet: SheetPilotData[],
  raceCount: number,
): { rows: ComparisonRow[]; matchDebug: MatchDebugEntry[] } {
  const matchDebug: MatchDebugEntry[] = [];

  const localSurnames = local.map(lp => ({ pilot: lp, surname: extractSurname(lp.pilot) }));
  const sheetSurnames = sheet.map(sp => ({ pilot: sp, surname: sp.surname }));

  const matchedLocal = new Set<number>();
  const matchedSheet = new Set<number>();
  const pairs: [number, number][] = [];

  for (let si = 0; si < sheetSurnames.length; si++) {
    for (let li = 0; li < localSurnames.length; li++) {
      if (matchedLocal.has(li)) continue;
      if (localSurnames[li].surname === sheetSurnames[si].surname) {
        pairs.push([li, si]);
        matchedLocal.add(li);
        matchedSheet.add(si);
        matchDebug.push({
          localPilot: localSurnames[li].pilot.pilot,
          localSurname: localSurnames[li].surname,
          sheetPilot: sheetSurnames[si].pilot.pilot,
          sheetSurname: sheetSurnames[si].surname,
          matched: true,
        });
        break;
      }
    }
  }

  for (let si = 0; si < sheetSurnames.length; si++) {
    if (!matchedSheet.has(si)) {
      matchDebug.push({
        localPilot: '',
        localSurname: '',
        sheetPilot: sheetSurnames[si].pilot.pilot,
        sheetSurname: sheetSurnames[si].surname,
        matched: false,
      });
    }
  }
  for (let li = 0; li < localSurnames.length; li++) {
    if (!matchedLocal.has(li)) {
      matchDebug.push({
        localPilot: localSurnames[li].pilot.pilot,
        localSurname: localSurnames[li].surname,
        sheetPilot: '',
        sheetSurname: '',
        matched: false,
      });
    }
  }

  const buildFields = (lp: PilotRow | null, sp: SheetPilotData | null): ComparisonField[] => {
    const fields: ComparisonField[] = [];
    for (let r = 0; r < raceCount; r++) {
      const lr = lp?.races[r];
      const sr = sp?.races[r];
      const rL = `Г${r + 1}`;
      const lGroup = lr?.group ?? '-';
      const sGroup = sr?.group ?? '-';
      fields.push({ key: `r${r}_group`, label: `${rL} гр`, ours: lGroup, theirs: sGroup, diff: lGroup !== '-' && sGroup !== '-' && lGroup !== sGroup });
      const lStart = lr?.startPos ?? '-';
      const sStart = sr?.startPos ?? '-';
      fields.push({ key: `r${r}_start`, label: `${rL} ст`, ours: lStart, theirs: sStart, diff: lStart !== '-' && sStart !== '-' && lStart !== sStart });
      const lFinish = lr?.finishPos ?? '-';
      const sFinish = sr?.finishPos ?? '-';
      fields.push({ key: `r${r}_finish`, label: `${rL} фін`, ours: lFinish, theirs: sFinish, diff: lFinish !== '-' && sFinish !== '-' && lFinish !== sFinish });
      const lPen = lr?.penalties ?? '-';
      const sPen = sr?.penalties ?? '-';
      fields.push({ key: `r${r}_pen`, label: `${rL} штр`, ours: lPen, theirs: sPen, diff: typeof lPen === 'number' && typeof sPen === 'number' && Math.abs(sPen - lPen) > 0.01 });
      const lRT = lr ? Math.round(lr.totalRacePoints * 10) / 10 : '-';
      const sRT = sr ? Math.round(sr.raceTotal * 10) / 10 : '-';
      fields.push({ key: `r${r}_total`, label: `${rL} Σ`, ours: lRT, theirs: sRT, diff: typeof lRT === 'number' && typeof sRT === 'number' && Math.abs(sRT - lRT) > 0.01 });
    }
    const lTotal = lp ? Math.round(lp.totalPoints * 10) / 10 : '-';
    const sTotal = sp ? Math.round(sp.total * 10) / 10 : '-';
    fields.push({ key: 'total', label: 'Σ', ours: lTotal, theirs: sTotal, diff: typeof lTotal === 'number' && typeof sTotal === 'number' && Math.abs(sTotal - lTotal) > 0.01 });
    return fields;
  };

  const rows: ComparisonRow[] = [];

  for (const [li, si] of pairs) {
    const lp = local[li];
    const sp = sheet[si];
    rows.push({
      pilot: lp.pilot,
      sheetPilot: sp.pilot,
      matched: true,
      onlyLocal: false,
      onlySheet: false,
      fields: buildFields(lp, sp),
    });
  }

  for (let si = 0; si < sheet.length; si++) {
    if (!matchedSheet.has(si)) {
      const sp = sheet[si];
      rows.push({
        pilot: '',
        sheetPilot: sp.pilot,
        matched: false,
        onlyLocal: false,
        onlySheet: true,
        fields: buildFields(null, sp),
      });
    }
  }

  for (let li = 0; li < local.length; li++) {
    if (!matchedLocal.has(li) && local[li].races.some(r => r && r.finishPos > 0)) {
      const lp = local[li];
      rows.push({
        pilot: lp.pilot,
        sheetPilot: '',
        matched: false,
        onlyLocal: true,
        onlySheet: false,
        fields: buildFields(lp, null),
      });
    }
  }

  return { rows, matchDebug };
}

export function comparePilots(
  local: PilotRow[],
  sheet: SheetPilotData[],
  raceCount: number,
): ComparisonDiff[] {
  const { rows } = buildComparisonTable(local, sheet, raceCount);
  const diffs: ComparisonDiff[] = [];
  for (const row of rows) {
    const diffFields = row.fields.filter(f => f.diff);
    if (row.onlySheet) {
      diffs.push({ pilot: '???', sheetPilot: row.sheetPilot, diffs: [{ field: 'Пілот не знайдений в нашій таблиці', ours: '—', theirs: row.sheetPilot }] });
    } else if (row.onlyLocal) {
      diffs.push({ pilot: row.pilot, sheetPilot: '???', diffs: [{ field: 'Пілот не знайдений в таблиці картодрому', ours: row.pilot, theirs: '—' }] });
    } else if (diffFields.length > 0) {
      diffs.push({ pilot: row.pilot, sheetPilot: row.sheetPilot, diffs: diffFields.map(f => ({ field: f.label, ours: f.ours, theirs: f.theirs })) });
    }
  }
  return diffs;
}
