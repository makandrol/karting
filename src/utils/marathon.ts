import { parseTime } from './timing';

/**
 * Marathon parsing — one long endurance race (1.5–4h) with teams of 1–3 pilots.
 *
 * Data model (verified against real timing data):
 * - A team is tracked by transponder; its STABLE id is the start slot `number`.
 * - `teamName` — team label (e.g. "Toretto Mafia"); may be empty in older data.
 * - `pilotName` — the pilot CURRENTLY driving; changes when pilots swap at a pit.
 * - `kart` — the ACTUAL kart on track right now; changes every pit stop. While a
 *   car is on pit, the timing briefly reports kart "0" — treated as "no read".
 * - `pitstops` — running pit-stop counter; `isOnPit` — pit status.
 * - `lastPitMainTime` — duration of the just-completed pit (≈ 90s), populated on the
 *   isOnPit true→false transition, format "mm:ss.SSS".
 *
 * IMPORTANT: the `laps` DB table stores `kart` = the start slot (NOT the kart on
 * track). For marathon we must reconstruct everything from `lap`/`update` events,
 * which carry the live `team` object (actual kart, pilotName, lapCount).
 */

const TEAM_PIT_KART_SENTINEL = '0';

export interface MarathonLap {
  lapNumber: number;
  lapTime: string;
  lapSec: number;
  kart: number;
  pilotName: string;
  ts: number;
}

export interface MarathonPitStop {
  /** Pit-stop index (1-based). */
  index: number;
  /** Lap number on which the stop happened (last completed lap before pit). */
  lapNumber: number;
  /** Pit duration in seconds (from lastPitMainTime), or null if unknown. */
  durationSec: number | null;
  ts: number;
}

export interface MarathonStint {
  /** Pilot driving this stint. */
  pilotName: string;
  /** Actual kart driven this stint. */
  kart: number;
  laps: MarathonLap[];
  lapCount: number;
  /** Best (fastest) lap time of the stint, formatted, or null. */
  bestLap: string | null;
  bestLapSec: number | null;
  /** Average lap (seconds) with X worst + Y best trimmed off, or null. */
  avgLapSec: number | null;
  startTs: number;
  endTs: number;
}

export interface MarathonTeam {
  /** Stable team id = start slot number. */
  startKart: number;
  teamName: string;
  /** Distinct pilot names that drove for this team, in order of first appearance. */
  pilots: string[];
  stints: MarathonStint[];
  pitStops: MarathonPitStop[];
  totalLaps: number;
  bestLap: string | null;
  bestLapSec: number | null;
  /** Last known finishing position (from timing). */
  lastPosition: number | null;
  transponderId: string | null;
}

export interface MarathonKartUsage {
  pilotName: string;
  teamName: string;
  startKart: number;
  lapCount: number;
  bestLapSec: number | null;
  /** Seconds spent driving this kart (sum of lap times in the stint(s)). */
  drivenSec: number;
}

export interface MarathonKartStat {
  kart: number;
  usages: MarathonKartUsage[];
  totalLaps: number;
  bestLapSec: number | null;
  bestLap: string | null;
  drivenSec: number;
}

export interface MarathonPitInterval {
  startKart: number;
  teamName: string;
  pilotName: string;
  startTs: number;
  endTs: number;
}

export interface MarathonModel {
  teams: MarathonTeam[];
  kartStats: MarathonKartStat[];
  /** Pit intervals (isOnPit true→false windows) for the time-scrubber field. */
  pitIntervals: MarathonPitInterval[];
}

export interface MarathonLapRow {
  pilot: string;
  kart: number;
  lap_time: string;
  ts: number;
  driver: string;
}

export interface MarathonPilotColumn {
  /** Stable key = "team-<startKart>" (used for rename keys / column identity). */
  name: string;
  /** Header label = team name. */
  headerLabel: string;
  startKart: number;
  laps: MarathonLapRow[];
  bestLap: number;
  bestS1: number;
  bestS2: number;
}

/**
 * Build per-team columns for the laps-by-pilots grid: one column per team
 * (start slot), laps in chronological order, each carrying the actual kart
 * and driver of that lap so the table can mark pit-stop kart/driver changes.
 */
export function buildMarathonLapColumns(model: MarathonModel): MarathonPilotColumn[] {
  return model.teams.map(team => {
    const laps: MarathonLapRow[] = [];
    for (const stint of team.stints) {
      for (const l of stint.laps) {
        laps.push({
          pilot: `team-${team.startKart}`,
          kart: l.kart,
          lap_time: l.lapTime,
          ts: l.ts,
          driver: l.pilotName,
        });
      }
    }
    laps.sort((a, b) => a.ts - b.ts);
    return {
      name: `team-${team.startKart}`,
      headerLabel: team.teamName,
      startKart: team.startKart,
      laps,
      bestLap: team.bestLapSec ?? Infinity,
      bestS1: Infinity,
      bestS2: Infinity,
    };
  });
}

