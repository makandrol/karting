/**
 * Typed Collector API client.
 *
 * Use these instead of bare `fetch(\`${COLLECTOR_URL}/...\`)` calls.
 * Each endpoint is a typed function with proper auth handling.
 *
 * Backwards-compat: `COLLECTOR_URL` is re-exported from `./http` for legacy code.
 */

import { apiGet, apiGetSafe, apiPost, apiPatch, apiDelete } from './http';
import type { SessionTableRow } from '../../components/Sessions/SessionsTable';

export { CollectorApiError, COLLECTOR_URL } from './http';

// ============================================================
// Shared types
// ============================================================

export interface DbSession extends SessionTableRow {
  date?: string;
  is_race?: number;
  merged_session_ids?: string[];
}

export interface DbLap {
  pilot: string;
  kart: number;
  lap_number: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  best_lap: string | null;
  position: number | null;
  ts: number;
}

export interface CollectorEvent {
  id: number;
  session_id: string;
  event_type: string;
  ts: number;
  data: any;
}

export interface CompetitionDto {
  id: string;
  name: string;
  format: string;
  date: string;
  status: string;
  sessions: { sessionId: string; phase: string | null }[] | string;
  results: any;
  uploaded_results?: any;
}

export interface CollectorStatus {
  isOnline?: boolean;
  online?: boolean;
  pollCount: number;
  errorCount: number;
  entriesCount: number;
  eventsCount: number;
  sessionId: string | null;
  sessionsCount: number;
  lastUpdate: number | null;
  pollInterval: number;
  db?: any;
}

export interface CollectorTimingResponse {
  isOnline: boolean;
  entries: any[];
  teams: any[];
  meta: any;
  trackId: number;
  lastUpdate: number | null;
  sessionId: string | null;
  competition: any;
}

export interface SessionCompetitionInfo {
  competitionId: string | null;
  format: string | null;
  phase: string | null;
}

// ============================================================
// API surface — grouped by resource
// ============================================================

export const api = {
  // ---- Health & live status ----
  status: () => apiGet<CollectorStatus>('/status'),
  timing: () => apiGet<CollectorTimingResponse>('/timing'),

  // ---- Sessions (DB) ----
  sessions: {
    byDate: (date: string) => apiGet<DbSession[]>('/db/sessions', { date }),
    all: () => apiGet<DbSession[]>('/db/sessions'),
    competitionInfo: (sessionId: string) =>
      apiGet<SessionCompetitionInfo>('/db/session-competition', { session: sessionId }),
    counts: (from: string, to: string) =>
      apiGet<Record<string, number>>('/db/session-counts', { from, to }),
    updateTrack: (sessionIds: string[], trackId: number) =>
      apiPost('/db/update-sessions-track', { sessionIds, trackId }),
    propagateTrack: (sessionId: string, trackId: number) =>
      apiPost('/db/propagate-track', { sessionId, trackId }),
    renamePilot: (sessionId: string, oldName: string, newName: string) =>
      apiPost('/db/rename-pilot', { sessionId, oldName, newName }),
  },

  // ---- Laps (DB) ----
  laps: {
    bySession: (sessionId: string) =>
      apiGet<DbLap[]>('/db/laps', { session: sessionId }),
    byKart: (kart: number, from: string, to: string) =>
      apiGet<DbLap[]>('/db/laps', { kart, from, to }),
  },

  // ---- Events ----
  events: {
    bySession: (sessionId: string, since?: number) =>
      apiGet<CollectorEvent[]>('/db/events', { session: sessionId, since }),
    bySessionSafe: (sessionId: string, since?: number) =>
      apiGetSafe<CollectorEvent[]>('/db/events', { session: sessionId, since }).then(r => r ?? []),
  },

  // ---- Karts ----
  karts: {
    statsByDateRange: (from: string, to: string) =>
      apiGet<any>('/db/kart-stats', { from, to }),
    statsBySessions: (sessionIds: string[]) =>
      apiPost<any>('/db/kart-stats', { sessionIds }, { auth: false }),
    sessionCounts: (kart: number) =>
      apiGet<any>('/db/kart-session-counts', { kart }),
  },

  // ---- Competitions ----
  competitions: {
    list: () => apiGet<CompetitionDto[]>('/competitions'),
    byFormat: (format: string) => apiGet<CompetitionDto[]>('/competitions', { format }),
    get: (id: string) => apiGet<CompetitionDto>(`/competitions/${encodeURIComponent(id)}`),
    getSafe: (id: string) => apiGetSafe<CompetitionDto>(`/competitions/${encodeURIComponent(id)}`),
    create: (data: Partial<CompetitionDto>) => apiPost<CompetitionDto>('/competitions', data),
    update: (id: string, fields: Partial<CompetitionDto>) =>
      apiPatch(`/competitions/${encodeURIComponent(id)}`, fields),
    remove: (id: string) => apiDelete(`/competitions/${encodeURIComponent(id)}`),
    linkSession: (id: string, sessionId: string, phase: string) =>
      apiPost(`/competitions/${encodeURIComponent(id)}/link-session`, { sessionId, phase }),
    unlinkSession: (id: string, sessionId: string) =>
      apiPost(`/competitions/${encodeURIComponent(id)}/unlink-session`, { sessionId }),
    updateTrack: (id: string, trackId: number) =>
      apiPost(`/competitions/${encodeURIComponent(id)}/update-track`, { trackId }),
  },

  // ---- Track config ----
  track: {
    current: () => apiGet<{ trackId: number }>('/track'),
    set: (trackId: number) => apiPost('/track', { trackId }),
  },

  // ---- Scoring rules ----
  scoring: {
    get: () => apiGet<any>('/scoring'),
    set: (data: any) => apiPost('/scoring', data),
  },

  // ---- Page visibility / view defaults / moderators ----
  pageVisibility: {
    get: () => apiGet<any>('/page-visibility'),
    set: (data: any) => apiPost('/page-visibility', data),
  },
  viewDefaults: {
    get: () => apiGet<any>('/view-defaults'),
    set: (data: any) => apiPost('/view-defaults', data),
  },
  moderators: {
    get: () => apiGet<any[]>('/moderators'),
    set: (data: any[]) => apiPost('/moderators', data),
  },

  // ---- Admin / system ----
  system: () => apiGet<any>('/system'),
  collectorLog: (limit = 200) => apiGet<any>('/db/collector-log', { limit }),
  analytics: (days = 7) => apiGet<any>('/analytics', { days }),

  // ---- Detector ----
  detector: {
    state: () => apiGet<any>('/competition'),
    start: (format: string, name: string) => apiPost('/competition/start', { format, name }),
    stop: () => apiPost('/competition/stop'),
    phase: (sessionId: string, type: string, name: string) =>
      apiPost('/competition/phase', { sessionId, type, name }),
    reset: () => apiPost('/competition/reset'),
  },
};
