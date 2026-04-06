import { mergePilotNames } from './timing';

export interface DbLap {
  id?: number;
  session_id?: string;
  pilot: string;
  kart: number;
  lap_number: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  best_lap?: string | null;
  position: number | null;
  ts: number;
}

export interface ReplayLap {
  pilot: string;
  kart: number;
  lapNumber: number;
  lapTime: string;
  s1: string;
  s2: string;
  position: number;
  ts: number;
}

export function buildReplayLaps(dbLaps: DbLap[]): ReplayLap[] {
  return mergePilotNames(dbLaps)
    .filter(l => l.lap_time)
    .map(l => ({
      pilot: l.pilot,
      kart: l.kart,
      lapNumber: l.lap_number,
      lapTime: l.lap_time!,
      s1: l.s1 || '',
      s2: l.s2 || '',
      position: l.position || 0,
      ts: l.ts,
    }));
}

export function extractCompetitionReplayProps(competitionPhase: string | null | undefined) {
  const raceGroup = competitionPhase?.match(/group_(\d+)/)?.[1]
    ? parseInt(competitionPhase!.match(/group_(\d+)/)![1])
    : undefined;
  const isRace = competitionPhase?.startsWith('race_') ?? false;
  return { raceGroup, isRace };
}
