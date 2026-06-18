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
  /** Race position after this lap (from timing). */
  position: number | null;
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
  /** First / last lap number of the stint. */
  startLap: number;
  endLap: number;
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
  /** Timestamp of the last completed lap (finish moment). */
  finishTs: number;
  /** Gap to the team directly ahead — "+1 коло" or "+12.345" or "" (leader). */
  gapLabel: string;
}

export interface MarathonKartUsage {
  pilotName: string;
  teamName: string;
  startKart: number;
  lapCount: number;
  bestLapSec: number | null;
  /** Average lap (seconds), trimmed per the global trim params. */
  avgLapSec: number | null;
  /** Seconds spent driving this kart (sum of lap times in the stint(s)). */
  drivenSec: number;
  /** First / last lap number of the stint on this kart. */
  startLap: number;
  endLap: number;
  /** First / last lap timestamp of the stint on this kart. */
  startTs: number;
  endTs: number;
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
  /** Kart the team drove INTO the pit (left behind), if known. */
  kartIn: number | null;
  /** Kart the team took OUT of the pit (next stint), if known yet. */
  kartOut: number | null;
  /** Best lap (seconds) of the segment that just ended (before this pit). */
  segBestLapSec: number | null;
  /** Duration (seconds) of the segment that just ended (sum of its lap times). */
  segDurationSec: number | null;
  /** Pit index (1-based) for this team. */
  pitIndex: number;
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
  position: number | null;
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
          position: l.position,
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

/**
 * Start positions per team column (key `team-<startKart>` → first lap position),
 * for the laps-by-pilots race mode (sort by position + per-lap position deltas).
 */
export function buildMarathonStartPositions(model: MarathonModel): Map<string, number> {
  const map = new Map<string, number>();
  for (const team of model.teams) {
    const firstLap = team.stints[0]?.laps[0];
    if (firstLap?.position != null) map.set(`team-${team.startKart}`, firstLap.position);
  }
  return map;
}

export interface MarathonReplayLap {
  pilot: string;
  kart: number;
  lapNumber: number;
  lapTime: string;
  s1: string;
  s2: string;
  position: number;
  ts: number;
}

/**
 * Replay/timing-table rows for marathon: ONE entry per team (not per pilot),
 * so the live/replay table mirrors the tablo (18 teams in race order) instead
 * of 36 "Карт N"/pilot rows. `pilot` = team label; `kart` = actual kart on lap.
 */
export function buildMarathonReplayLaps(model: MarathonModel): MarathonReplayLap[] {
  const rows: MarathonReplayLap[] = [];
  for (const team of model.teams) {
    const label = teamReplayLabel(team);
    let lapNo = 0;
    for (const stint of team.stints) {
      for (const l of stint.laps) {
        lapNo++;
        rows.push({
          pilot: label,
          kart: l.kart,
          lapNumber: lapNo,
          lapTime: l.lapTime,
          s1: '',
          s2: '',
          position: l.position ?? 0,
          ts: l.ts,
        });
      }
    }
  }
  return rows;
}

/** Unique, human label for a team in the replay table. */
export function teamReplayLabel(team: MarathonTeam): string {
  const base = (team.teamName || '').trim();
  return base && !base.startsWith('Карт') ? base : `Карт ${team.startKart}`;
}

/** Start positions keyed by the replay team label (for race-mode sorting). */
export function buildMarathonReplayStartPositions(model: MarathonModel): Map<string, number> {
  const map = new Map<string, number>();
  for (const team of model.teams) {
    const firstLap = team.stints[0]?.laps[0];
    if (firstLap?.position != null) map.set(teamReplayLabel(team), firstLap.position);
  }
  return map;
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
    lastKnownKart: number;
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
        lastKnownKart: 0,
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
        kartIn: t.lastKnownKart || null,
        kartOut: null,
        segBestLapSec: null,
        segDurationSec: null,
        pitIndex: 0,
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

    // Track the last real kart so kart=0 reads (transient, near pit/start) can
    // inherit it instead of being dropped — dropping loses real laps and breaks
    // lap counts/timeline. 0 = unknown (resolved later by nearest real kart).
    if (!isOnPitKart(actualKart)) t.lastKnownKart = actualKart;

    if (type === 'lap') {
      const lapTime = d.lastLap ?? d.lapTime ?? null;
      const lapSec = parseTime(lapTime);
      const lapNumber = toKartNum(d.lapNumber) || raw.lapCount || 0;
      t.lastLapNumber = lapNumber;
      const lapKart = isOnPitKart(actualKart) ? t.lastKnownKart : actualKart;
      if (lapTime && lapSec != null && pilotName) {
        t.laps.push({
          lapNumber,
          lapTime,
          lapSec,
          kart: lapKart,
          pilotName,
          ts: ev.ts,
          position: pos || null,
        });
      }
    }
  }

