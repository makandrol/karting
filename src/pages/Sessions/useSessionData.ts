/**
 * Loads all data needed for SessionDetail page:
 * - all sessions of the day (for prev/next nav)
 * - current session
 * - laps + events (across merged sub-sessions)
 * - competition data + start positions (for race / final phases)
 * - excluded laps
 * - live timing entries (if active)
 *
 * Polls live data every 3s while session is active.
 *
 * Replaces an inline 130-line useEffect that did all of this in SessionDetail.tsx.
 */

import { useState, useEffect, useRef } from 'react';
import { COLLECTOR_URL, api, type DbSession } from '../../services/api';
import { fetchRaceStartPositions } from '../../utils/timing';
import { type S1Event, type SnapshotPosition, parseSessionEvents } from '../../components/Timing/SessionReplay';
import { type DbLap } from '../../utils/session';

export interface SessionDataResult {
  /** Full session row with track_id (the one component cares about). */
  session: (DbSession & { track_id: number }) | null;
  setSession: React.Dispatch<React.SetStateAction<(DbSession & { track_id: number }) | null>>;
  /** All sessions of the same day (for prev/next nav). */
  daySessions: (DbSession & { track_id: number })[];
  /** Laps from all merged sub-sessions. */
  laps: DbLap[];
  setLaps: React.Dispatch<React.SetStateAction<DbLap[]>>;
  /** Mid-lap S1 events (parsed from raw events). */
  s1Events: S1Event[];
  /** Position snapshots (parsed from all event types). */
  snapshots: SnapshotPosition[];
  /** Raw events array (needed for marathon parsing). */
  rawEvents: any[];
  /** Start positions for race/final phases. */
  startPositions: Map<string, number>;
  totalQualifiedPilots: number;
  setStartPositions: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  /** Competition format if session is part of one. */
  sessionFormat: string | null;
  /** Live timing entries (only when session is active). */
  liveEntries: any[];
  /** Set of excluded lap keys ("sessionId|pilot|ts"). */
  excludedLaps: Set<string>;
  setExcludedLaps: React.Dispatch<React.SetStateAction<Set<string>>>;
  loading: boolean;
}

export function useSessionData(sessionId: string | undefined): SessionDataResult {
  const [session, setSession] = useState<(DbSession & { track_id: number }) | null>(null);
  const [daySessions, setDaySessions] = useState<(DbSession & { track_id: number })[]>([]);
  const [laps, setLaps] = useState<DbLap[]>([]);
  const [s1Events, setS1Events] = useState<S1Event[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotPosition[]>([]);
  const [rawEvents, setRawEvents] = useState<any[]>([]);
  const [startPositions, setStartPositions] = useState<Map<string, number>>(new Map());
  const [totalQualifiedPilots, setTotalQualifiedPilots] = useState(0);
  const [sessionFormat, setSessionFormat] = useState<string | null>(null);
  const [liveEntries, setLiveEntries] = useState<any[]>([]);
  const [excludedLaps, setExcludedLaps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  /** Max event ts seen — for incremental live event fetch (marathon real-time). */
  const lastEventTsRef = useRef(0);

  // ── Initial load ───────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    (async () => {
      try {
        const tsMatch = sessionId.match(/session-(\d+)/);
        const date = tsMatch ? new Date(parseInt(tsMatch[1])).toISOString().split('T')[0] : null;

        const allSessions = (date ? await api.sessions.byDate(date) : await api.sessions.all()) as unknown as (DbSession & { track_id: number })[];
        if (!active) return;
        setDaySessions(allSessions);
        const found = allSessions.find(s => s.id === sessionId);
        if (found) setSession(found);

        // Fetch laps + events from all merged sub-sessions
        const sessionIds = found?.merged_session_ids || [sessionId];
        const allLaps: DbLap[] = [];
        const allEvents: any[] = [];
        for (const sid of sessionIds) {
          const [sLaps, sEvents] = await Promise.all([
            api.laps.bySession(sid),
            api.events.bySessionSafe(sid),
          ]);
          allLaps.push(...(sLaps as unknown as DbLap[]));
          allEvents.push(...sEvents);
        }
        if (!active) return;
        const parsed = parseSessionEvents(allEvents);
        setLaps(allLaps);
        setS1Events(parsed.s1Events);
        setSnapshots(parsed.snapshots);
        setRawEvents(allEvents);
        lastEventTsRef.current = allEvents.reduce((m, e: any) => Math.max(m, e.ts || 0), 0);

        // Excluded laps: глобальне сховище (для всіх заїздів) + legacy
        // comp.results.excludedLaps (стара схема для змагань) — об'єднуємо.
        const excludedSet = new Set<string>();
        try {
          const globalExcluded = await api.laps.excludedList();
          for (const k of globalExcluded.laps) excludedSet.add(k);
        } catch { /* ignore */ }

        // Competition data: format, start positions
        const compPhase = (found as any)?.competition_phase;
        const compId = (found as any)?.competition_id;
        const compFormat = (found as any)?.competition_format;
        if (active) setSessionFormat(compFormat || null);

        if (compId) {
          try {
            const comp = await api.competitions.getNormalized(compId);
            const results = comp.results;
            if (results.excludedLaps) for (const k of results.excludedLaps) excludedSet.add(k);
          } catch { /* ignore */ }
        }
        if (active) setExcludedLaps(excludedSet);

        if (compId && (compPhase?.startsWith('race_') || compPhase?.startsWith('final_')) && compFormat) {
          const sp = await fetchRaceStartPositions(COLLECTOR_URL, compId, compPhase, compFormat);
          if (active) {
            setStartPositions(sp.positions);
            setTotalQualifiedPilots(sp.totalQualified);
          }
        } else if (parsed.firstSnapshotPos) {
          if (active) setStartPositions(parsed.firstSnapshotPos);
        }

        // Live entries if session is still active
        if (found && !found.end_time) {
          try {
            const timingRes = await api.timing();
            if (active && timingRes.sessionId === sessionId && timingRes.entries) {
              setLiveEntries(timingRes.entries);
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [sessionId]);

  // ── Live polling for active session ─────────────────────────
  useEffect(() => {
    if (!session || session.end_time) return;
    const timer = setInterval(async () => {
      try {
        const [lapsRes, timingRes, newEvents] = await Promise.all([
          api.laps.bySession(session.id),
          api.timing(),
          api.events.bySessionSafe(session.id, lastEventTsRef.current + 1),
        ]);
        setLaps(lapsRes as unknown as DbLap[]);
        if (timingRes.sessionId === session.id && timingRes.entries) {
          setLiveEntries(timingRes.entries);
        }
        if (newEvents.length > 0) {
          lastEventTsRef.current = newEvents.reduce((m, e: any) => Math.max(m, e.ts || 0), lastEventTsRef.current);
          setRawEvents(prev => [...prev, ...newEvents]);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [session]);

  return {
    session, setSession,
    daySessions, laps, setLaps,
    s1Events, snapshots, rawEvents,
    startPositions, totalQualifiedPilots, setStartPositions,
    sessionFormat, liveEntries,
    excludedLaps, setExcludedLaps,
    loading,
  };
}
