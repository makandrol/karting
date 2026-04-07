import { splitIntoGroups, splitIntoGroupsSprint } from '../data/competitions';

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
  pilot: string; quali: PilotQualiData | null; qualis?: (PilotQualiData | null)[]; races: (PilotRaceData | null)[];
  totalPoints: number;
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
        shouldShowStartPositions = r === activeRaceNum || r === activeRaceNum + 1;
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
    return { pilot, quali: q, races, totalPoints: Math.round((qualiPts + racePts) * 10) / 10 };
  });

  return rows;
}

export function getSprintPositionPoints(finishPos: number): number {
  if (finishPos < 1) return 0;
  if (finishPos === 1) return 40;
  if (finishPos === 2) return 37;
  const pts = 35 - (finishPos - 3) * 2;
  return Math.max(pts, 0);
}

export function getSprintFinalPoints(finishPos: number, precedingPilots: number): number {
  if (finishPos < 1) return 0;
  const pts = 180 - (precedingPilots + finishPos - 1) * 3;
  return Math.max(pts, 0);
}

export function computeSprintStandings(params: ComputeStandingsParams): PilotRow[] {
  const { sessions, sessionLaps, scoring, edits, excludedPilots, maxGroups, pilotsOverride, pilotsLocked, liveSessionId, livePhase, livePositions } = params;

  const getQualiSessions = (n: number) => sessions.filter(s => s.phase?.startsWith(`qualifying_${n}_`));
  const getRaceSessions = (key: string) => sessions.filter(s => s.phase?.startsWith(`${key}_`));
  const getFinalSessions = () => sessions.filter(s => s.phase?.startsWith('final_'));

  const buildQualiData = (qualiSess: CompSession[]) => {
    const data = new Map<string, PilotQualiData>();
    for (const qs of qualiSess) {
      for (const l of (sessionLaps.get(qs.sessionId) || [])) {
        const sec = parseLapSec(l.lap_time);
        if (sec === null || sec < 38) continue;
        const ex = data.get(l.pilot);
        if (!ex || sec < ex.bestTime) data.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart, speedPoints: 0 });
      }
    }
    return data;
  };

  const quali1Data = buildQualiData(getQualiSessions(1));
  const quali2Data = buildQualiData(getQualiSessions(2));
  const allQualiData = buildQualiData([...getQualiSessions(1), ...getQualiSessions(2)]);

  const allQualiSorted = [...allQualiData.entries()]
    .filter(([p]) => !excludedPilots.has(p))
    .sort((a, b) => a[1].bestTime - b[1].bestTime);
  const maxQualified = 45;
  const qualifiedPilots = allQualiSorted.slice(0, maxQualified).map(([p]) => p);
  const disqualifiedPilots = new Set(allQualiSorted.slice(maxQualified).map(([p]) => p));

  // Speed: 1 point to the single fastest pilot per qualifying
  const addQualiSpeedPoints = (data: Map<string, PilotQualiData>) => {
    const sorted = [...data.entries()]
      .filter(([p]) => !excludedPilots.has(p))
      .sort((a, b) => a[1].bestTime - b[1].bestTime);
    if (sorted.length > 0) {
      data.get(sorted[0][0])!.speedPoints = 1;
    }
  };
  addQualiSpeedPoints(quali1Data);
  addQualiSpeedPoints(quali2Data);

  let activePhase: string | null = null;
  if (liveSessionId) {
    const liveSession = sessions.find(s => s.sessionId === liveSessionId);
    activePhase = liveSession?.phase || null;
  } else if (livePhase) {
    activePhase = livePhase;
  }

  const buildRaceData = (raceSessions: CompSession[], startPositions: Map<string, { group: number; startPos: number }>, raceIndex: number, shouldShowStart: boolean, posPointsFn?: (finishPos: number, group: number) => number) => {
    const rData = new Map<string, PilotRaceData>();
    const raceTimes: { pilot: string; time: number; group: number }[] = [];

    for (const rs of raceSessions) {
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

      sorted.forEach(([pilot, pData], i) => {
        const editKey = `${pilot}|${raceIndex}`;
        const edit = edits[editKey];
        const sp = startPositions.get(pilot);
        const isDisq = disqualifiedPilots.has(pilot);
        const startPos = isDisq ? -1 : (edit?.startPos ?? sp?.startPos ?? 0);
        const finishPos = edit?.finishPos ?? (i + 1);
        const group = isDisq ? 0 : (sp?.group ?? groupNum);
        const penalties = edit?.penalties ?? 0;
        const posPoints = posPointsFn ? posPointsFn(finishPos, group) : getSprintPositionPoints(finishPos);

        rData.set(pilot, {
          kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
          group, startPos, finishPos,
          positionPoints: posPoints, overtakePoints: 0, speedPoints: 0, penalties,
          totalRacePoints: Math.round((posPoints - penalties) * 10) / 10,
        });
        raceTimes.push({ pilot, time: pData.bestTime, group: group });
      });

      const excludedEntries = [...pilotStats.entries()].filter(([p]) => excludedPilots.has(p));
      excludedEntries.forEach(([pilot, pData]) => {
        rData.set(pilot, {
          kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
          group: 0, startPos: 0, finishPos: 0,
          positionPoints: 0, overtakePoints: 0, speedPoints: 0, penalties: 0, totalRacePoints: 0,
        });
      });
    }

    // Speed: 1 point to the fastest lap per group
    const groups = new Set(raceTimes.map(r => r.group));
    for (const g of groups) {
      const groupTimes = raceTimes.filter(r => r.group === g && !excludedPilots.has(r.pilot));
      groupTimes.sort((a, b) => a.time - b.time);
      if (groupTimes.length > 0) {
        const rd = rData.get(groupTimes[0].pilot);
        if (rd) {
          rd.speedPoints = 1;
          rd.totalRacePoints = Math.round((rd.positionPoints + rd.speedPoints - rd.penalties) * 10) / 10;
        }
      }
    }

    if (shouldShowStart) {
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

    return { rData, raceTimes };
  };

  const computeStartFromQuali = (qualiData: Map<string, PilotQualiData>) => {
    const sorted = [...qualiData.entries()]
      .filter(([p]) => !excludedPilots.has(p) && !disqualifiedPilots.has(p))
      .sort((a, b) => a[1].bestTime - b[1].bestTime)
      .slice(0, maxQualified);
    const groups = splitIntoGroupsSprint(sorted.map(([p]) => p), maxGroups);
    const sp = new Map<string, { group: number; startPos: number }>();
    groups.forEach((g, gi) => {
      const gNum = gi + 1;
      g.pilots.forEach((p, pi) => {
        sp.set(p, { group: gNum, startPos: pi + 1 });
      });
    });
    return sp;
  };

  const shouldShowRaceStart = (raceKey: string) => {
    if (!activePhase) return true;
    if (activePhase.startsWith(`qualifying_1_`)) return raceKey === 'race_1';
    if (activePhase.startsWith(`race_1_`)) return raceKey === 'race_1' || raceKey === 'race_2';
    if (activePhase.startsWith(`qualifying_2_`)) return raceKey === 'race_1' || raceKey === 'race_2';
    if (activePhase.startsWith(`race_2_`)) return raceKey === 'race_2' || raceKey === 'final';
    if (activePhase.startsWith(`final_`)) return raceKey === 'final';
    return true;
  };

  const startPos1 = computeStartFromQuali(quali1Data);
  const { rData: race1Data, raceTimes: race1Times } = buildRaceData(getRaceSessions('race_1'), startPos1, 1, shouldShowRaceStart('race_1'));

  const startPos2 = computeStartFromQuali(quali2Data);
  const { rData: race2Data, raceTimes: race2Times } = buildRaceData(getRaceSessions('race_2'), startPos2, 2, shouldShowRaceStart('race_2'));

  const computeFinalStart = () => {
    const pointsMap = new Map<string, number>();
    for (const pilot of qualifiedPilots) {
      if (excludedPilots.has(pilot)) continue;
      const r1 = race1Data.get(pilot);
      const r2 = race2Data.get(pilot);
      const q1 = quali1Data.get(pilot);
      const q2 = quali2Data.get(pilot);
      const pts = (q1?.speedPoints ?? 0) + (q2?.speedPoints ?? 0) + (r1?.totalRacePoints ?? 0) + (r2?.totalRacePoints ?? 0);
      pointsMap.set(pilot, pts);
    }
    const sorted = [...pointsMap.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const q1a = quali1Data.get(a[0])?.bestTime ?? Infinity;
        const q1b = quali1Data.get(b[0])?.bestTime ?? Infinity;
        return q1a - q1b;
      })
      .slice(0, maxQualified);

    const n = sorted.length;
    let groupCount: number;
    if (n <= 14) groupCount = 1;
    else if (n <= 29) groupCount = 2;
    else groupCount = 3;
    if (maxGroups !== undefined) groupCount = Math.min(groupCount, maxGroups);

    const buckets: string[][] = Array.from({ length: groupCount }, () => []);
    const baseSize = Math.floor(n / groupCount);
    let remainder = n % groupCount;
    let idx = 0;
    for (let g = 0; g < groupCount; g++) {
      const size = baseSize + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      buckets[g] = sorted.slice(idx, idx + size).map(([p]) => p);
      idx += size;
    }

    const sp = new Map<string, { group: number; startPos: number }>();
    buckets.forEach((gPilots, gi) => {
      const gNum = gi + 1;
      gPilots.forEach((p, pi) => {
        sp.set(p, { group: gNum, startPos: pi + 1 });
      });
    });
    return { sp, groupSizes: buckets.map(b => b.length) };
  };

  const { sp: finalStartPos, groupSizes: finalGroupSizes } = computeFinalStart();
  const finalPrecedingByGroup = new Map<number, number>();
  finalPrecedingByGroup.set(1, 0);
  finalPrecedingByGroup.set(2, finalGroupSizes[0] || 0);
  finalPrecedingByGroup.set(3, (finalGroupSizes[0] || 0) + (finalGroupSizes[1] || 0));
  const finalPosPointsFn = (finishPos: number, group: number) => getSprintFinalPoints(finishPos, finalPrecedingByGroup.get(group) || 0);

  const { rData: finalData } = buildRaceData(getFinalSessions(), finalStartPos, 3, shouldShowRaceStart('final'), finalPosPointsFn);

  const raceResults = [race1Data, race2Data, finalData];

  const allPilots = new Set<string>([...quali1Data.keys(), ...quali2Data.keys()]);
  for (const rd of raceResults) for (const p of rd.keys()) allPilots.add(p);

  const rows: PilotRow[] = [...allPilots].map(pilot => {
    const q1 = quali1Data.get(pilot) || null;
    const q2 = quali2Data.get(pilot) || null;
    const races = raceResults.map(rd => rd.get(pilot) || null);
    const q1Pts = q1?.speedPoints ?? 0;
    const q2Pts = q2?.speedPoints ?? 0;
    const racePts = races.reduce((s, r) => s + (r?.totalRacePoints ?? 0), 0);
    return {
      pilot,
      quali: q1,
      qualis: [q1, q2],
      races,
      totalPoints: Math.round((q1Pts + q2Pts + racePts) * 10) / 10,
    };
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

export function sprintAwareSort(a: PilotRow, b: PilotRow, format?: string): number {
  const diff = b.totalPoints - a.totalPoints;
  if (diff !== 0) return diff;

  if (format === 'sprint') {
    const q1a = a.qualis?.[0]?.bestTime ?? Infinity;
    const q1b = b.qualis?.[0]?.bestTime ?? Infinity;
    if (q1a !== q1b) return q1a - q1b;

    const r1a = a.races[0]?.totalRacePoints ?? 0;
    const r1b = b.races[0]?.totalRacePoints ?? 0;
    if (r1a !== r1b) return r1b - r1a;

    const q2a = a.qualis?.[1]?.bestTime ?? Infinity;
    const q2b = b.qualis?.[1]?.bestTime ?? Infinity;
    if (q2a !== q2b) return q2a - q2b;

    const r2a = a.races[1]?.totalRacePoints ?? 0;
    const r2b = b.races[1]?.totalRacePoints ?? 0;
    if (r2a !== r2b) return r2b - r2a;

    const fa = a.races[2]?.totalRacePoints ?? 0;
    const fb = b.races[2]?.totalRacePoints ?? 0;
    if (fa !== fb) return fb - fa;

    return 0;
  }

  return (a.quali?.bestTime ?? Infinity) - (b.quali?.bestTime ?? Infinity);
}

export function rowsToStandings(rows: PilotRow[], excludedPilots: Set<string>, format?: string): CompetitionStandings {
  const included = rows.filter(r => !excludedPilots.has(r.pilot));
  included.sort((a, b) => sprintAwareSort(a, b, format));

  const pilots: StandingsPilot[] = included.map(r => ({
    pilot: r.pilot,
    totalPoints: r.totalPoints,
    qualiTime: r.quali?.bestTimeStr ?? null,
    qualiKart: r.quali?.kart ?? null,
    qualiSpeedPoints: r.quali?.speedPoints ?? 0,
    group: r.races[0]?.group ?? 0,
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

// ============================================================
// Гонзалес — обчислення результатів
// ============================================================

export interface GonzalesKartResult {
  kart: number;
  bestTime: number | null;
  bestTimeStr: string | null;
  /** Place among all pilots on this kart (1 = fastest) */
  place: number | null;
}

export interface GonzalesPilotRow {
  pilot: string;
  kartResults: GonzalesKartResult[];
  averageTime: number | null;
  completedKarts: number;
  group: number;
  /** 0-based index in the rotation slot list where this pilot starts */
  startSlot: number;
}

export interface GonzalesStandingsData {
  karts: number[];
  rows: GonzalesPilotRow[];
  overallBestPerKart: (number | null)[];
}

export interface ComputeGonzalesParams {
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
  excludedPilots: Set<string>;
  /** Manually configured kart list (from competition results) */
  kartList?: number[];
  /** Kart replacements: original -> replacement mapping */
  kartReplacements?: Record<number, number>;
  /** Excluded karts that shouldn't count in average */
  excludedKarts?: Set<number>;
  /** Which lap numbers count for scoring (e.g. [2,3] = only laps 2 and 3). Empty/undefined = all laps */
  scoringLaps?: number[];
  /** Pilot starting slot assignments (pilot name -> 0-based slot index) */
  pilotStartSlots?: Record<string, number>;
}

export function computeGonzalesStandings(params: ComputeGonzalesParams): GonzalesStandingsData {
  const { sessions, sessionLaps, excludedPilots, kartList, kartReplacements, excludedKarts, scoringLaps, pilotStartSlots } = params;

  const kartSet = new Set<number>();
  for (const s of sessions) {
    if (!s.phase || s.phase.startsWith('qualifying')) continue;
    const laps = sessionLaps.get(s.sessionId) || [];
    for (const l of laps) kartSet.add(l.kart);
  }
  const autoKarts = [...kartSet].sort((a, b) => a - b);
  const karts = kartList && kartList.length > 0 ? kartList : autoKarts;

  const effectiveKart = (k: number): number => {
    if (!kartReplacements) return k;
    return kartReplacements[k] ?? k;
  };

  const scoringLapSet = scoringLaps && scoringLaps.length > 0 ? new Set(scoringLaps) : null;

  const pilotKartBest = new Map<string, Map<number, { time: number; timeStr: string }>>();

  for (const s of sessions) {
    if (!s.phase || s.phase.startsWith('qualifying')) continue;
    const laps = sessionLaps.get(s.sessionId) || [];

    const pilotLapCounts = new Map<string, number>();

    const sortedLaps = [...laps].sort((a, b) => a.ts - b.ts);
    for (const l of sortedLaps) {
      if (excludedPilots.has(l.pilot)) continue;
      const sec = parseLapSec(l.lap_time);
      if (sec === null || sec < 38) continue;

      const count = (pilotLapCounts.get(l.pilot) ?? 0) + 1;
      pilotLapCounts.set(l.pilot, count);

      if (scoringLapSet && !scoringLapSet.has(count)) continue;

      const resolvedKart = effectiveKart(l.kart);
      if (!karts.includes(resolvedKart)) continue;

      if (!pilotKartBest.has(l.pilot)) pilotKartBest.set(l.pilot, new Map());
      const kartMap = pilotKartBest.get(l.pilot)!;
      const existing = kartMap.get(resolvedKart);
      if (!existing || sec < existing.time) {
        kartMap.set(resolvedKart, { time: sec, timeStr: l.lap_time! });
      }
    }
  }

  const excludedKartSet = excludedKarts ?? new Set<number>();

  const rows: GonzalesPilotRow[] = [];
  for (const [pilot, kartMap] of pilotKartBest) {
    const kartResults: GonzalesKartResult[] = karts.map(k => {
      const result = kartMap.get(k);
      return { kart: k, bestTime: result?.time ?? null, bestTimeStr: result?.timeStr ?? null, place: null };
    });
    const validTimes = kartResults
      .filter(r => r.bestTime !== null && !excludedKartSet.has(r.kart))
      .map(r => r.bestTime!);
    const average = validTimes.length > 0
      ? validTimes.reduce((a, b) => a + b, 0) / validTimes.length
      : null;
    const startSlot = pilotStartSlots?.[pilot] ?? -1;
    rows.push({ pilot, kartResults, averageTime: average, completedKarts: validTimes.length, group: 0, startSlot });
  }

  // Compute per-kart rankings (place)
  for (let ki = 0; ki < karts.length; ki++) {
    const pilotsWithTime = rows
      .filter(r => r.kartResults[ki].bestTime !== null)
      .sort((a, b) => a.kartResults[ki].bestTime! - b.kartResults[ki].bestTime!);
    pilotsWithTime.forEach((r, idx) => {
      r.kartResults[ki].place = idx + 1;
    });
  }

  rows.sort((a, b) => {
    if (a.averageTime === null && b.averageTime === null) return 0;
    if (a.averageTime === null) return 1;
    if (b.averageTime === null) return -1;
    return a.averageTime - b.averageTime;
  });

  const overallBestPerKart = karts.map((k, ki) => {
    let best = Infinity;
    for (const r of rows) {
      const t = r.kartResults[ki]?.bestTime;
      if (t !== null && t !== undefined && t < best) best = t;
    }
    return best < Infinity ? best : null;
  });

  return { karts, rows, overallBestPerKart };
}

export interface GonzalesStandings {
  updatedAt: number;
  pilots: { pilot: string; averageTime: number | null; completedKarts: number; kartTimes: (number | null)[] }[];
}

export function gonzalesToStandings(data: GonzalesStandingsData, excludedPilots: Set<string>): GonzalesStandings {
  const included = data.rows.filter(r => !excludedPilots.has(r.pilot));
  return {
    updatedAt: Date.now(),
    pilots: included.map(r => ({
      pilot: r.pilot,
      averageTime: r.averageTime,
      completedKarts: r.completedKarts,
      kartTimes: r.kartResults.map(kr => kr.bestTime),
    })),
  };
}
