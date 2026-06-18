import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { api } from '../../services/api';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, getPhaseLabel, getPhasesForFormat, splitIntoGroups, splitIntoGroupsSprint, getGonzalesGroupCount, getGonzalesRoundCount, buildGonzalesRotation, getGonzalesKartForRound } from '../../data/competitions';
import { toSeconds, isValidSession, KART_COLOR, shortName, loadWithExpiry, saveWithExpiry } from '../../utils/timing';
import { fmtDateISO } from '../../utils/datetime';
import { LoadingState } from '../../components/States';
import { useAuth } from '../../services/auth';
import { TRACK_CONFIGS, trackDisplayId, isReverseTrack, baseTrackId } from '../../data/tracks';
import SessionsTable, { type SessionTableRow } from '../../components/Sessions/SessionsTable';
import LeagueResults from '../../components/Results/LeagueResults';
import GonzalesResults from '../../components/Results/GonzalesResults';
import CompetitionTimeline from '../../components/Results/CompetitionTimeline';
import { parseLapSec, getSprintPositionPoints } from '../../utils/scoring';
import { FORMAT_MAX_GROUPS } from '../../utils/competitionLinking';
import { useLayoutPrefs, PAGE_SECTIONS } from '../../services/layoutPrefs';
import TableLayoutBar from '../../components/TableLayoutBar';
import SessionReplay, { parseSessionEvents } from '../../components/Timing/SessionReplay';
import { buildReplayLaps, extractCompetitionReplayProps } from '../../utils/session';
import type { TimingEntry } from '../../types';
import type { Competition, SessionLap } from './competition-types';
import {
  FORMAT_FILTERS, COMP_LIST_NAMES, DAY_NAMES, MONTH_NAMES,
  localDateStr, getCompRealDate, getMonday, getWeekDays, getWeeksInMonth,
  getCompetitionDisplayName,
} from './competition-utils';
import CompetitionList from './CompetitionList';
import LiveSessionTable from './LiveSessionTable';
import CompetitionLayoutWrapper from './CompetitionLayoutWrapper';
import CompetitionParams from './CompetitionParams';

const Onboard = lazy(() => import('../Info/Onboard'));