interface RawTeam {
  transponderId?: string;
  number?: string | number;
  kart?: string | number;
  teamName?: string;
  pilotName?: string;
  lapCount?: number;
  position?: string | number;
  isOnPit?: boolean;
  pitstops?: string | number;
  lastPitMainTime?: string | null;
}

interface RawEvent {
  event_type?: string;
  type?: string;
  ts: number;
  data?: any;
}

function parseEventData(ev: RawEvent): any {
  return typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
}

function eventType(ev: RawEvent): string {
  return (ev.event_type || ev.type || '') as string;
}

function toKartNum(v: string | number | undefined): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n as number) ? (n as number) : 0;
}

function isOnPitKart(kart: number): boolean {
  return kart === 0;
}

/** Average of lapSecs after removing `trimWorst` largest and `trimBest` smallest. */
export function trimmedAverage(lapSecs: number[], trimBest: number, trimWorst: number): number | null {
  if (lapSecs.length === 0) return null;
  const sorted = [...lapSecs].sort((a, b) => a - b);
  const start = Math.min(trimBest, sorted.length);
  const end = Math.max(start, sorted.length - trimWorst);
  const slice = sorted.slice(start, end);
  if (slice.length === 0) return null;
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

/**
 * Build the full marathon model from raw events. Pass `lap` (and optionally
 * `update`) events — only `lap` events are needed to reconstruct stints, but
 * `update`/`pilot_*` events refine pit-interval edges.
 *
 * @param rawEvents events for the (merged) session, any order
 * @param opts trim params for the trimmed average lap
 */
export function parseMarathon(
  rawEvents: RawEvent[],
  opts: { trimBest?: number; trimWorst?: number } = {}
): MarathonModel {
  const trimBest = opts.trimBest ?? 0;
  const trimWorst = opts.trimWorst ?? 0;

  const events = [...rawEvents].sort((a, b) => a.ts - b.ts);

  // Per start-slot team accumulator.
  const teamMap = new Map<number, {
    startKart: number;
    teamName: string;
    transponderId: string | null;
    lastPosition: number | null;
    laps: MarathonLap[];
    pitStops: MarathonPitStop[];
    lastPitstops: number;
    lastOnPit: boolean;
    lastLapNumber: number;
    onPitSinceTs: number | null;
  }>();

  const pitIntervals: MarathonPitInterval[] = [];

  const getTeam = (startKart: number, raw: RawTeam) => {
    let t = teamMap.get(startKart);
    if (!t) {
      t = {
        startKart,
        teamName: '',
        transponderId: raw.transponderId ?? null,
        lastPosition: null,
        laps: [],
        pitStops: [],
        lastPitstops: 0,
        lastOnPit: false,
        lastLapNumber: 0,
        onPitSinceTs: null,
      };
      teamMap.set(startKart, t);
    }
    return t;
  };

  for (const ev of events) {
    const d = parseEventData(ev);
    if (!d) continue;
    const type = eventType(ev);
    const raw: RawTeam | undefined = d.team;
    if (!raw) continue;

    const startKart = toKartNum(raw.number);
    if (!startKart) continue;
    const t = getTeam(startKart, raw);

    if (raw.transponderId) t.transponderId = raw.transponderId;
    // A team name "settles" — keep the longest non-empty seen (filters the
    // letter-by-letter typing noise at race start).
    const tn = (raw.teamName || '').trim();
    if (tn && tn.length >= t.teamName.length) t.teamName = tn;

    const pos = toKartNum(raw.position);
    if (pos) t.lastPosition = pos;

    const onPit = !!raw.isOnPit;
    const pitstops = toKartNum(raw.pitstops);
    const actualKart = toKartNum(raw.kart);
    const pilotName = (raw.pilotName || '').trim();

    // Pit interval tracking (isOnPit windows) for the scrubber field.
    if (onPit && !t.lastOnPit) {
      t.onPitSinceTs = ev.ts;
    }
    if (!onPit && t.lastOnPit && t.onPitSinceTs != null) {
      pitIntervals.push({
        startKart,
        teamName: t.teamName,
        pilotName,
        startTs: t.onPitSinceTs,
        endTs: ev.ts,
      });
      t.onPitSinceTs = null;
    }

    // Pit-stop record: pitstops counter incremented.
    if (pitstops > t.lastPitstops) {
      const durSec = parseTime(raw.lastPitMainTime ?? null);
      t.pitStops.push({
        index: pitstops,
        lapNumber: t.lastLapNumber,
        durationSec: durSec,
        ts: ev.ts,
      });
    }
    // lastPitMainTime arrives slightly after the counter bump (on isOnPit→false);
    // backfill the most recent pit-stop duration if it was unknown.
    if (!onPit && t.lastOnPit) {
      const durSec = parseTime(raw.lastPitMainTime ?? null);
      const last = t.pitStops[t.pitStops.length - 1];
      if (last && last.durationSec == null && durSec != null) last.durationSec = durSec;
    }

    t.lastPitstops = pitstops;
    t.lastOnPit = onPit;

    if (type === 'lap') {
      const lapTime = d.lastLap ?? d.lapTime ?? null;
      const lapSec = parseTime(lapTime);
      const lapNumber = toKartNum(d.lapNumber) || raw.lapCount || 0;
      t.lastLapNumber = lapNumber;
      if (lapTime && lapSec != null && !isOnPitKart(actualKart) && pilotName) {
        t.laps.push({
          lapNumber,
          lapTime,
          lapSec,
          kart: actualKart,
          pilotName,
          ts: ev.ts,
        });
      }
    }
  }

  // Build teams with stints (a stint = contiguous run of same pilot + same kart).
  const teams: MarathonTeam[] = [];
  for (const t of teamMap.values()) {
    const stints = buildStints(t.laps, trimBest, trimWorst);
    const pilots: string[] = [];
    for (const s of stints) if (!pilots.includes(s.pilotName)) pilots.push(s.pilotName);

    let bestLapSec: number | null = null;
    let bestLap: string | null = null;
    for (const l of t.laps) {
      if (bestLapSec == null || l.lapSec < bestLapSec) { bestLapSec = l.lapSec; bestLap = l.lapTime; }
    }

    teams.push({
      startKart: t.startKart,
      teamName: t.teamName || `Карт ${t.startKart}`,
      pilots,
      stints,
      pitStops: t.pitStops,
      totalLaps: t.laps.length,
      bestLap,
      bestLapSec,
      lastPosition: t.lastPosition,
      transponderId: t.transponderId,
    });
  }

  teams.sort((a, b) => (a.lastPosition ?? 999) - (b.lastPosition ?? 999));

  const kartStats = buildKartStats(teams);

  pitIntervals.sort((a, b) => a.startTs - b.startTs);

  return { teams, kartStats, pitIntervals };
}

function buildStints(laps: MarathonLap[], trimBest: number, trimWorst: number): MarathonStint[] {
  const stints: MarathonStint[] = [];
  let current: MarathonLap[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const lapSecs = current.map(l => l.lapSec);
    let bestLapSec: number | null = null;
    let bestLap: string | null = null;
    for (const l of current) {
      if (bestLapSec == null || l.lapSec < bestLapSec) { bestLapSec = l.lapSec; bestLap = l.lapTime; }
    }
    stints.push({
      pilotName: current[0].pilotName,
      kart: current[0].kart,
      laps: current,
      lapCount: current.length,
      bestLap,
      bestLapSec,
      avgLapSec: trimmedAverage(lapSecs, trimBest, trimWorst),
      startTs: current[0].ts,
      endTs: current[current.length - 1].ts,
    });
    current = [];
  };

  for (const lap of laps) {
    const prev = current[current.length - 1];
    if (prev && (prev.pilotName !== lap.pilotName || prev.kart !== lap.kart)) flush();
    current.push(lap);
  }
  flush();
  return stints;
}

function buildKartStats(teams: MarathonTeam[]): MarathonKartStat[] {
  const map = new Map<number, MarathonKartStat>();
  for (const team of teams) {
    for (const stint of team.stints) {
      if (!stint.kart) continue;
      let ks = map.get(stint.kart);
      if (!ks) {
        ks = { kart: stint.kart, usages: [], totalLaps: 0, bestLapSec: null, bestLap: null, drivenSec: 0 };
        map.set(stint.kart, ks);
      }
      const drivenSec = stint.laps.reduce((s, l) => s + l.lapSec, 0);
      ks.usages.push({
        pilotName: stint.pilotName,
        teamName: team.teamName,
        startKart: team.startKart,
        lapCount: stint.lapCount,
        bestLapSec: stint.bestLapSec,
        drivenSec,
      });
      ks.totalLaps += stint.lapCount;
      ks.drivenSec += drivenSec;
      if (stint.bestLapSec != null && (ks.bestLapSec == null || stint.bestLapSec < ks.bestLapSec)) {
        ks.bestLapSec = stint.bestLapSec;
        ks.bestLap = stint.bestLap;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.kart - b.kart);
}
