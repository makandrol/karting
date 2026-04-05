import { splitIntoGroups } from '../data/competitions';

export interface SessionLap {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  position: number | null;
  ts: number;
}

export interface CompSession {
  sessionId: string;
  phase: string | null;
}

export interface ScoringData {
  positionPoints: { label: string; minPilots: number; maxPilots: number; groups: Record<string, number[]> }[];
  overtakePoints: { groupI_LL: { startPosMin: number; startPosMax: number; perOvertake: number }[]; groupI_CL: { startPosMin: number; startPosMax: number; perOvertake: number }[]; groupII: number; groupIII: number };
  speedPoints: number[];
}

export interface PilotQualiData { bestTime: number; bestTimeStr: string; kart: number; speedPoints: number }
export interface PilotRaceData {
  kart: number; bestTime: number; bestTimeStr: string;
  group: number; startPos: number; finishPos: number;
  positionPoints: number; overtakePoints: number; speedPoints: number; penalties: number; totalRacePoints: number;
}
export interface PilotRow {
  pilot: string; quali: PilotQualiData | null; races: (PilotRaceData | null)[];
  totalPoints: number;
  /** Qualifying-based group number (stable across races) */
  qualiGroup: number;
}

export type ManualEdits = Record<string, { startPos?: number; finishPos?: number; penalties?: number }>;

export function parseLapSec(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+\.\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  const s = t.match(/^\d+\.\d+$/);
  if (s) return parseFloat(t);
  return null;
}

export function getOvertakeRate(scoring: ScoringData, group: number, pos: number, isCL: boolean): number {
  if (group === 3) return scoring.overtakePoints.groupIII;
  if (group === 2) return scoring.overtakePoints.groupII;
  const rules = isCL ? scoring.overtakePoints.groupI_CL : scoring.overtakePoints.groupI_LL;
  for (const rule of rules) {
    if (pos >= rule.startPosMin && pos <= rule.startPosMax) return rule.perOvertake;
  }
  return 0;
}

export function calcOvertakePoints(scoring: ScoringData, group: number, startPos: number, finishPos: number, isCL: boolean): number {
  if (startPos <= finishPos) return 0;
  let total = 0;
  for (let pos = startPos; pos > finishPos; pos--) {
    total += getOvertakeRate(scoring, group, pos, isCL);
  }
  return Math.round(total * 10) / 10;
}

export function getPositionPoints(scoring: ScoringData, totalPilots: number, group: string, finishPos: number): number {
  const cat = scoring.positionPoints.find(c => totalPilots >= c.minPilots && totalPilots <= c.maxPilots);
  if (!cat) return 0;
  const pts = cat.groups[group];
  if (!pts || finishPos < 1 || finishPos > pts.length) return 0;
  return pts[finishPos - 1];
}

export interface ComputeStandingsParams {
  format: string;
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
  scoring: ScoringData;
  edits: ManualEdits;
  excludedPilots: Set<string>;
  maxGroups: number;
  pilotsOverride: number | null;
  pilotsLocked: boolean;
  liveSessionId?: string | null;
  livePhase?: string | null;
  livePositions?: { pilot: string; position: number }[];
}

