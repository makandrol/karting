/**
 * Competition page types — shared between CompetitionList, CompetitionDetail,
 * LiveResults, LiveSessionTable.
 */

export interface Competition {
  id: string;
  name: string;
  format: string;
  date: string;
  status: string;
  sessions: { sessionId: string; phase: string | null }[];
  results: any;
  uploaded_results: any;
}

export interface SessionLap {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  position: number | null;
  ts: number;
}