  // Build teams with stints (a stint = contiguous run of same pilot + same kart).
  const teams: MarathonTeam[] = [];
  for (const t of teamMap.values()) {
    resolvePlaceholderPilots(t.laps);
    const stints = buildStints(t.laps, trimBest, trimWorst);
    const pilots: string[] = [];
    for (const s of stints) if (!pilots.includes(s.pilotName)) pilots.push(s.pilotName);

    let bestLapSec: number | null = null;
    let bestLap: string | null = null;
    for (const l of t.laps) {
      if (bestLapSec == null || l.lapSec < bestLapSec) { bestLapSec = l.lapSec; bestLap = l.lapTime; }
    }

    const finishTs = t.laps.length > 0 ? t.laps[t.laps.length - 1].ts : 0;

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
      finishTs,
      gapLabel: '',
    });
  }

  teams.sort((a, b) => (a.lastPosition ?? 999) - (b.lastPosition ?? 999));

  // Gap to the team directly ahead: laps-behind if fewer laps, else time gap.
  for (let i = 1; i < teams.length; i++) {
    const ahead = teams[i - 1];
    const cur = teams[i];
    const lapsBehind = ahead.totalLaps - cur.totalLaps;
    if (lapsBehind > 0) {
      cur.gapLabel = `+${lapsBehind} ${lapsBehind === 1 ? 'коло' : lapsBehind < 5 ? 'кола' : 'кіл'}`;
    } else if (ahead.finishTs && cur.finishTs) {
      const sec = (cur.finishTs - ahead.finishTs) / 1000;
      cur.gapLabel = sec > 0 ? `+${sec.toFixed(1)}с` : '';
    }
  }

  const kartStats = buildKartStats(teams);

  enrichPitIntervals(pitIntervals, teams);

  pitIntervals.sort((a, b) => a.startTs - b.startTs);

  return { teams, kartStats, pitIntervals };
}

/** "Карт N" / empty = timing hasn't read a real driver name yet. */
function isPlaceholderName(name: string): boolean {
  return !name || /^Карт\s/i.test(name);
}

/**
 * Replace placeholder "Карт N" driver names (timing didn't read a name at that
 * moment, near start/pit) with the nearest real name within the team's laps —
 * previous real name, else the next one. The transponder is one team, so a
 * "Карт N" lap belongs to whoever was driving around it. Also resolves any
 * remaining kart=0 laps (leading reads before the first real kart) to the
 * nearest known kart.
 */
function resolvePlaceholderPilots(laps: MarathonLap[]): void {
  const n = laps.length;
  // forward fill from previous real name
  let lastReal: string | null = null;
  for (let i = 0; i < n; i++) {
    if (!isPlaceholderName(laps[i].pilotName)) lastReal = laps[i].pilotName;
    else if (lastReal) laps[i].pilotName = lastReal;
  }
  // backward fill the leading placeholders (before any real name appeared)
  let nextReal: string | null = null;
  for (let i = n - 1; i >= 0; i--) {
    if (!isPlaceholderName(laps[i].pilotName)) nextReal = laps[i].pilotName;
    else if (nextReal) laps[i].pilotName = nextReal;
  }
  // backward fill leading kart=0 laps to the first real kart
  let nextKart = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (laps[i].kart > 0) nextKart = laps[i].kart;
    else if (nextKart > 0) laps[i].kart = nextKart;
  }
}

/**
 * Fill kartIn / kartOut / segment best-lap+duration / pitIndex for each pit
 * interval from the team's stints: the stint ending right before the pit is the
 * just-finished segment (kartIn = its kart), the stint starting right after is
 * the next kart (kartOut). kartOut may be null if not driven yet (still on pit).
 */
function enrichPitIntervals(intervals: MarathonPitInterval[], teams: MarathonTeam[]): void {
  const byStartKart = new Map<number, MarathonTeam>();
  for (const t of teams) byStartKart.set(t.startKart, t);

  // Per team, count pits in chronological order.
  const pitCounter = new Map<number, number>();

  const ordered = [...intervals].sort((a, b) => a.startTs - b.startTs);
  for (const iv of ordered) {
    const team = byStartKart.get(iv.startKart);
    if (!team) continue;
    pitCounter.set(iv.startKart, (pitCounter.get(iv.startKart) ?? 0) + 1);
    iv.pitIndex = pitCounter.get(iv.startKart)!;

    // Segment that just ended = last stint with endTs <= pit startTs.
    let prevStint = null as MarathonStint | null;
    let nextStint = null as MarathonStint | null;
    for (const s of team.stints) {
      if (s.endTs <= iv.startTs) prevStint = s;
      if (nextStint == null && s.startTs >= iv.endTs) nextStint = s;
    }
    if (prevStint) {
      iv.kartIn = prevStint.kart || iv.kartIn;
      iv.segBestLapSec = prevStint.bestLapSec;
      iv.segDurationSec = prevStint.laps.reduce((sum, l) => sum + l.lapSec, 0);
    }
    if (nextStint) iv.kartOut = nextStint.kart || null;
  }
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
      startLap: current[0].lapNumber,
      endLap: current[current.length - 1].lapNumber,
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
      if (!stint.kart) continue;      let ks = map.get(stint.kart);
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
        avgLapSec: stint.avgLapSec,
        drivenSec,
        startLap: stint.startLap,
        endLap: stint.endLap,
        startTs: stint.startTs,
        endTs: stint.endTs,
      });
      ks.totalLaps += stint.lapCount;
      ks.drivenSec += drivenSec;
      if (stint.bestLapSec != null && (ks.bestLapSec == null || stint.bestLapSec < ks.bestLapSec)) {
        ks.bestLapSec = stint.bestLapSec;
        ks.bestLap = stint.bestLap;
      }
    }
  }
  return [...map.values()].map(ks => ({
    ...ks,
    usages: [...ks.usages].sort((a, b) => a.startTs - b.startTs),
  })).sort((a, b) => a.kart - b.kart);
}