export function computeStandings(params: ComputeStandingsParams): PilotRow[] {
  const { format, sessions, sessionLaps, scoring, edits, excludedPilots, maxGroups, pilotsOverride, pilotsLocked, liveSessionId, livePhase, livePositions } = params;
  const raceCount = format === 'champions_league' ? 3 : 2;
  const qualiSessions = sessions.filter(s => s.phase?.startsWith('qualifying'));

  const getRaceSessions = (raceNum: number) => sessions.filter(s => s.phase?.startsWith(`race_${raceNum}_`));

  const qualiData = new Map<string, PilotQualiData>();
  for (const qs of qualiSessions) {
    for (const l of (sessionLaps.get(qs.sessionId) || [])) {
      const sec = parseLapSec(l.lap_time);
      if (sec === null || sec < 38) continue;
      const ex = qualiData.get(l.pilot);
      if (!ex || sec < ex.bestTime) qualiData.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart, speedPoints: 0 });
    }
  }

  const qualiSorted = [...qualiData.entries()]
    .filter(([p]) => !excludedPilots.has(p))
    .sort((a, b) => a[1].bestTime - b[1].bestTime);
  const maxQualified = format === 'champions_league' ? 24 : 36;
  const qualifiedPilots = qualiSorted.slice(0, maxQualified).map(([p]) => p);
  const disqualifiedPilots = new Set(qualiSorted.slice(maxQualified).map(([p]) => p));
  const autoTotalPilots = qualifiedPilots.length;
  const totalPilots = (pilotsLocked && pilotsOverride !== null) ? pilotsOverride : autoTotalPilots;

  qualiSorted.slice(0, 5).forEach(([pilot], i) => {
    const q = qualiData.get(pilot)!;
    q.speedPoints = scoring.speedPoints[i] || 0;
  });

  const groups = splitIntoGroups(qualifiedPilots, maxGroups);
  const pilotGroup = new Map<string, { group: number; posInGroup: number }>();
  groups.forEach((g, gi) => {
    const groupNum = gi + 1;
    g.pilots.forEach((p, pi) => {
      pilotGroup.set(p, { group: groupNum, posInGroup: g.pilots.length - pi });
    });
  });

  let prevRaceTimes: { pilot: string; time: number }[] = qualiSorted.map(([p, d]) => ({ pilot: p, time: d.bestTime }));

  let activePhase: string | null = null;
  if (liveSessionId) {
    const liveSession = sessions.find(s => s.sessionId === liveSessionId);
    activePhase = liveSession?.phase || null;
  } else if (livePhase) {
    activePhase = livePhase;
  }

  const raceResults: Map<string, PilotRaceData>[] = [];
  for (let r = 1; r <= raceCount; r++) {
    const rData = new Map<string, PilotRaceData>();
    const rSessions = getRaceSessions(r);

    const prevSorted = [...prevRaceTimes]
      .filter(p => !excludedPilots.has(p.pilot) && !disqualifiedPilots.has(p.pilot))
      .sort((a, b) => a.time - b.time)
      .slice(0, maxQualified);
    const rGroups = splitIntoGroups(prevSorted.map(p => p.pilot), maxGroups);
    const startPositions = new Map<string, { group: number; startPos: number }>();
    rGroups.forEach((g, gi) => {
      const gNum = gi + 1;
      g.pilots.forEach((p, pi) => {
        startPositions.set(p, { group: gNum, startPos: g.pilots.length - pi });
      });
    });

    let shouldShowStartPositions = false;
    if (activePhase?.startsWith('qualifying')) {
      shouldShowStartPositions = r === 1;
    } else if (activePhase?.startsWith('race_')) {
      const activeRaceMatch = activePhase.match(/race_(\d+)_/);
      if (activeRaceMatch) {
        const activeRaceNum = parseInt(activeRaceMatch[1]);
        shouldShowStartPositions = r === activeRaceNum + 1;
      }
    } else {
      shouldShowStartPositions = true;
    }

    const raceTimes: { pilot: string; time: number }[] = [];
    for (const rs of rSessions) {
      const groupMatch = rs.phase?.match(/group_(\d+)/);
      const groupNum = groupMatch ? parseInt(groupMatch[1]) : 0;
      const laps = sessionLaps.get(rs.sessionId) || [];
      const pilotStats = new Map<string, { bestTime: number; bestTimeStr: string; kart: number; lapCount: number; lastTs: number; lastPosition: number }>();
      for (const l of laps) {
        const sec = parseLapSec(l.lap_time);
        if (sec === null || sec < 38) continue;
        const ex = pilotStats.get(l.pilot);
        if (!ex) {
          pilotStats.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart, lapCount: 1, lastTs: l.ts, lastPosition: l.position ?? 99 });
        } else {
          ex.lapCount++;
          if (l.ts > ex.lastTs) { ex.lastTs = l.ts; ex.lastPosition = l.position ?? 99; }
          if (sec < ex.bestTime) { ex.bestTime = sec; ex.bestTimeStr = l.lap_time!; }
        }
      }
      const isActiveSession = rs.sessionId === liveSessionId && livePositions && livePositions.length > 0;
      if (isActiveSession) {
        for (const lp of livePositions!) {
          const ps = pilotStats.get(lp.pilot);
          if (ps) ps.lastPosition = lp.position;
        }
      }

      const sorted = [...pilotStats.entries()]
        .filter(([p]) => !excludedPilots.has(p))
        .sort((a, b) => {
          if (a[1].lapCount !== b[1].lapCount) return b[1].lapCount - a[1].lapCount;
          if (a[1].lastPosition !== b[1].lastPosition) return a[1].lastPosition - b[1].lastPosition;
          return a[1].lastTs - b[1].lastTs;
        });
      const excludedEntries = [...pilotStats.entries()].filter(([p]) => excludedPilots.has(p));
      sorted.forEach(([pilot, pData], i) => {
        const editKey = `${pilot}|${r}`;
        const edit = edits[editKey];
        const sp = startPositions.get(pilot);
        const isDisqualified = disqualifiedPilots.has(pilot);
        const startPos = isDisqualified ? -1 : (edit?.startPos ?? sp?.startPos ?? 0);
        const finishPos = edit?.finishPos ?? (i + 1);
        const group = isDisqualified ? 0 : (sp?.group ?? groupNum);
        const penalties = edit?.penalties ?? 0;

        const overtakePoints = isDisqualified ? 0 : calcOvertakePoints(scoring, group, startPos, finishPos, format === 'champions_league');
        const groupLabel = group === 1 ? 'I' : group === 2 ? 'II' : 'III';
        const posPoints = getPositionPoints(scoring, totalPilots, groupLabel, finishPos);

        rData.set(pilot, {
          kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
          group, startPos, finishPos,
          positionPoints: posPoints, overtakePoints, speedPoints: 0, penalties,
          totalRacePoints: Math.round((posPoints + overtakePoints - penalties) * 10) / 10,
        });
        raceTimes.push({ pilot, time: pData.bestTime });
      });
      excludedEntries.forEach(([pilot, pData]) => {
        rData.set(pilot, {
          kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
          group: 0, startPos: 0, finishPos: 0,
          positionPoints: 0, overtakePoints: 0, speedPoints: 0, penalties: 0, totalRacePoints: 0,
        });
      });
    }

    raceTimes.sort((a, b) => a.time - b.time);
    raceTimes.filter(r => !excludedPilots.has(r.pilot)).slice(0, 5).forEach(({ pilot }, i) => {
      const rd = rData.get(pilot);
      if (rd) {
        rd.speedPoints = scoring.speedPoints[i] || 0;
        rd.totalRacePoints = Math.round((rd.positionPoints + rd.overtakePoints + rd.speedPoints - rd.penalties) * 10) / 10;
      }
    });

    raceResults.push(rData);
    if (raceTimes.length > 0) prevRaceTimes = raceTimes.filter(r => !excludedPilots.has(r.pilot));

    if (shouldShowStartPositions) {
      for (const [pilot, sp] of startPositions) {
        if (!rData.has(pilot) && !excludedPilots.has(pilot)) {
          rData.set(pilot, {
            kart: 0, bestTime: Infinity, bestTimeStr: '',
            group: sp.group, startPos: sp.startPos, finishPos: 0,
            positionPoints: 0, overtakePoints: 0, speedPoints: 0, penalties: 0, totalRacePoints: 0,
          });
        }
      }
    }
  }

  const allPilots = new Set<string>([...qualiData.keys()]);
  for (const rd of raceResults) for (const p of rd.keys()) allPilots.add(p);

  const rows: PilotRow[] = [...allPilots].map(pilot => {
    const q = qualiData.get(pilot) || null;
    const races = raceResults.map(rd => rd.get(pilot) || null);
    const qualiPts = q?.speedPoints ?? 0;
    const racePts = races.reduce((s, r) => s + (r?.totalRacePoints ?? 0), 0);
    const qg = pilotGroup.get(pilot)?.group ?? 0;
    return { pilot, quali: q, races, totalPoints: Math.round((qualiPts + racePts) * 10) / 10, qualiGroup: qg };
  });

  return rows;
}

