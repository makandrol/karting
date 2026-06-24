/**
 * Shared helpers for the competition audit scripts (read-only by default).
 *
 * Reuses the REAL frontend scoring/linking logic from src/ so that the audit
 * reflects exactly what production computes. Run with tsx.
 */
import { computeStandings, type SessionLap, type PilotRow, type ScoringData, type ManualEdits } from '../../src/utils/scoring';
import { FORMAT_MAX_GROUPS } from '../../src/utils/competitionLinking';
import { parseSheetData, type SheetPilotData } from '../../src/utils/sheetsCompare';

export const COLLECTOR = process.env.COLLECTOR_URL || 'http://141.147.32.196:3001';

export interface CompSessionEntry { sessionId: string; phase: string | null }
export interface CompetitionDto {
  id: string;
  name: string;
  format: string;
  date: string;
  status: string;
  sessions: CompSessionEntry[];
  results?: any;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${COLLECTOR}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchCompetition(id: string): Promise<CompetitionDto> {
  const c = await getJson<any>(`/competitions/${encodeURIComponent(id)}`);
  const sessions = Array.isArray(c.sessions) ? c.sessions : JSON.parse(c.sessions || '[]');
  return { ...c, sessions };
}

export async function fetchAllCompetitions(): Promise<CompetitionDto[]> {
  const arr = await getJson<any[]>('/competitions');
  return arr.map(c => ({ ...c, sessions: Array.isArray(c.sessions) ? c.sessions : JSON.parse(c.sessions || '[]') }));
}

export async function fetchScoring(): Promise<ScoringData> {
  return getJson<ScoringData>('/scoring');
}

export async function fetchLaps(sessionId: string): Promise<SessionLap[]> {
  return getJson<SessionLap[]>(`/db/laps?session=${encodeURIComponent(sessionId)}`);
}

export interface DaySession {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  best_lap_time: string | null;
  track_id: number;
  competition_id?: string | null;
  merged_session_ids?: string[] | null;
}

export async function fetchSessionsByDate(date: string): Promise<DaySession[]> {
  return getJson<DaySession[]>(`/db/sessions?date=${encodeURIComponent(date)}`);
}

/** Build the sessionLaps map and run the real computeStandings. */
export async function computeOurStandings(comp: CompetitionDto, scoring: ScoringData): Promise<PilotRow[]> {
  const sessionLaps = new Map<string, SessionLap[]>();
  for (const s of comp.sessions) {
    try { sessionLaps.set(s.sessionId, await fetchLaps(s.sessionId)); } catch { sessionLaps.set(s.sessionId, []); }
  }

  const results = comp.results || {};
  const excludedLapSet = new Set<string>(results.excludedLaps || []);
  const effectiveLaps = excludedLapSet.size === 0 ? sessionLaps : new Map(
    [...sessionLaps].map(([sid, laps]) => [sid, laps.filter(l => !excludedLapSet.has(`${sid}|${l.pilot}|${l.ts}`))])
  );

  // Auto-exclude "Карт N" pilots (mirror LeagueResults)
  const KART_RE = /^Карт\s+\d+$/i;
  const excludedPilots = new Set<string>(results.excludedPilots || []);
  for (const laps of effectiveLaps.values()) for (const l of laps) if (KART_RE.test((l.pilot || '').trim())) excludedPilots.add(l.pilot);

  const formatMaxGroups = FORMAT_MAX_GROUPS[comp.format] ?? 3;
  const qualiSessions = comp.sessions.filter(s => s.phase?.startsWith('qualifying'));
  const qualiWithData = qualiSessions.filter(s => (effectiveLaps.get(s.sessionId) || []).length > 0);
  const autoGroupsByQuali = Math.min(Math.max(qualiWithData.length, 1), formatMaxGroups);
  const maxGroups = results.groupCountOverride ?? autoGroupsByQuali;

  return computeStandings({
    format: comp.format,
    sessions: comp.sessions,
    sessionLaps: effectiveLaps,
    scoring,
    edits: (results.edits || {}) as ManualEdits,
    excludedPilots,
    maxGroups,
    pilotsOverride: results.totalPilotsOverride ?? null,
    pilotsLocked: results.totalPilotsLocked ?? false,
    racePilotCount: results.racePilotCount ?? null,
  });
}

// --- Google Sheets ---

const LL_BOOK = '13gTJE8CnyPiqWXqJfbheLfcM-qEt9jo-';
// Tab gid → date label (DD.MM) as discovered from htmlview.
export const LL_TABS: Record<string, string> = {
  '167172796': '23.06', '825455551': '16.06', '1701121524': '09.06', '293139356': '02.06',
  '317261337': '26.05', '981616053': '19.05', '837503233': '12.05', '799321164': '05.05',
  '1256054450': '28.04', '1823523717': '21.04', '1075022841': '14.04', '1595427980': '07.04',
  '423291358': '31.03', '325243483': '24.03',
};

export function llSheetUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${LL_BOOK}/export?format=csv&gid=${gid}`;
}

// CL workbook (the one the user provided). Tab gid → date label (DD.MM).
const CL_BOOK = '1Dgn1oWwYcFv0BMq2QbOvCp7fwPXTcHSd';
export const CL_TABS: Record<string, string> = {
  '121514758': '03.06', '242554780': '27.05', '1416228625': '20.05', '2032735008': '13.05',
  '681413308': '06.05', '749846402': '29.04', '661896343': '22.04', '74156803': '15.04',
  '2028260709': '08.04', '195357991': '25.03', '830928005': '01.04',
};

export function clSheetUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${CL_BOOK}/export?format=csv&gid=${gid}`;
}

