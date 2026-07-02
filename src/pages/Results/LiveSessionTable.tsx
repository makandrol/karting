/**
 * Live timing table for one competition session.
 * Extracted from CompetitionPage.tsx (390 LOC).
 */

import { useState, useEffect, useMemo } from "react";
import { api } from "../../services/api";
import { getPhaseLabel, splitIntoGroups, splitIntoGroupsSprint, buildGonzalesRotation, getGonzalesKartForRound } from "../../data/competitions";
import { type SessionTableRow } from "../../components/Sessions/SessionsTable";
import { parseLapSec, getSprintPositionPoints } from "../../utils/scoring";
import SessionReplay, { parseSessionEvents } from "../../components/Timing/SessionReplay";
import { buildReplayLaps, extractCompetitionReplayProps } from "../../utils/session";
import type { TimingEntry } from "../../types";
import type { Competition, SessionLap } from "./competition-types";
import type { CompSession } from "../../utils/scoring";

export default function LiveSessionTable({ competition, sessions: sessionsProp, liveSessionId, liveEntries, liveTeams, sessionLaps, compSessions, isScrubbing, scrubTime, onEntriesUpdate }: {
  competition: Competition;
  sessions?: CompSession[];
  liveSessionId: string | null;
  liveEntries: any[];
  liveTeams: any[];
  sessionLaps: Map<string, SessionLap[]>;
  compSessions: SessionTableRow[];
  isScrubbing: boolean;
  scrubTime: number | null;
  onEntriesUpdate?: (entries: TimingEntry[]) => void;
}) {
  const sessions = sessionsProp ?? competition.sessions;
  const excludedLapSet = useMemo(() => new Set(competition.results?.excludedLaps || []), [competition.results?.excludedLaps]);
  const effectiveLaps = useMemo(() => {
    if (excludedLapSet.size === 0) return sessionLaps;
    const filtered = new Map<string, SessionLap[]>();
    for (const [sid, laps] of sessionLaps) {
      filtered.set(sid, laps.filter(l => !excludedLapSet.has(`${sid}|${l.pilot}|${l.ts}`)));
    }
    return filtered;
  }, [sessionLaps, excludedLapSet]);
  const currentPhase = useMemo(() => {
    if (!liveSessionId) return null;
    const s = sessions.find(cs => cs.sessionId === liveSessionId);
    return s?.phase ?? null;
  }, [sessions, liveSessionId]);

  const isQualifying = currentPhase?.startsWith('qualifying') ?? false;
  const isRace = (currentPhase?.startsWith('race_') || currentPhase?.startsWith('final_') || currentPhase?.startsWith('round_')) ?? false;
  const groupCount = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? undefined;

  const sessionEnded = useMemo(() => {
    if (!liveSessionId || isScrubbing) return false;
    const cs = compSessions.find(s => s.id === liveSessionId);
    return cs ? cs.end_time !== null && cs.end_time !== undefined : false;
  }, [liveSessionId, compSessions, isScrubbing]);

  const laps = liveSessionId ? (effectiveLaps.get(liveSessionId) || []) : [];
  const hasData = laps.length > 0 || liveEntries.length > 0;

  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    if (!liveSessionId) { setEvents([]); return; }
    let cancelled = false;
    const fetchEvents = async () => {
      try {
        const data = await api.events.bySession(liveSessionId);
        if (!cancelled) setEvents(data as any);
      } catch {}
    };
    fetchEvents();
    const timer = setInterval(fetchEvents, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [liveSessionId]);

  const { s1Events, snapshots } = useMemo(() => parseSessionEvents(events), [events]);

  const replayLaps = useMemo(() => buildReplayLaps(laps as any), [laps]);

  const sessionStartTime = useMemo(() => {
    if (!liveSessionId) return undefined;
    const cs = compSessions.find(s => s.id === liveSessionId);
    return cs?.start_time ?? undefined;
  }, [liveSessionId, compSessions]);

  const durationSec = useMemo(() => {
    if (!sessionStartTime) return 0;
    if (isScrubbing && scrubTime != null) {
      return Math.max(0, (scrubTime - sessionStartTime) / 1000);
    }
    const cs = compSessions.find(s => s.id === liveSessionId);
    const endTime = cs?.end_time ?? Date.now();
    return Math.max(0, (endTime - sessionStartTime) / 1000);
  }, [sessionStartTime, liveSessionId, compSessions, laps, isScrubbing, scrubTime]);

  const mappedLiveEntries = useMemo(() => {
    return liveEntries.map((e: any) => ({
      position: e.position ?? 0,
      pilot: e.pilot,
      kart: e.kart ?? 0,
      lastLap: e.lastLap ?? null,
      s1: e.s1 ?? null,
      s2: e.s2 ?? null,
      bestLap: e.bestLap ?? null,
      lapNumber: e.lapNumber ?? 0,
      bestS1: e.bestS1 ?? null,
      bestS2: e.bestS2 ?? null,
      progress: e.progress ?? null,
      currentLapSec: null,
      previousLapSec: null,
    }));
  }, [liveEntries]);

  const { raceGroup, isRace: isRacePhase } = useMemo(() => extractCompetitionReplayProps(currentPhase), [currentPhase]);

  const isCL = competition.format === 'champions_league';
  const isSprint = competition.format === 'sprint';
  const excludedPilots = new Set<string>(competition.results?.excludedPilots || []);

  const { startPositions, totalPilots } = useMemo(() => {
    if (!isRace) return { startPositions: undefined, totalPilots: 0 };

    // Gonzales rounds are time attacks — no start positions
    if (currentPhase?.startsWith('round_')) return { startPositions: undefined, totalPilots: 0 };

    const raceMatch = currentPhase!.match(/^race_(\d+)_group_(\d+)$/);
    const finalMatch = !raceMatch ? currentPhase!.match(/^final_group_(\d+)$/) : null;
    const raceNum = raceMatch ? parseInt(raceMatch[1]) : (finalMatch ? 3 : 1);
    const groupNum = raceMatch ? parseInt(raceMatch[2]) : (finalMatch ? parseInt(finalMatch[1]) : 1);

    const isSprint = competition.format === 'sprint';

    const qualiPhasePrefix = isSprint ? `qualifying_${raceNum}_` : 'qualifying';
    const qualiSessions = sessions.filter(s => s.phase?.startsWith(qualiPhasePrefix));
    const qualiData = new Map<string, { bestTime: number; pilot: string }>();
    for (const qs of qualiSessions) {
      for (const l of (effectiveLaps.get(qs.sessionId) || [])) {
        const sec = parseLapSec(l.lap_time);
        if (sec === null || sec < 38) continue;
        const ex = qualiData.get(l.pilot);
        if (!ex || sec < ex.bestTime) qualiData.set(l.pilot, { bestTime: sec, pilot: l.pilot });
      }
    }
    const qualiSorted = [...qualiData.entries()]
      .filter(([p]) => !excludedPilots.has(p))
      .sort((a, b) => a[1].bestTime - b[1].bestTime);
    const maxQualified = competition.results?.racePilotCount ?? (isCL ? 24 : 36);
    const qualifiedPilots = qualiSorted.slice(0, maxQualified).map(([p]) => p);

    if (isSprint) {
      if (finalMatch) {
        const qualiSessions1 = sessions.filter(s => s.phase?.startsWith('qualifying_1_'));
        const qualiSessions2 = sessions.filter(s => s.phase?.startsWith('qualifying_2_'));
        const raceSessions1 = sessions.filter(s => s.phase?.startsWith('race_1_'));
        const raceSessions2 = sessions.filter(s => s.phase?.startsWith('race_2_'));

        const bestTimeMap = (sessions: typeof qualiSessions1) => {
          const map = new Map<string, number>();
          for (const qs of sessions) {
            for (const l of (effectiveLaps.get(qs.sessionId) || [])) {
              const sec = parseLapSec(l.lap_time);
              if (sec === null || sec < 38) continue;
              const ex = map.get(l.pilot);
              if (!ex || sec < ex) map.set(l.pilot, sec);
            }
          }
          return map;
        };

        const q1Times = bestTimeMap(qualiSessions1);
        const q2Times = bestTimeMap(qualiSessions2);
        const allPilots = new Set([...q1Times.keys(), ...q2Times.keys()]);

        const raceFinishOrder = (sessions: typeof raceSessions1) => {
          const byGroup = new Map<number, { pilot: string; lapCount: number; lastPos: number; lastTs: number; bestTime: number }[]>();
          // is_race per group: коли false — timing був у режимі квалі, position
          // ненадійне → фініш за порядком перетину (lastTs).
          const groupIsRace = new Map<number, boolean>();
          for (const rs of sessions) {
            const gMatch = rs.phase?.match(/group_(\d+)/);
            const gNum = gMatch ? parseInt(gMatch[1]) : 0;
            if ((rs as { isRace?: boolean }).isRace != null) groupIsRace.set(gNum, (rs as { isRace?: boolean }).isRace!);
            for (const l of (effectiveLaps.get(rs.sessionId) || [])) {
              if (excludedPilots.has(l.pilot)) continue;
              const sec = parseLapSec(l.lap_time);
              if (sec === null || sec < 38) continue;
              let arr = byGroup.get(gNum);
              if (!arr) { arr = []; byGroup.set(gNum, arr); }
              const ex = arr.find(p => p.pilot === l.pilot);
              if (!ex) {
                arr.push({ pilot: l.pilot, lapCount: 1, lastPos: l.position ?? 99, lastTs: l.ts, bestTime: sec });
              } else {
                ex.lapCount++;
                if (l.ts > ex.lastTs) { ex.lastTs = l.ts; ex.lastPos = l.position ?? 99; }
                if (sec < ex.bestTime) ex.bestTime = sec;
              }
            }
          }
          const finishMap = new Map<string, { finishPos: number; group: number; bestTime: number }>();
          for (const [group, pilots] of byGroup) {
            const finishByTs = groupIsRace.get(group) === false;
            pilots.sort((a, b) => {
              if (a.lapCount !== b.lapCount) return b.lapCount - a.lapCount;
              if (!finishByTs && a.lastPos !== b.lastPos) return a.lastPos - b.lastPos;
              return a.lastTs - b.lastTs;
            });
            pilots.forEach((p, i) => finishMap.set(p.pilot, { finishPos: i + 1, group, bestTime: p.bestTime }));
          }
          return finishMap;
        };

        const r1Finish = raceFinishOrder(raceSessions1);
        const r2Finish = raceFinishOrder(raceSessions2);

        const speedPerGroup = (finishData: Map<string, { finishPos: number; group: number; bestTime: number }>) => {
          const groups = new Map<number, { pilot: string; time: number }[]>();
          for (const [pilot, d] of finishData) {
            let arr = groups.get(d.group);
            if (!arr) { arr = []; groups.set(d.group, arr); }
            arr.push({ pilot, time: d.bestTime });
          }
          const speedMap = new Map<string, number>();
          for (const [, pilots] of groups) {
            pilots.sort((a, b) => a.time - b.time);
            if (pilots.length > 0) speedMap.set(pilots[0].pilot, 1);
          }
          return speedMap;
        };

        const r1Speed = speedPerGroup(r1Finish);
        const r2Speed = speedPerGroup(r2Finish);

        const q1Sorted = [...q1Times.entries()].filter(([p]) => !excludedPilots.has(p)).sort((a, b) => a[1] - b[1]);
        const q1Fastest = q1Sorted.length > 0 ? q1Sorted[0][0] : null;
        const q2Sorted = [...q2Times.entries()].filter(([p]) => !excludedPilots.has(p)).sort((a, b) => a[1] - b[1]);
        const q2Fastest = q2Sorted.length > 0 ? q2Sorted[0][0] : null;

        const pointsMap = new Map<string, number>();
        for (const pilot of allPilots) {
          if (excludedPilots.has(pilot)) continue;
          let pts = 0;
          if (pilot === q1Fastest) pts += 1;
          if (pilot === q2Fastest) pts += 1;
          const r1 = r1Finish.get(pilot);
          if (r1) pts += getSprintPositionPoints(r1.finishPos) + (r1Speed.get(pilot) || 0);
          const r2 = r2Finish.get(pilot);
          if (r2) pts += getSprintPositionPoints(r2.finishPos) + (r2Speed.get(pilot) || 0);
          pointsMap.set(pilot, pts);
        }

        const sorted = [...pointsMap.entries()]
          .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            const q1a = q1Times.get(a[0]) ?? Infinity;
            const q1b = q1Times.get(b[0]) ?? Infinity;
            return q1a - q1b;
          });

        const n = sorted.length;
        const maxGrps = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? (n <= 14 ? 1 : n <= 29 ? 2 : 3);
        const buckets: string[][] = Array.from({ length: maxGrps }, () => []);
        const baseSize = Math.floor(n / maxGrps);
        let rem = n % maxGrps;
        let bIdx = 0;
        for (let g = 0; g < maxGrps; g++) {
          const size = baseSize + (rem > 0 ? 1 : 0);
          if (rem > 0) rem--;
          buckets[g] = sorted.slice(bIdx, bIdx + size).map(([p]) => p);
          bIdx += size;
        }

        const sp = new Map<string, number>();
        if (groupNum <= buckets.length) {
          buckets[groupNum - 1].forEach((p, pi) => { sp.set(p, pi + 1); });
        }

        const totalPilotsOverride = competition.results?.totalPilotsOverride ?? null;
        const pilotsLocked = competition.results?.totalPilotsLocked ?? false;
        const total = (pilotsLocked && totalPilotsOverride !== null) ? totalPilotsOverride : n;
        return { startPositions: sp.size > 0 ? sp : undefined, totalPilots: total };
      }

      const groups = splitIntoGroupsSprint(qualifiedPilots);
      const sp = new Map<string, number>();
      if (groupNum <= groups.length) {
        const g = groups[groupNum - 1];
        g.pilots.forEach((p, pi) => { sp.set(p, pi + 1); });
      }
      const totalPilotsOverride = competition.results?.totalPilotsOverride ?? null;
      const pilotsLocked = competition.results?.totalPilotsLocked ?? false;
      const total = (pilotsLocked && totalPilotsOverride !== null) ? totalPilotsOverride : qualifiedPilots.length;
      return { startPositions: sp.size > 0 ? sp : undefined, totalPilots: total };
    }

    const maxGroups = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? (qualifiedPilots.length <= 13 ? 1 : qualifiedPilots.length <= 26 ? 2 : 3);

    let prevRaceTimes: { pilot: string; time: number }[] = qualiSorted.map(([p, d]) => ({ pilot: p, time: d.bestTime }));
    for (let r = 1; r < raceNum; r++) {
      const rSessions = sessions.filter(s => s.phase?.startsWith(`race_${r}_`));
      const raceTimes: { pilot: string; time: number }[] = [];
      for (const rs of rSessions) {
        for (const l of (effectiveLaps.get(rs.sessionId) || [])) {
          const sec = parseLapSec(l.lap_time);
          if (sec === null || sec < 38) continue;
          const ex = raceTimes.find(rt => rt.pilot === l.pilot);
          if (!ex) raceTimes.push({ pilot: l.pilot, time: sec });
          else if (sec < ex.time) ex.time = sec;
        }
      }
      if (raceTimes.length > 0) prevRaceTimes = raceTimes.filter(r => !excludedPilots.has(r.pilot));
    }

    const prevSorted = [...prevRaceTimes]
      .filter(p => !excludedPilots.has(p.pilot))
      .sort((a, b) => a.time - b.time)
      .slice(0, maxQualified);
    const groups = splitIntoGroups(prevSorted.map(p => p.pilot), maxGroups);
    const sp = new Map<string, number>();
    if (groupNum <= groups.length) {
      const g = groups[groupNum - 1];
      g.pilots.forEach((p, pi) => { sp.set(p, g.pilots.length - pi); });
    }

    const totalPilotsOverride = competition.results?.totalPilotsOverride ?? null;
    const pilotsLocked = competition.results?.totalPilotsLocked ?? false;
    const total = (pilotsLocked && totalPilotsOverride !== null) ? totalPilotsOverride : qualifiedPilots.length;

    return { startPositions: sp.size > 0 ? sp : undefined, totalPilots: total };
  }, [competition, sessions, effectiveLaps, currentPhase, excludedPilots, isCL]);

  const gonzalesPilotSuffix = useMemo<Map<string, string>>(() => {
    if (competition.format !== 'gonzales' || !currentPhase?.startsWith('round_')) return new Map();
    const cfg = competition.results?.gonzalesConfig;
    const pilotStartSlots: Record<string, number> = cfg?.pilotStartSlots || {};
    const kartListCfg: number[] = cfg?.kartList || [];

    const roundMatch = currentPhase.match(/^round_(\d+)/);
    if (!roundMatch) return new Map();
    const roundNum = parseInt(roundMatch[1]) - 1;

    const allPilots = Object.keys(pilotStartSlots);
    if (allPilots.length === 0 || kartListCfg.length === 0) return new Map();

    const slots = buildGonzalesRotation(kartListCfg, allPilots.length, cfg?.slotOrder ?? undefined);
    const kartToPilot = new Map<number, string>();
    for (const pilot of allPilots) {
      const startSlot = pilotStartSlots[pilot];
      if (startSlot == null || startSlot < 0) continue;
      const slot = getGonzalesKartForRound(slots, startSlot, roundNum);
      if (slot.kart !== null) kartToPilot.set(slot.kart, pilot);
    }

    const suffix = new Map<string, string>();
    const seen = new Set<number>();
    for (const entry of laps) {
      if (!entry.kart || seen.has(entry.kart)) continue;
      seen.add(entry.kart);
      const gonzPilot = kartToPilot.get(entry.kart);
      const parts = gonzPilot?.trim().split(' ').filter(Boolean);
      const surname = parts?.[0];
      if (entry.pilot.startsWith('Карт ') && surname) {
        suffix.set(entry.pilot, `(${surname})`);
      } else if (gonzPilot && entry.pilot !== gonzPilot && surname) {
        suffix.set(entry.pilot, `(${surname})`);
      }
    }
    return suffix;
  }, [competition, currentPhase, laps]);

  const noActiveSession = !liveSessionId || (!isQualifying && !isRace) || !hasData || sessionEnded;
  useEffect(() => {
    if (noActiveSession) onEntriesUpdate?.([]);
  }, [noActiveSession]);

  if (noActiveSession) {
    return (
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-dark-800">
          <h3 className="text-dark-500 font-semibold text-sm">Немає активного заїзду</h3>
        </div>
      </div>
    );
  }

  const phaseLabel = currentPhase ? getPhaseLabel(competition.format, currentPhase, groupCount) : '';

  return (
    <div>
      <div className="px-1 py-1.5">
        <h3 className="text-white font-semibold text-sm">{phaseLabel}</h3>
      </div>
      <SessionReplay
        laps={replayLaps}
        durationSec={durationSec}
        sessionStartTime={sessionStartTime}
        isLive={!sessionEnded}
        autoPlay
        liveEntries={isScrubbing ? undefined : mappedLiveEntries}
        s1Events={s1Events}
        snapshots={snapshots}
        startPositions={startPositions}
        raceGroup={raceGroup}
        totalQualifiedPilots={totalPilots}
        competitionFormat={competition.format}
        hidePoints={isSprint}
        defaultSortMode={isRace && !currentPhase?.startsWith('round_') ? 'race' : 'qualifying'}
        showScrubber={false}
        pilotSuffix={gonzalesPilotSuffix.size > 0 ? gonzalesPilotSuffix : undefined}
        onEntriesUpdate={onEntriesUpdate}
      />
    </div>
  );
}