export interface StandingsPilot {
  pilot: string;
  totalPoints: number;
  qualiTime: string | null;
  qualiKart: number | null;
  qualiSpeedPoints: number;
  group: number;
  races: {
    kart: number; bestTime: string; startPos: number; finishPos: number;
    positionPoints: number; overtakePoints: number; speedPoints: number;
    penalties: number; totalRacePoints: number;
  }[];
}

export interface CompetitionStandings {
  updatedAt: number;
  pilots: StandingsPilot[];
}

export function rowsToStandings(rows: PilotRow[], excludedPilots: Set<string>): CompetitionStandings {
  const included = rows.filter(r => !excludedPilots.has(r.pilot));
  included.sort((a, b) => {
    const diff = b.totalPoints - a.totalPoints;
    if (diff !== 0) return diff;
    return (a.quali?.bestTime ?? Infinity) - (b.quali?.bestTime ?? Infinity);
  });

  const pilots: StandingsPilot[] = included.map(r => ({
    pilot: r.pilot,
    totalPoints: r.totalPoints,
    qualiTime: r.quali?.bestTimeStr ?? null,
    qualiKart: r.quali?.kart ?? null,
    qualiSpeedPoints: r.quali?.speedPoints ?? 0,
    group: r.qualiGroup,
    races: r.races.map(race => ({
      kart: race?.kart ?? 0,
      bestTime: race?.bestTimeStr ?? '',
      startPos: race?.startPos ?? 0,
      finishPos: race?.finishPos ?? 0,
      positionPoints: race?.positionPoints ?? 0,
      overtakePoints: race?.overtakePoints ?? 0,
      speedPoints: race?.speedPoints ?? 0,
      penalties: race?.penalties ?? 0,
      totalRacePoints: race?.totalRacePoints ?? 0,
    })),
  }));

  return { updatedAt: Date.now(), pilots };
}