/**
 * Resolve a sheet CSV URL automatically for a competition by matching its
 * Kyiv-local date (from first session) to the LL/CL workbook tab. Returns null
 * if no matching tab is known (e.g. CL June competitions in a different book).
 */
export function resolveSheetUrl(format: string, firstSessionTs: number): string | null {
  const dd = String(new Date(firstSessionTs).getUTCDate()).padStart(2, '0');
  const mm = String(new Date(firstSessionTs).getUTCMonth() + 1).padStart(2, '0');
  const label = `${dd}.${mm}`;
  if (format === 'light_league') {
    const gid = Object.entries(LL_TABS).find(([, l]) => l === label)?.[0];
    return gid ? llSheetUrl(gid) : null;
  }
  if (format === 'champions_league') {
    const gid = Object.entries(CL_TABS).find(([, l]) => l === label)?.[0];
    return gid ? clSheetUrl(gid) : null;
  }
  return null;
}

export async function fetchSheetCsv(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`sheet ${url} → ${res.status}`);
  return res.text();
}

export function parseSheet(csv: string, raceCount: number): SheetPilotData[] {
  return parseSheetData(csv, raceCount);
}

// --- Precise LL/CL workbook parser (audit-only) ---
//
// Layout (LL book, e.g. gid 1075022841):
//   0 Місце | 1 Пілот | 2 дод.вага | 3 Карт(quali)
//   per race: група, Старт, Карт, Фініш  (4-7 for R1, 8-11 for R2, ...)
//   Квала(speed)
//   per race Бали: бали, обгони, час, штрафи  (13-16 for R1, 17-20 for R2, ...)
//   Сума
//
// We locate columns by scanning the merged header rows for keywords, grouping
// repeated (група,Старт,Карт,Фініш) blocks and (бали,обгони,час,штрафи) blocks.

export interface RaceCells {
  group: number; startPos: number; kart: number; finishPos: number;
  basePoints: number; overtakePoints: number; speedPoints: number; penalties: number;
  raceTotal: number;
}
export interface SheetPilotFull {
  position: number; pilot: string; surname: string; addWeight: number;
  qualiKart: number; qualiSpeed: number;
  races: RaceCells[];
  total: number;
  penaltyNotes: string[];
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { cur.push(cell); cell = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) { cur.push(cell); cell = ''; rows.push(cur); cur = []; if (ch === '\r') i++; }
      else cell += ch;
    }
  }
  if (cell || cur.length) { cur.push(cell); rows.push(cur); }
  return rows;
}

function num(v: string | undefined): number {
  if (!v) return 0;
  const c = v.replace(/\\/g, '').replace(/,/g, '.').trim();
  if (c === '' || c === '—' || c === '-') return 0;
  const n = parseFloat(c);
  return isNaN(n) ? 0 : n;
}

/**
 * Extract the track config number from the sheet title row, e.g.
 * "Лайт Ліга 28.04.2026 (конфігурація 3 )" → 3, "(конфігурація 5R)" → 105.
 * Returns null if not found.
 */
export function parseTrackConfig(csv: string): number | null {
  const m = csv.match(/конфігураці[яї]\s*(\d+)\s*(R?)/i);
  if (!m) return null;
  const base = parseInt(m[1]);
  const reverse = /r/i.test(m[2]);
  if (!base || base < 1) return null;
  return reverse ? base + 100 : base; // REVERSE_OFFSET = 100
}