export default function CompetitionPage() {
  const { type, eventId } = useParams<{ type: string; eventId?: string }>();
  const navigate = useNavigate();
  const { hasPermission, user, isOwner } = useAuth();
  const canManage = hasPermission('manage_results');
  const { isSectionVisible } = useLayoutPrefs();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [compSessions, setCompSessions] = useState<SessionTableRow[]>([]);
  const [allSessionsEnded, setAllSessionsEnded] = useState(false);
  const [pilotCount, setPilotCount] = useState(0);
  const [autoGroups, setAutoGroups] = useState(1);
  const manuallyReopened = useRef(false);
  const changeTrackRef = useRef<((newTrackId: number) => Promise<void>) | null>(null);
  const autoClosedRef = useRef(false);

  const fetchCompSessions = async (sessions: { sessionId: string; phase: string | null }[], cancelled: () => boolean) => {
    const dates = new Set<string>();
    for (const s of sessions) {
      const m = s.sessionId.match(/session-(\d+)/);
      if (m) { const d = new Date(parseInt(m[1])); dates.add(fmtDateISO(d)); }
    }
    const sessionIds = new Set(sessions.map(s => s.sessionId));
    const all: SessionTableRow[] = [];
    for (const date of dates) {
      if (cancelled()) return;
      try {
        const data = await api.sessions.byDate(date);
        all.push(...(data as unknown as SessionTableRow[]).filter(s => sessionIds.has(s.id)));
      } catch {}
    }
    if (cancelled()) return;
    setCompSessions(all);
    if (all.length > 0 && all.every(s => s.end_time !== null && s.end_time !== undefined)) {
      setAllSessionsEnded(true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCompetition(null);
    setCompetitions([]);
    setCompSessions([]);
    setAllSessionsEnded(false);
    setPilotCount(0);
    manuallyReopened.current = false;
    autoClosedRef.current = false;
    if (eventId) {
      api.competitions.getSafeNormalized(eventId)
        .then(data => {
          if (cancelled) return;
          setCompetition(data as unknown as Competition);
          if (data?.sessions?.length) fetchCompSessions(data.sessions, () => cancelled);
          setLoading(false);
        })
        .catch(() => { if (!cancelled) setLoading(false); });
    } else if (type) {
      api.competitions.byFormat(type)
        .then(data => { if (!cancelled) { setCompetitions(data as unknown as Competition[]); setLoading(false); } })
        .catch(() => { if (!cancelled) setLoading(false); });
    } else {
      api.competitions.list()
        .then(data => { if (!cancelled) { setCompetitions(data as unknown as Competition[]); setLoading(false); } })
        .catch(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [type, eventId]);

  const allPhasesLinked = (() => {
    if (!competition) return false;
    const groupCount = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? autoGroups;
    const gonzalesRoundCount = competition.format === 'gonzales' ? (competition.results?.gonzalesRoundCount ?? null) : null;
    const effectivePhases = getPhasesForFormat(competition.format, groupCount, gonzalesRoundCount);
    const totalPhases = effectivePhases.length;
    const linkedPhases = competition.sessions.filter(s => s.phase).length;
    return totalPhases > 0 && linkedPhases >= totalPhases;
  })();

  useEffect(() => {
    if (!competition || competition.status !== 'live' || !canManage) return;
    if (!allSessionsEnded || !allPhasesLinked) return;
    if (manuallyReopened.current || autoClosedRef.current) return;
    autoClosedRef.current = true;
    (async () => {
      try {
        await api.competitions.update(competition.id, { status: 'finished' });
        setCompetition(prev => prev ? { ...prev, status: 'finished' } : prev);
      } catch {}
    })();
  }, [competition?.status, allSessionsEnded, allPhasesLinked, canManage]);

  const toggleStatus = async () => {
    if (!competition) return;
    const newStatus = competition.status === 'live' ? 'finished' : 'live';
    if (newStatus === 'live') manuallyReopened.current = true;
    try {
      await api.competitions.update(competition.id, { status: newStatus });
      setCompetition(prev => prev ? { ...prev, status: newStatus } : prev);
    } catch {}
  };

  const handleDelete = async () => {
    if (!competition) return;
    if (!window.confirm(`Видалити змагання "${getCompetitionDisplayName(competition)}"? Цю дію не можна скасувати.`)) return;
    try {
      await api.competitions.remove(competition.id);
      navigate('/results');
    } catch {}
  };

  if (loading) return <LoadingState />;

  if (!eventId && !type) {
    return <CompetitionList competitions={competitions} />;
  }

  if (!eventId && type) {
    return <CompetitionList competitions={competitions} initialFilter={type} />;
  }

  if (!competition) {
    return (
      <div className="card text-center py-12 text-dark-500">
        <p className="mb-2">Змагання не знайдено</p>
        <Link to="/results" className="text-primary-400 hover:text-primary-300 text-sm">← Назад</Link>
      </div>
    );
  }

  const config = COMPETITION_CONFIGS[competition.format as keyof typeof COMPETITION_CONFIGS];

  const trackId = competition.results?.trackId ?? null;
  const trackConfig = trackId ? TRACK_CONFIGS.find(t => t.id === trackId) : null;
  const trackLabel = trackConfig ? `Траса ${trackDisplayId(trackConfig.id)}` : null;

  const groupCount = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? autoGroups;
  const gonzalesRoundCount = competition.format === 'gonzales' ? (competition.results?.gonzalesRoundCount ?? null) : null;
  const effectivePhases = getPhasesForFormat(competition.format, groupCount, gonzalesRoundCount);
  const totalPhases = effectivePhases.length;
  const linkedPhases = competition.sessions.filter(s => s.phase).length;

  return (
    <div className="space-y-4">
      {(competition.format === 'gonzales' || competition.format === 'light_league' || competition.format === 'champions_league' || competition.format === 'sprint') && (
        <TableLayoutBar pageId="competition" sections={[
          ...PAGE_SECTIONS.competition.filter(s => s.id !== 'kartManager' || competition.format === 'gonzales'),
          { id: 'editLog', label: 'Журнал змін' },
        ]} disabledSections={isOwner ? undefined : new Set(['kartManager', 'editLog', 'onboard'])} />
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">{getCompetitionDisplayName(competition).replace(/,?\s*Траса\s*\d+R?/, '')}</h1>
            <div className="flex items-center gap-1 border border-dark-700 rounded px-2 py-1">
              <svg className="w-3.5 h-3.5 text-dark-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              <select
                value={trackId ?? ''}
                onChange={e => { if (!canManage) return; const v = parseInt(e.target.value); if (!isNaN(v) && changeTrackRef.current) { changeTrackRef.current(v); setCompetition(prev => prev ? { ...prev, results: { ...prev.results, trackId: v } } : prev); } }}
                disabled={!canManage}
                className={`bg-transparent text-dark-300 text-xs outline-none w-10 ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <option value=""></option>
                {[...TRACK_CONFIGS].sort((a, b) => {
                  const aR = isReverseTrack(a.id) ? 1 : 0;
                  const bR = isReverseTrack(b.id) ? 1 : 0;
                  if (aR !== bR) return aR - bR;
                  return baseTrackId(a.id) - baseTrackId(b.id);
                }).map(t => (
                  <option key={t.id} value={t.id}>{trackDisplayId(t.id)}</option>
                ))}
              </select>
            </div>
            {(competition.format === 'gonzales' || competition.format === 'light_league' || competition.format === 'champions_league' || competition.format === 'sprint') && (
              <CompetitionParams
                pilotCount={pilotCount}
                pilotOverride={competition.results?.totalPilotsOverride ?? null}
                pilotLocked={competition.results?.totalPilotsLocked ?? false}
                groupOverride={competition.results?.groupCountOverride ?? null}
                autoGroups={autoGroups}
                maxGroups={FORMAT_MAX_GROUPS[competition.format] ?? 3}
                canManage={canManage}
                format={competition.format}
                racePilotCount={competition.results?.racePilotCount ?? null}
                onSave={async (partial) => {
                  try {
                    let comp: any = null;
                    try { comp = await api.competitions.getNormalized(competition.id); } catch { return; }
                    const currentResults = comp.results;
                    const newResults = { ...currentResults, ...partial };

                    const groupChanged = 'groupCountOverride' in partial;
                    const pilotChanged = 'totalPilotsOverride' in partial || 'totalPilotsLocked' in partial;

                    if (groupChanged || pilotChanged) {
                      const isGonzales = competition.format === 'gonzales';

                      // When pilot count changes for Gonzales, derive groupCount and roundCount
                      if (pilotChanged && isGonzales) {
                        const newPilots = newResults.totalPilotsLocked && newResults.totalPilotsOverride != null
                          ? newResults.totalPilotsOverride
                          : pilotCount;
                        if (newPilots > 0) {
                          newResults.groupCountOverride = getGonzalesGroupCount(newPilots);
                          newResults.gonzalesRoundCount = getGonzalesRoundCount(newPilots);
                        }
                      }

                      const newGroupCount = newResults.groupCountOverride
                        ?? newResults.autoDetectedGroups ?? autoGroups;
                      const gonzRoundCount = isGonzales ? (newResults.gonzalesRoundCount ?? null) : null;
                      const newPhases = getPhasesForFormat(competition.format, newGroupCount, gonzRoundCount);

                      const currentSessions: { sessionId: string; phase: string | null }[] = comp.sessions || [];

                      // Split current sessions into qualifying and non-qualifying
                      const qualiSessions = currentSessions.filter(s => s.phase?.startsWith('qualifying'));
                      const nonQualiSessions = currentSessions.filter(s => !s.phase?.startsWith('qualifying'));

                      const qualiPhases = newPhases.filter(p => p.id.startsWith('qualifying'));
                      const roundPhases = newPhases.filter(p => !p.id.startsWith('qualifying'));

                      // Keep qualifying sessions matched by phase, up to the new qualifying count
                      const reassigned: { sessionId: string; phase: string | null }[] = [];
                      for (const qp of qualiPhases) {
                        const existing = qualiSessions.find(s => s.phase === qp.id);
                        if (existing) {
                          reassigned.push({ sessionId: existing.sessionId, phase: qp.id });
                        }
                      }

                      // Assign non-qualifying sessions to round phases sequentially
                      for (let i = 0; i < roundPhases.length && i < nonQualiSessions.length; i++) {
                        reassigned.push({ sessionId: nonQualiSessions[i].sessionId, phase: roundPhases[i].id });
                      }

                      // If we need more sessions, try to find available ones from the same day
                      const filledRounds = Math.min(roundPhases.length, nonQualiSessions.length);
                      if (filledRounds < roundPhases.length && reassigned.length > 0) {
                        const lastTs = Math.max(...reassigned.map(s => {
                          const m = s.sessionId.match(/session-(\d+)/);
                          return m ? parseInt(m[1]) : 0;
                        }));
                        const dateObj = new Date(lastTs);
                        const dateStr = fmtDateISO(dateObj);
                        try {
                          const daySessions = await api.sessions.byDate(dateStr) as any as { id: string; start_time: number; end_time: number | null; competition_id?: string | null; best_lap_time?: string | null }[];
                          const linkedIds = new Set(reassigned.map(s => s.sessionId));
                          const available = daySessions
                            .filter(s => s.end_time && isValidSession(s) && s.best_lap_time != null && (!s.competition_id || s.competition_id === competition.id) && !linkedIds.has(s.id))
                            .filter(s => s.start_time > lastTs)
                            .sort((a, b) => a.start_time - b.start_time);

                          for (let i = filledRounds; i < roundPhases.length && (i - filledRounds) < available.length; i++) {
                            reassigned.push({ sessionId: available[i - filledRounds].id, phase: roundPhases[i].id });
                          }
                        } catch {}
                      }

                      await api.competitions.update(competition.id, { results: newResults, sessions: reassigned as any });
                      setCompetition(prev => prev ? { ...prev, results: newResults, sessions: reassigned } : prev);
                      if (reassigned.length > currentSessions.length) fetchCompSessions(reassigned, () => false);
                    } else {
                      await api.competitions.update(competition.id, { results: newResults });
                      setCompetition(prev => prev ? { ...prev, results: newResults } : prev);
                    }
                  } catch {}
                }}
              />
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {competition.status === 'live' && allSessionsEnded && allPhasesLinked ? (
            <>
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-500/15 text-yellow-400">Очікує завершення</span>
              {canManage && (
                <button onClick={toggleStatus}
                  className="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-dark-400 hover:text-white transition-colors">
                  Завершити
                </button>
              )}
              {canManage && (
                <button onClick={handleDelete}
                  className="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-dark-400 hover:text-red-400 transition-colors">
                  Видалити
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                competition.status === 'finished' ? 'bg-dark-800 text-dark-400' : 'bg-green-500/15 text-green-400'
              }`}>
                {competition.status === 'finished' ? 'Завершено' : 'Live'}
              </span>
              {canManage && (
                <button onClick={toggleStatus}
                  className="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-dark-400 hover:text-white transition-colors">
                  {competition.status === 'finished' ? 'Відкрити' : 'Завершити'}
                </button>
              )}
              {canManage && (
                <button onClick={handleDelete}
                  className="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-dark-400 hover:text-red-400 transition-colors">
                  Видалити
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <LiveResults key={competition.id} competition={competition} allSessionsEnded={allSessionsEnded && allPhasesLinked} compSessions={compSessions} onPilotCount={setPilotCount} onAutoGroups={setAutoGroups} changeTrackRef={changeTrackRef} onRefreshSessions={(sessions) => fetchCompSessions(sessions, () => false)} />
    </div>
  );
}

function LiveResults({ competition: initialCompetition, allSessionsEnded, compSessions, onPilotCount, onAutoGroups, changeTrackRef, onRefreshSessions }: { competition: Competition; allSessionsEnded: boolean; compSessions: SessionTableRow[]; onPilotCount: (n: number) => void; onAutoGroups: (n: number) => void; changeTrackRef?: React.MutableRefObject<((newTrackId: number) => Promise<void>) | null>; onRefreshSessions?: (sessions: { sessionId: string; phase: string | null }[]) => void }) {
  const { isOwner } = useAuth();
  const { isSectionVisible } = useLayoutPrefs();
  const [competition, setCompetition] = useState(initialCompetition);
  const [sessionLaps, setSessionLaps] = useState<Map<string, SessionLap[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<{ pilot: string; position: number }[]>([]);
  const [kartManagerPortalEl, setKartManagerPortalEl] = useState<HTMLDivElement | null>(null);
  const kartManagerPortalRef = useCallback((node: HTMLDivElement | null) => { setKartManagerPortalEl(node); }, []);
  const [liveEntries, setLiveEntries] = useState<any[]>([]);
  const [liveTeams, setLiveTeams] = useState<any[]>([]);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [onboardEntries, setOnboardEntries] = useState<TimingEntry[]>([]);

  const resultsRef = useRef(competition.results);
  useEffect(() => { resultsRef.current = competition.results; }, [competition.results]);
  const saveLockRef = useRef<Promise<void>>(Promise.resolve());

  const saveResults = useCallback(async (partial: Record<string, any>) => {
    saveLockRef.current = saveLockRef.current.then(async () => {
      try {
        let fresh: any = null;
        try { fresh = await api.competitions.getSafeNormalized(competition.id); } catch {}
        const currentResults = fresh?.results ?? competition.results ?? {};
        const merged = { ...currentResults, ...partial };
        await api.competitions.update(competition.id, { results: merged });
        resultsRef.current = merged;
        setCompetition(prev => prev ? { ...prev, results: merged } : prev);
      } catch {}
    });
    return saveLockRef.current;
  }, [competition.id]);

  const changeTrack = useCallback(async (newTrackId: number) => {
    await saveResults({ trackId: newTrackId });
    try {
      await api.competitions.updateTrack(competition.id, newTrackId);
    } catch {}
  }, [competition.id, saveResults]);

  useEffect(() => {
    if (changeTrackRef) changeTrackRef.current = changeTrack;
    return () => { if (changeTrackRef) changeTrackRef.current = null; };
  }, [changeTrack, changeTrackRef]);

  const sessionTimes = useMemo(() => {
    return compSessions
      .filter(s => {
        const hasLaps = sessionLaps.has(s.id) && (sessionLaps.get(s.id)?.length ?? 0) > 0;
        return hasLaps && isValidSession(s);
      })
      .map(s => {
        const compSession = competition.sessions.find(cs => cs.sessionId === s.id);
        return { sessionId: s.id, phase: compSession?.phase ?? null, startTime: s.start_time, endTime: s.end_time };
      }).sort((a, b) => a.startTime - b.startTime);
  }, [compSessions, competition.sessions, sessionLaps]);

  const filteredSessionLaps = useMemo(() => {
    if (scrubTime === null) return sessionLaps;
    const filtered = new Map<string, SessionLap[]>();
    for (const [sessionId, laps] of sessionLaps) {
      const st = sessionTimes.find(s => s.sessionId === sessionId);
      if (!st || st.startTime > scrubTime) continue;
      filtered.set(sessionId, laps.filter(l => l.ts <= scrubTime));
    }
    return filtered;
  }, [sessionLaps, scrubTime, sessionTimes]);

  const scrubSessionId = useMemo(() => {
    if (scrubTime === null) return null;
    const active = sessionTimes.find(s => s.startTime <= scrubTime && (s.endTime === null || s.endTime >= scrubTime));
    return active?.sessionId ?? null;
  }, [scrubTime, sessionTimes]);

  // Get the last active phase when scrubbing (for determining which race's start positions to show)
  const scrubActivePhase = useMemo(() => {
    if (scrubTime === null) return null;
    // Find the last session that ended before or at scrubTime
    const lastSession = [...sessionTimes]
      .filter(s => s.endTime !== null && s.endTime <= scrubTime)
      .sort((a, b) => b.endTime! - a.endTime!)[0];
    return lastSession?.phase ?? null;
  }, [scrubTime, sessionTimes]);

  const scrubPilots = useMemo(() => {
    if (scrubTime === null || !scrubSessionId) return [];
    const laps = sessionLaps.get(scrubSessionId) || [];
    const pilots = new Set<string>();
    for (const l of laps) {
      if (l.ts <= scrubTime) pilots.add(l.pilot);
    }
    return [...pilots];
  }, [scrubTime, scrubSessionId, sessionLaps]);

  const fetchAllLaps = async (comp: Competition) => {
    if (comp.sessions.length === 0) return new Map<string, SessionLap[]>();
    const map = new Map<string, SessionLap[]>();
    for (const s of comp.sessions) {
      try {
        const data = await api.laps.bySession(s.sessionId);
        map.set(s.sessionId, data as any);
      } catch {}
    }
    return map;
  };

  const knownSessionCountRef = useRef(initialCompetition.sessions.length);

  useEffect(() => {
    let cancelled = false;
    fetchAllLaps(initialCompetition).then(map => {
      if (!cancelled) { setSessionLaps(map); setLoading(false); }
    });

    if (initialCompetition.status !== 'live') return () => { cancelled = true; };

    const slowTimer = setInterval(async () => {
      if (!liveEnabled) return;
      try {
        let fresh: Competition;
        try { fresh = await api.competitions.getNormalized(initialCompetition.id) as unknown as Competition; }
        catch { return; }
        if (cancelled) return;
        setCompetition(fresh);
        if (fresh.sessions.length !== knownSessionCountRef.current) {
          knownSessionCountRef.current = fresh.sessions.length;
          onRefreshSessions?.(fresh.sessions);
        }
        const map = await fetchAllLaps(fresh);
        if (!cancelled) setSessionLaps(map);
      } catch {}
    }, 3000);

    const fastTimer = setInterval(async () => {
      if (!liveEnabled) return;
      try {
        const [statusRes, timingRes] = await Promise.all([
          api.status(),
          api.timing(),
        ]);
        if (cancelled) return;
        const currentLiveId = statusRes.sessionId || null;
        setLiveSessionId(currentLiveId);

        // ВАЖЛИВО: frontend більше не лінкує live-сесії. Усе лінкування
        // виконує колектор (storage.autoLinkSessionToActiveCompetition +
        // finalizeSessionPhaseOnFirstLap). Це уникає race condition між
        // двома мозками. Якщо колектор пропустить — admin може лінкнути
        // вручну через SessionTypeChanger на сторінці заїзду.
        if (timingRes.entries?.length > 0) {
          setLivePositions(timingRes.entries.map((e: any) => ({
            pilot: e.pilot,
            position: Number(e.position),
          })));
          setLiveEntries(timingRes.entries);
          setLiveTeams(timingRes.teams || []);
        } else {
          setLivePositions([]);
          setLiveEntries([]);
          setLiveTeams([]);
        }
      } catch {}
    }, 2000);

    return () => { cancelled = true; clearInterval(slowTimer); clearInterval(fastTimer); };
  }, [initialCompetition.id, liveEnabled]);

  if (loading) return <LoadingState text="Завантаження даних..." size="md" />;
  if (competition.sessions.length === 0) return <div className="card text-center py-12 text-dark-500">Немає прив'язаних заїздів</div>;

  const groupCount = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? 1;

  const effectiveReplaySessionId = (scrubTime !== null ? scrubSessionId : liveSessionId) ?? undefined;

  const onboardEl = isSectionVisible('competition', 'onboard') ? (
    <div key="onboard" className="flex justify-center">
      <div className="relative bg-dark-950 border border-dark-700 rounded-xl overflow-hidden" style={{ width: 844, height: 390 }}>
        <Suspense fallback={null}>
          <Onboard
            replayEntries={onboardEntries}
            replaySessionId={effectiveReplaySessionId}
            embedded
            scrubTime={scrubTime}
          />
        </Suspense>
      </div>
    </div>
  ) : null;

  if (competition.format === 'gonzales') {
    const isScrubbing = scrubTime !== null;

    const gonzalesResultsEl = (
      <GonzalesResults
        key="leaguePoints"
        competitionId={competition.id}
        sessions={competition.sessions}
        sessionLaps={isScrubbing ? filteredSessionLaps : sessionLaps}
        liveSessionId={isScrubbing ? scrubSessionId : liveSessionId}
        liveEnabled={!isScrubbing && liveEnabled}
        onToggleLive={() => { if (isScrubbing) { setScrubTime(null); setLiveEnabled(true); } else setLiveEnabled(v => !v); }}
        initialExcludedPilots={competition.results?.excludedPilots}
        excludedLapKeys={competition.results?.excludedLaps}
        gonzalesConfig={competition.results?.gonzalesConfig}
        onSaveResults={saveResults}
        onPilotCount={onPilotCount}
        onAutoGroups={onAutoGroups}
        kartManagerPortal={kartManagerPortalEl}
        trackId={competition.results?.trackId ?? null}
        pilotCountOverride={competition.results?.totalPilotsLocked ? (competition.results?.totalPilotsOverride ?? null) : null}
      />
    );

    const liveSessionEl = (
      <LiveSessionTable
        key="liveSession"
        competition={competition}
        liveSessionId={isScrubbing ? scrubSessionId : liveSessionId}
        liveEntries={isScrubbing ? [] : liveEntries}
        liveTeams={isScrubbing ? [] : liveTeams}
        sessionLaps={isScrubbing ? filteredSessionLaps : sessionLaps}
        compSessions={compSessions}
        isScrubbing={isScrubbing}
        scrubTime={scrubTime}
        onEntriesUpdate={setOnboardEntries}
      />
    );

    const gonzalesTop3 = (() => {
      const pilots = competition.results?.standings?.pilots;
      if (!pilots || pilots.length === 0) return null;
      const top = pilots
        .filter((p: any) => p.averageTime != null)
        .sort((a: any, b: any) => a.averageTime - b.averageTime)
        .slice(0, 3);
      if (top.length === 0) return null;
      return top as { pilot: string; averageTime: number }[];
    })();

    const sessionsEl = compSessions.length > 0 ? (
      <div key="sessions" className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-dark-800 flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">Список заїздів ({compSessions.length})</h3>
          {gonzalesTop3 && (
            <div className="flex items-center gap-3 text-xs font-mono">
              {gonzalesTop3.map((p, i) => (
                <span key={p.pilot} className="flex items-center gap-1">
                  <span className={i === 0 ? 'text-yellow-400' : i === 1 ? 'text-dark-300' : 'text-amber-700'}>{i + 1}.</span>
                  <span className="text-dark-400">{shortName(p.pilot)}</span>
                  <span className="text-green-400">{p.averageTime.toFixed(2)}с</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <SessionsTable sessions={compSessions} />
      </div>
    ) : null;

    const sectionMap: Record<string, ReactNode> = {
      leaguePoints: gonzalesResultsEl,
      kartManager: <div ref={kartManagerPortalRef} />,
      liveSession: liveSessionEl,
      sessions: sessionsEl,
      onboard: onboardEl,
    };

    return (
      <CompetitionLayoutWrapper sessionTimes={sessionTimes} competition={competition} scrubTime={scrubTime} setScrubTime={setScrubTime} allSessionsEnded={allSessionsEnded} setLiveEnabled={setLiveEnabled} groupCount={groupCount}>
        {sectionMap}
      </CompetitionLayoutWrapper>
    );
  }

  if (competition.format === 'light_league' || competition.format === 'champions_league' || competition.format === 'sprint') {
    const isScrubbing = scrubTime !== null;

    const leagueResultsEl = (
      <LeagueResults
        key="leaguePoints"
        format={competition.format}
        competitionId={competition.id}
        sessions={competition.sessions}
        sessionLaps={isScrubbing ? filteredSessionLaps : sessionLaps}
        liveSessionId={isScrubbing ? scrubSessionId : liveSessionId}
        livePhase={isScrubbing ? scrubActivePhase : undefined}
        livePositions={isScrubbing ? [] : livePositions}
        livePilots={isScrubbing ? scrubPilots : livePositions.map(p => p.pilot)}
        liveEnabled={!isScrubbing && liveEnabled}
        onToggleLive={() => { if (isScrubbing) { setScrubTime(null); setLiveEnabled(true); } else setLiveEnabled(v => !v); }}
        initialExcludedPilots={competition.results?.excludedPilots}
        initialEdits={competition.results?.edits}
        excludedLapKeys={competition.results?.excludedLaps}
        allSessionsEnded={allSessionsEnded}
        totalPilotsOverride={competition.results?.totalPilotsOverride ?? null}
        totalPilotsLocked={competition.results?.totalPilotsLocked ?? false}
        groupCountOverride={competition.results?.groupCountOverride ?? null}
        racePilotCount={competition.results?.racePilotCount ?? null}
        officialResultsUrl={competition.results?.officialResultsUrl}
        onPilotCount={onPilotCount}
        onAutoGroups={onAutoGroups}
        onSaveResults={saveResults}
      />
    );

    const liveSessionEl = (
      <LiveSessionTable
        key="liveSession"
        competition={competition}
        liveSessionId={isScrubbing ? scrubSessionId : liveSessionId}
        liveEntries={isScrubbing ? [] : liveEntries}
        liveTeams={isScrubbing ? [] : liveTeams}
        sessionLaps={isScrubbing ? filteredSessionLaps : sessionLaps}
        compSessions={compSessions}
        isScrubbing={isScrubbing}
        scrubTime={scrubTime}
        onEntriesUpdate={setOnboardEntries}
      />
    );

    const sessionsEl = compSessions.length > 0 ? (
      <div key="sessions" className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-dark-800">
          <h3 className="text-white font-semibold text-sm">Список заїздів ({compSessions.length})</h3>
        </div>
        <SessionsTable sessions={compSessions} />
      </div>
    ) : null;

    const sectionMap: Record<string, ReactNode> = {
      leaguePoints: leagueResultsEl,
      liveSession: liveSessionEl,
      sessions: sessionsEl,
      onboard: onboardEl,
    };

    return (
      <CompetitionLayoutWrapper sessionTimes={sessionTimes} competition={competition} scrubTime={scrubTime} setScrubTime={setScrubTime} allSessionsEnded={allSessionsEnded} setLiveEnabled={setLiveEnabled} groupCount={groupCount}>
        {sectionMap}
      </CompetitionLayoutWrapper>
    );
  }

  const phases = PHASE_CONFIGS[competition.format]?.phases || [];

  return (
    <div className="space-y-4">
      {competition.sessions.map(s => {
        const laps = sessionLaps.get(s.sessionId) || [];
        const phaseLabel = s.phase ? getPhaseLabel(competition.format, s.phase, groupCount) : 'Невизначений етап';
        const pilotBest = new Map<string, { pilot: string; kart: number; bestTime: number; bestTimeStr: string }>();
        for (const l of laps) {
          if (!l.lap_time) continue;
          const sec = parseFloat(l.lap_time.includes(':')
            ? String(parseInt(l.lap_time) * 60 + parseFloat(l.lap_time.split(':')[1]))
            : l.lap_time);
          if (isNaN(sec) || sec < 38) continue;
          const cur = pilotBest.get(l.pilot);
          if (!cur || sec < cur.bestTime) pilotBest.set(l.pilot, { pilot: l.pilot, kart: l.kart, bestTime: sec, bestTimeStr: l.lap_time });
        }
        const sorted = [...pilotBest.values()].sort((a, b) => a.bestTime - b.bestTime);

        return (
          <div key={s.sessionId} className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800 flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">{phaseLabel}</h3>
              <span className="text-dark-500 text-[10px]">{laps.length} кіл · {pilotBest.size} пілотів</span>
            </div>
            {sorted.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="table-header">
                    <th className="table-cell text-center w-8">#</th>
                    <th className="table-cell text-left">Пілот</th>
                    <th className="table-cell text-center">Карт</th>
                    <th className="table-cell text-right">Найкращий час</th>
                  </tr></thead>
                  <tbody>
                    {sorted.map((p, i) => (
                      <tr key={p.pilot} className="table-row">
                        <td className="table-cell text-center font-mono text-white font-bold">{i + 1}</td>
                        <td className="table-cell text-left text-white">{p.pilot}</td>
                        <td className={`table-cell text-center font-mono ${KART_COLOR}`}>{p.kart}</td>
                        <td className={`table-cell text-right font-mono font-semibold ${i === 0 ? 'text-purple-400' : 'text-green-400'}`}>
                          {toSeconds(p.bestTimeStr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-4 text-dark-600 text-sm">Немає даних</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

