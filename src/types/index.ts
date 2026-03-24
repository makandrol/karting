// ============================================================
// Timing data — дані з табло timing.karting.ua
// ============================================================

/** Мінімальний валідний час кола в секундах. Менше = скоротили трасу */
export const MIN_VALID_LAP_SECONDS = 38;

export interface TimingEntry {
  position: number;
  pilot: string;
  kart: number;
  lastLap: string | null;   // "39.800" or "1:02.222"
  s1: string | null;
  s2: string | null;
  bestLap: string | null;
  lapNumber: number;
  bestS1: string | null;
  bestS2: string | null;
  /** 0..1 прогрес по колу */
  progress: number | null;
  /** Час поточного кола в секундах (демо) */
  currentLapSec: number | null;
  /** Час попереднього завершеного кола в секундах. null = перше коло */
  previousLapSec: number | null;
}

export interface TimingSnapshot {
  timestamp: number;        // unix ms
  sessionId: string;
  entries: TimingEntry[];
}

export interface TimingSession {
  id: string;
  name: string;
  date: string;             // ISO date
  type: 'practice' | 'qualifying' | 'race' | 'unknown';
  startTime: number;
  endTime?: number;
  snapshots: TimingSnapshot[];
}

// ============================================================
// Competition / Results — результати змагань
// ============================================================

export type CompetitionType =
  | 'gonzales'
  | 'light_league'
  | 'champions_league'
  | 'sprint'
  | 'marathon';

export interface Competition {
  id: string;
  name: string;
  type: CompetitionType;
  season: string;           // "2025", "2025-spring"
  rounds: RaceRound[];
}

export interface RaceRound {
  id: string;
  competitionId: string;
  roundNumber: number;
  date: string;
  name: string;
  results: RaceResult[];
}

export interface RaceResult {
  position: number;
  pilot: string;
  kart?: number;
  bestLap?: string;
  totalTime?: string;
  laps?: number;
  points?: number;
  gap?: string;            // "+2.345" or "+1 lap"
}

// ============================================================
// Live race state — поточне змагання
// ============================================================

export interface LiveRaceState {
  isActive: boolean;
  sessionName: string;
  timeRemaining?: string;
  entries: TimingEntry[];
  lastUpdate: number;
}

// ============================================================
// Karts info
// ============================================================

export interface KartTopResult {
  pilot: string;
  bestLap: string;
  bestLapSeconds: number;
  /** ISO datetime: "2025-03-10T18:35:12" */
  datetime: string;
}

/** Один запис кола карту (для повної статистики) */
export interface KartLapRecord {
  pilot: string;
  lapTime: string;
  lapTimeSeconds: number;
  s1: string | null;
  s2: string | null;
  datetime: string;
  lapNumber: number;
  sessionName: string;
}

export interface KartInfo {
  number: number;
  notes?: string;
  avgLapTime?: string;
  status: 'good' | 'average' | 'poor' | 'unknown';
  top5: KartTopResult[];
}

// ============================================================
// Navigation
// ============================================================

export interface NavItem {
  label: string;
  path: string;
  children?: NavItem[];
}