export function parseLlSheet(csv: string, raceCount: number): SheetPilotFull[] {
  const rows = csvRows(csv);
  // find data start (col0 numeric) and header rows above it
  let dataStart = -1;
  for (let i = 0; i < rows.length; i++) {
    if (/^\d+$/.test((rows[i][0] || '').trim())) { dataStart = i; break; }
  }
  if (dataStart < 0) return [];
  const headerRows = rows.slice(Math.max(0, dataStart - 4), dataStart);
  const maxCols = Math.max(...rows.map(r => r.length));
  const colKW: string[][] = Array.from({ length: maxCols }, () => []);
  for (const hr of headerRows) for (let c = 0; c < hr.length; c++) {
    const v = (hr[c] || '').trim().toLowerCase();
    if (v) colKW[c].push(v);
  }
  const cols = (kw: string) => colKW.map((labels, c) => ({ c, labels })).filter(x => x.labels.includes(kw)).map(x => x.c);

  const startCols = cols('старт');
  const finishCols = cols('фініш');
  const groupCols = cols('група');
  const kartCols = cols('карт');
  // Points blocks
  const baliCols = cols('бали');
  const obgonyCols = cols('обгони');
  const chasCols = cols('час');
  const shtrafCols = cols('штрафи');
  const sumaCol = (cols('сума')[0] ?? -1);
  const qualaCol = (cols('квала')[0] ?? -1);

  const out: SheetPilotFull[] = [];
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i];
    const posStr = (row[0] || '').trim();
    if (!/^\d+$/.test(posStr)) {
      if ((row[0] || '').toLowerCase().includes('всього') || (row[1] || '').toLowerCase().includes('всього')) break;
      continue;
    }
    const pilotRaw = (row[1] || '').trim();
    const pilotName = pilotRaw.split('/')[0].trim();
    const races: RaceCells[] = [];
    for (let r = 0; r < raceCount; r++) {
      const base = num(row[baliCols[r]]);
      const ov = num(row[obgonyCols[r]]);
      const sp = num(row[chasCols[r]]);
      const pen = num(row[shtrafCols[r]]);
      races.push({
        group: num(row[groupCols[r]]),
        startPos: num(row[startCols[r]]),
        kart: num(row[kartCols[r + 1]]), // kartCols[0] is quali kart
        finishPos: num(row[finishCols[r]]),
        basePoints: base, overtakePoints: ov, speedPoints: sp, penalties: pen,
        raceTotal: Math.round((base + ov + sp + pen) * 10) / 10, // pen is negative in sheet
      });
    }
    out.push({
      position: parseInt(posStr),
      pilot: pilotName,
      surname: extractSurname(pilotName),
      addWeight: num(row[2]),
      qualiKart: num(row[3]),
      qualiSpeed: qualaCol >= 0 ? num(row[qualaCol]) : 0,
      races,
      total: sumaCol >= 0 ? num(row[sumaCol]) : 0,
      penaltyNotes: [row[22], row[23]].filter(Boolean).map(s => (s || '').trim()).filter(Boolean),
    });
  }
  return out;
}

export function extractSurname(name: string): string {
  return name.split(/\s+/)[0].toLowerCase().trim()
    .replace(/ё/g, 'е').replace(/ъ/g, '').replace(/'/g, '').replace(/'/g, '').replace(/ʼ/g, '');
}

/** Normalized full name for matching (surname + first name). */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
    .replace(/ё/g, 'е').replace(/ъ/g, '').replace(/'/g, '').replace(/'/g, '').replace(/ʼ/g, '');
}

/**
 * Match an "our" pilot name to a sheet pilot name.
 * Prefers full-name match; falls back to surname only when the surname is
 * unique on BOTH sides (avoids collisions like Синяговський К. vs В.).
 */
export function buildNameMatcher(ourNames: string[], sheetNames: string[]) {
  const ourSurnameCount = new Map<string, number>();
  for (const n of ourNames) ourSurnameCount.set(extractSurname(n), (ourSurnameCount.get(extractSurname(n)) || 0) + 1);
  const sheetSurnameCount = new Map<string, number>();
  for (const n of sheetNames) sheetSurnameCount.set(extractSurname(n), (sheetSurnameCount.get(extractSurname(n)) || 0) + 1);

  const sheetByFull = new Map<string, string>();
  for (const n of sheetNames) sheetByFull.set(normalizeName(n), n);
  const sheetBySurname = new Map<string, string>();
  for (const n of sheetNames) sheetBySurname.set(extractSurname(n), n);

  return (ourName: string): string | null => {
    const full = normalizeName(ourName);
    if (sheetByFull.has(full)) return sheetByFull.get(full)!;
    const sur = extractSurname(ourName);
    // safe surname fallback only when unique on both sides
    if ((ourSurnameCount.get(sur) || 0) === 1 && (sheetSurnameCount.get(sur) || 0) === 1) {
      return sheetBySurname.get(sur) ?? null;
    }
    return null;
  };
}

export type { PilotRow, SheetPilotData, ScoringData };
