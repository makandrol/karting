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
  return name.split(/\s+/)[0].toLowerCase().trim();
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

export function comparePilots(
  local: PilotRow[],
  sheet: SheetPilotData[],
  raceCount: number,
): ComparisonDiff[] {
  const diffs: ComparisonDiff[] = [];

  for (const sp of sheet) {
    const localPilot = local.find(lp => {
      const lSurname = extractSurname(lp.pilot);
      return lSurname === sp.surname;
    });

    if (!localPilot) {
      diffs.push({
        pilot: '???',
        sheetPilot: sp.pilot,
        diffs: [{ field: 'Пілот не знайдений в нашій таблиці', ours: '—', theirs: sp.pilot }],
      });
      continue;
    }

    const pilotDiffs: ComparisonDiff['diffs'] = [];

    for (let r = 0; r < raceCount; r++) {
      const lr = localPilot.races[r];
      const sr = sp.races[r];
      if (!lr || !sr) continue;

      const rLabel = `Г${r + 1}`;

      if (sr.group > 0 && lr.group > 0 && sr.group !== lr.group) {
        pilotDiffs.push({ field: `${rLabel} група`, ours: lr.group, theirs: sr.group });
      }
      if (sr.startPos > 0 && lr.startPos > 0 && sr.startPos !== lr.startPos) {
        pilotDiffs.push({ field: `${rLabel} старт`, ours: lr.startPos, theirs: sr.startPos });
      }
      if (sr.finishPos > 0 && lr.finishPos > 0 && sr.finishPos !== lr.finishPos) {
        pilotDiffs.push({ field: `${rLabel} фініш`, ours: lr.finishPos, theirs: sr.finishPos });
      }
      if (Math.abs(sr.penalties - lr.penalties) > 0.01) {
        pilotDiffs.push({ field: `${rLabel} штрафи`, ours: lr.penalties, theirs: sr.penalties });
      }
      const lrTotal = Math.round(lr.totalRacePoints * 10) / 10;
      const srTotal = Math.round(sr.raceTotal * 10) / 10;
      if (Math.abs(srTotal - lrTotal) > 0.01) {
        pilotDiffs.push({ field: `${rLabel} сума`, ours: lrTotal, theirs: srTotal });
      }
    }

    const lTotal = Math.round(localPilot.totalPoints * 10) / 10;
    const sTotal = Math.round(sp.total * 10) / 10;
    if (Math.abs(sTotal - lTotal) > 0.01) {
      pilotDiffs.push({ field: 'Загальна сума', ours: lTotal, theirs: sTotal });
    }

    if (pilotDiffs.length > 0) {
      diffs.push({ pilot: localPilot.pilot, sheetPilot: sp.pilot, diffs: pilotDiffs });
    }
  }

  // Find local pilots not in the sheet
  const sheetSurnames = new Set(sheet.map(s => s.surname));
  for (const lp of local) {
    const lSurname = extractSurname(lp.pilot);
    if (!sheetSurnames.has(lSurname) && lp.races.some(r => r && r.finishPos > 0)) {
      diffs.push({
        pilot: lp.pilot,
        sheetPilot: '???',
        diffs: [{ field: 'Пілот не знайдений в таблиці картодрому', ours: lp.pilot, theirs: '—' }],
      });
    }
  }

  return diffs;
}
