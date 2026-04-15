import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, getPhaseLabel, getPhasesForFormat, splitIntoGroups, splitIntoGroupsSprint, getGonzalesGroupCount, getGonzalesRoundCount, buildGonzalesRotation, getGonzalesKartForRound } from '../../data/competitions';
import { toSeconds, isValidSession, KART_COLOR } from '../../utils/timing';
import { useAuth } from '../../services/auth';
import { TRACK_CONFIGS, trackDisplayId, isReverseTrack, baseTrackId } from '../../data/tracks';
import SessionsTable, { type SessionTableRow } from '../../components/Sessions/SessionsTable';
import LeagueResults from '../../components/Results/LeagueResults';
import GonzalesResults from '../../components/Results/GonzalesResults';
import CompetitionTimeline from '../../components/Results/CompetitionTimeline';
import { parseLapSec, getSprintPositionPoints } from '../../utils/scoring';
import { useLayoutPrefs, PAGE_SECTIONS } from '../../services/layoutPrefs';
import TableLayoutBar from '../../components/TableLayoutBar';
import SessionReplay, { parseSessionEvents } from '../../components/Timing/SessionReplay';
import { buildReplayLaps, extractCompetitionReplayProps } from '../../utils/session';

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

interface Competition {
  id: string;
  name: string;
  format: string;
  date: string;
  status: string;
  sessions: { sessionId: string; phase: string | null }[];
  results: any;
  uploaded_results: any;
}

interface SessionLap {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  position: number | null;
  ts: number;
}

export default function CompetitionPage() {
  const { type, eventId } = useParams<{ type: string; eventId?: string }>();
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

  const fetchCompSessions = async (sessions: { sessionId: string; phase: string | null }[]) => {
    const dates = new Set<string>();
    for (const s of sessions) {
      const m = s.sessionId.match(/session-(\d+)/);
      if (m) { const d = new Date(parseInt(m[1])); dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
    }
    const sessionIds = new Set(sessions.map(s => s.sessionId));
    const all: SessionTableRow[] = [];
    for (const date of dates) {
      try {
        const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`);
        if (res.ok) {
          const data: SessionTableRow[] = await res.json();
          all.push(...data.filter(s => sessionIds.has(s.id)));
        }
      } catch {}
    }
    setCompSessions(all);
    if (all.length > 0 && all.every(s => s.end_time !== null && s.end_time !== undefined)) {
      setAllSessionsEnded(true);
    }
  };

  useEffect(() => {
    if (eventId) {
      fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(eventId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          setCompetition(data);
          if (data?.sessions?.length > 0) fetchCompSessions(data.sessions);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else if (type) {
      fetch(`${COLLECTOR_URL}/competitions?format=${type}`)
        .then(r => r.json())
        .then(data => { setCompetitions(data); setLoading(false); })
        .catch(() => setLoading(false));
    } else {
      fetch(`${COLLECTOR_URL}/competitions`)
        .then(r => r.json())
        .then(data => { setCompetitions(data); setLoading(false); })
        .catch(() => setLoading(false));
    }
  }, [type, eventId]);

  const toggleStatus = async () => {
    if (!competition) return;
    const newStatus = competition.status === 'live' ? 'finished' : 'live';
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setCompetition(await res.json());
    } catch {}
  };

  if (loading) return <div className="card text-center py-12 text-dark-500">Завантаження...</div>;

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

  const changeTrack = async (newTrackId: number) => {
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`);
      if (!res.ok) return;
      const comp = await res.json();
      const currentResults = comp.results || {};
      
      // Update competition results with new trackId
      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ results: { ...currentResults, trackId: newTrackId } }),
      });
      
      // Update track_id for all sessions in this competition
      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}/update-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ trackId: newTrackId }),
      });
      
      setCompetition({ ...competition, results: { ...competition.results, trackId: newTrackId } });
    } catch {}
  };

  const groupCount = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? autoGroups;
  const gonzalesRoundCount = competition.format === 'gonzales' ? (competition.results?.gonzalesRoundCount ?? null) : null;
  const effectivePhases = getPhasesForFormat(competition.format, groupCount, gonzalesRoundCount);
  const totalPhases = effectivePhases.length;
  const linkedPhases = competition.sessions.filter(s => s.phase).length;
  const allPhasesLinked = totalPhases > 0 && linkedPhases >= totalPhases;

  return (
    <div className="space-y-4">
      {(competition.format === 'gonzales' || competition.format === 'light_league' || competition.format === 'champions_league' || competition.format === 'sprint') && (
        <TableLayoutBar pageId="competition" sections={[
          ...PAGE_SECTIONS.competition.filter(s => s.id !== 'kartManager' || competition.format === 'gonzales'),
          { id: 'editLog', label: 'Журнал змін' },
        ]} disabledSections={isOwner ? undefined : new Set(['kartManager', 'editLog'])} />
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">{getCompetitionDisplayName(competition).replace(/,?\s*Траса\s*\d+R?/, '')}</h1>
            <div className="flex items-center gap-1 border border-dark-700 rounded px-2 py-1">
              <svg className="w-3.5 h-3.5 text-dark-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              <select
                value={trackId ?? ''}
                onChange={e => { if (!canManage) return; const v = parseInt(e.target.value); if (!isNaN(v)) changeTrack(v); }}
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
                maxGroups={competition.format === 'champions_league' ? 2 : competition.format === 'gonzales' ? 2 : 3}
                canManage={canManage}
                onSave={async (partial) => {
                  try {
                    const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`);
                    if (!res.ok) return;
                    const comp = await res.json();
                    const currentResults = comp.results || {};
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
                        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
                        try {
                          const sessRes = await fetch(`${COLLECTOR_URL}/db/sessions?date=${dateStr}`);
                          if (sessRes.ok) {
                            const daySessions: { id: string; start_time: number; end_time: number | null; competition_id?: string | null }[] = await sessRes.json();
                            const linkedIds = new Set(reassigned.map(s => s.sessionId));
                            const available = daySessions
                              .filter(s => s.end_time && isValidSession(s) && (!s.competition_id || s.competition_id === competition.id) && !linkedIds.has(s.id))
                              .filter(s => s.start_time > lastTs)
                              .sort((a, b) => a.start_time - b.start_time);

                            for (let i = filledRounds; i < roundPhases.length && (i - filledRounds) < available.length; i++) {
                              reassigned.push({ sessionId: available[i - filledRounds].id, phase: roundPhases[i].id });
                            }
                          }
                        } catch {}
                      }

                      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
                        body: JSON.stringify({ results: newResults, sessions: reassigned }),
                      });
                      setCompetition(prev => prev ? { ...prev, results: newResults, sessions: reassigned } : prev);
                      if (reassigned.length > currentSessions.length) fetchCompSessions(reassigned);
                    } else {
                      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
                        body: JSON.stringify({ results: newResults }),
                      });
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
            </div>
          )}
        </div>
      </div>

      <LiveResults competition={competition} allSessionsEnded={allSessionsEnded && allPhasesLinked} compSessions={compSessions} onPilotCount={setPilotCount} onAutoGroups={setAutoGroups} />
    </div>
  );
}

function LiveResults({ competition: initialCompetition, allSessionsEnded, compSessions, onPilotCount, onAutoGroups }: { competition: Competition; allSessionsEnded: boolean; compSessions: SessionTableRow[]; onPilotCount: (n: number) => void; onAutoGroups: (n: number) => void }) {
  const { isOwner } = useAuth();
  const { isSectionVisible } = useLayoutPrefs();
  const [competition, setCompetition] = useState(initialCompetition);
  const [sessionLaps, setSessionLaps] = useState<Map<string, SessionLap[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<{ pilot: string; position: number }[]>([]);
  const [liveEntries, setLiveEntries] = useState<any[]>([]);
  const [liveTeams, setLiveTeams] = useState<any[]>([]);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const resultsRef = useRef(competition.results);
  useEffect(() => { resultsRef.current = competition.results; }, [competition.results]);
  const saveLockRef = useRef<Promise<void>>(Promise.resolve());

  const saveResults = useCallback(async (partial: Record<string, any>) => {
    saveLockRef.current = saveLockRef.current.then(async () => {
      try {
        const currentResults = resultsRef.current || {};
        const merged = { ...currentResults, ...partial };
        await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
          body: JSON.stringify({ results: merged }),
        });
        resultsRef.current = merged;
        setCompetition(prev => prev ? { ...prev, results: merged } : prev);
      } catch {}
    });
    return saveLockRef.current;
  }, [competition.id]);

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
        const res = await fetch(`${COLLECTOR_URL}/db/laps?session=${s.sessionId}`);
        if (res.ok) map.set(s.sessionId, await res.json());
      } catch {}
    }
    return map;
  };

  useEffect(() => {
    let cancelled = false;
    fetchAllLaps(initialCompetition).then(map => {
      if (!cancelled) { setSessionLaps(map); setLoading(false); }
    });

    if (initialCompetition.status !== 'live') return () => { cancelled = true; };

    const slowTimer = setInterval(async () => {
      if (!liveEnabled) return;
      try {
        const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(initialCompetition.id)}`);
        if (!res.ok || cancelled) return;
        const fresh: Competition = await res.json();
        if (typeof fresh.sessions === 'string') fresh.sessions = JSON.parse(fresh.sessions);
        if (typeof fresh.results === 'string') fresh.results = JSON.parse(fresh.results);
        setCompetition(fresh);
        const map = await fetchAllLaps(fresh);
        if (!cancelled) setSessionLaps(map);
      } catch {}
    }, 3000);

    const fastTimer = setInterval(async () => {
      if (!liveEnabled) return;
      try {
        const [statusRes, timingRes] = await Promise.all([
          fetch(`${COLLECTOR_URL}/status`).then(r => r.json()),
          fetch(`${COLLECTOR_URL}/timing`).then(r => r.json()),
        ]);
        if (cancelled) return;
        setLiveSessionId(statusRes.sessionId || null);
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

  if (loading) return <div className="card text-center py-6 text-dark-500">Завантаження даних...</div>;
  if (competition.sessions.length === 0) return <div className="card text-center py-12 text-dark-500">Немає прив'язаних заїздів</div>;

  const groupCount = competition.results?.groupCountOverride ?? competition.results?.autoDetectedGroups ?? 1;

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

    const sectionMap: Record<string, React.ReactNode> = {
      leaguePoints: gonzalesResultsEl,
      liveSession: liveSessionEl,
      sessions: sessionsEl,
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

    const sectionMap: Record<string, React.ReactNode> = {
      leaguePoints: leagueResultsEl,
      liveSession: liveSessionEl,
      sessions: sessionsEl,
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

function CompetitionLayoutWrapper({ sessionTimes, competition, scrubTime, setScrubTime, allSessionsEnded, setLiveEnabled, groupCount, children }: {
  sessionTimes: { sessionId: string; phase: string | null; startTime: number; endTime: number | null }[];
  competition: Competition;
  scrubTime: number | null;
  setScrubTime: (t: number | null) => void;
  allSessionsEnded: boolean;
  setLiveEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  groupCount?: number;
  children: Record<string, ReactNode>;
}) {
  const { isSectionVisible, getPageLayout } = useLayoutPrefs();

  const layout = getPageLayout('competition');

  const renderSection = (sectionId: string) => {
    if (!isSectionVisible('competition', sectionId)) return null;
    if (sectionId === 'timeline') {
      if (sessionTimes.length === 0) return null;
      return (
        <CompetitionTimeline
          key="timeline"
          format={competition.format}
          groupCount={groupCount}
          sessions={competition.sessions}
          sessionTimes={sessionTimes}
          currentTime={scrubTime}
          onTimeChange={(t) => { setScrubTime(t); if (t !== null) setLiveEnabled(false); else setLiveEnabled(true); }}
          isLive={competition.status === 'live' && !allSessionsEnded}
        />
      );
    }
    if (children[sectionId] !== undefined) return children[sectionId];
    return null;
  };

  return (
    <div className="space-y-4">
      {layout.map(s => renderSection(s.id))}
    </div>
  );
}

function CompetitionParams({ pilotCount, pilotOverride, pilotLocked, groupOverride, autoGroups, maxGroups, canManage, onSave }: {
  pilotCount: number; pilotOverride: number | null; pilotLocked: boolean;
  groupOverride: number | null; autoGroups: number; maxGroups: number; canManage: boolean;
  onSave: (partial: Record<string, any>) => Promise<void>;
}) {
  const effectivePilots = (pilotLocked && pilotOverride !== null) ? pilotOverride : pilotCount;
  const effectiveGroups = groupOverride ?? autoGroups;
  const pilotsAuto = pilotOverride === null;
  const groupsAuto = groupOverride === null;

  const [pilotDraft, setPilotDraft] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<string | null>(null);

  const commitPilots = () => {
    if (pilotDraft === null) return;
    const v = parseInt(pilotDraft);
    if (!isNaN(v) && v > 0) onSave({ totalPilotsOverride: v, totalPilotsLocked: true });
    setPilotDraft(null);
  };
  const commitGroups = () => {
    if (groupDraft === null) return;
    const v = parseInt(groupDraft);
    if (!isNaN(v) && v > 0 && v <= maxGroups) onSave({ groupCountOverride: v });
    setGroupDraft(null);
  };

  return (
    <div className="flex items-center gap-3 text-xs">
      {/* Pilots */}
      <div className="border border-dark-700 rounded px-2 py-1 flex items-center gap-1">
        <span title="Пілоти">👥</span>
        {canManage ? (
          <input type="text" inputMode="numeric"
            value={pilotDraft !== null ? pilotDraft : effectivePilots}
            onChange={e => setPilotDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitPilots(); }}
            onBlur={commitPilots}
            disabled={pilotsAuto}
            className={`w-8 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${pilotsAuto ? 'text-dark-500 cursor-default' : 'text-dark-300'}`} />
        ) : (
          <span className="text-dark-300 font-mono">{effectivePilots || '—'}</span>
        )}
        {canManage && (
          <button onClick={() => onSave({ totalPilotsOverride: pilotsAuto ? effectivePilots : null, totalPilotsLocked: pilotsAuto })} 
            className={`text-[10px] font-bold transition-colors ${pilotsAuto ? 'bg-red-600 text-white px-1 rounded' : 'text-dark-500 hover:text-dark-300'}`}
            title={pilotsAuto ? 'Вимкнути авто' : 'Включити авто'}>
            А
          </button>
        )}
      </div>

      {/* Groups */}
      <div className="border border-dark-700 rounded px-2 py-1 flex items-center gap-1">
        <span title="Групи">🔢</span>
        {canManage ? (
          <input type="text" inputMode="numeric"
            value={groupDraft !== null ? groupDraft : effectiveGroups}
            onChange={e => setGroupDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitGroups(); }}
            onBlur={commitGroups}
            disabled={groupsAuto}
            className={`w-8 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${groupsAuto ? 'text-dark-500 cursor-default' : 'text-dark-300'}`} />
        ) : (
          <span className="text-dark-300 font-mono">{effectiveGroups}</span>
        )}
        {canManage && (
          <button onClick={() => onSave({ groupCountOverride: groupsAuto ? effectiveGroups : null })} 
            className={`text-[10px] font-bold transition-colors ${groupsAuto ? 'bg-red-600 text-white px-1 rounded' : 'text-dark-500 hover:text-dark-300'}`}
            title={groupsAuto ? 'Вимкнути авто' : 'Включити авто'}>
            А
          </button>
        )}
      </div>
    </div>
  );
}

const FORMAT_FILTERS: { key: string; label: string }[] = [
  { key: 'gonzales', label: 'Гонзалес' },
  { key: 'light_league', label: 'ЛЛ' },
  { key: 'champions_league', label: 'ЛЧ' },
  { key: 'sprint', label: 'Спринти' },
  { key: 'marathon', label: 'Марафони' },
];

const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function getCompRealDate(c: Competition): string {
  if (c.sessions.length > 0) {
    const m = c.sessions[0].sessionId.match(/session-(\d+)/);
    if (m) {
      const d = new Date(parseInt(m[1]));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  return c.date || '';
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function getWeekDays(monday: Date): string[] {
  const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }).filter(d => d <= todayStr);
}

const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

function getWeeksInMonth(year: number, month: number): string[][] {
  const todayStr = localDateStr(new Date());
  const firstDay = new Date(year, month, 1);
  const monday = getMonday(firstDay);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const weekStart = new Date(monday);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const days = getWeekDays(weekStart).filter(d => {
      const dd = new Date(d + 'T00:00:00');
      return dd.getMonth() === month && d <= todayStr;
    });
    if (days.length > 0) weeks.push(days);
  }
  return weeks;
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadWithExpiry(storage: Storage, key: string): any {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const { value, expiresAt } = JSON.parse(raw);
    if (expiresAt && Date.now() > expiresAt) { storage.removeItem(key); return null; }
    return value;
  } catch { return null; }
}

function saveWithExpiry(storage: Storage, key: string, value: any) {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  try { storage.setItem(key, JSON.stringify({ value, expiresAt: endOfDay.getTime() })); } catch {}
}

function CompetitionList({ competitions: initialCompetitions, initialFilter }: { competitions: Competition[]; initialFilter?: string }) {
  const { user } = useAuth();
  const storage = user ? localStorage : sessionStorage;
  const [competitions, setCompetitions] = useState(initialCompetitions);

  useEffect(() => { setCompetitions(initialCompetitions); }, [initialCompetitions]);

  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => {
    if (initialFilter) return new Set([initialFilter]);
    const saved = loadWithExpiry(storage, 'karting_comp_filters');
    if (Array.isArray(saved) && saved.length > 0) return new Set(saved);
    return new Set(FORMAT_FILTERS.map(f => f.key));
  });

  const [sortDir, setSortDir] = useState<'desc' | 'asc'>(() => {
    const saved = loadWithExpiry(storage, 'karting_comp_sort');
    return saved === 'asc' ? 'asc' : 'desc';
  });

  const compDates = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of competitions) map.set(c.id, getCompRealDate(c));
    return map;
  }, [competitions]);

  const dateCompNames = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of competitions) {
      const d = compDates.get(c.id) || '';
      if (!d) continue;
      const cfg = COMPETITION_CONFIGS[c.format as keyof typeof COMPETITION_CONFIGS];
      const name = cfg?.shortName || c.format;
      if (!map[d]) map[d] = [];
      if (!map[d].includes(name)) map[d].push(name);
    }
    return map;
  }, [competitions, compDates]);

  const allCompDates = useMemo(() => [...new Set(competitions.map(c => compDates.get(c.id) || '').filter(Boolean))].sort().reverse(), [competitions, compDates]);

  const thisMonday = getMonday(new Date());
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const thisWeekDays = getWeekDays(thisMonday);
  const prevWeekDays = getWeekDays(prevMonday);
  const todayStr = localDateStr(new Date());

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => {
    const saved = loadWithExpiry(storage, 'karting_comp_dates');
    if (Array.isArray(saved) && saved.length > 0) return new Set(saved);
    const withData = thisWeekDays.filter(d => dateCompNames[d]);
    return new Set(withData.length > 0 ? withData : []);
  });

  useEffect(() => {
    if (selectedDates.size === 0 && allCompDates.length > 0) {
      const withData = thisWeekDays.filter(d => dateCompNames[d]);
      if (withData.length > 0) setSelectedDates(new Set(withData));
    }
  }, [dateCompNames]);

  const saveDates = (dates: Set<string>) => saveWithExpiry(storage, 'karting_comp_dates', [...dates]);
  const toggleDate = (d: string) => {
    setSelectedDates(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); saveDates(n); return n; });
  };
  const selectDates = (dates: string[]) => {
    setSelectedDates(prev => { const n = new Set(prev); dates.forEach(d => n.add(d)); saveDates(n); return n; });
  };

  const [prevWeekOpen, setPrevWeekOpen] = useState(() => [...selectedDates].some(d => new Set(prevWeekDays).has(d)));
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const saveFilters = (filters: Set<string>) => saveWithExpiry(storage, 'karting_comp_filters', [...filters]);
  const toggleFilter = (key: string) => {
    setActiveFilters(prev => {
      const n = new Set(prev);
      if (n.has(key)) { n.delete(key); if (n.size === 0) { saveFilters(new Set(FORMAT_FILTERS.map(f => f.key))); return new Set(FORMAT_FILTERS.map(f => f.key)); } }
      else n.add(key);
      saveFilters(n); return n;
    });
  };
  const allActive = activeFilters.size === FORMAT_FILTERS.length;
  const toggleAll = () => { const all = new Set(FORMAT_FILTERS.map(f => f.key)); setActiveFilters(all); saveFilters(all); };
  const toggleSort = () => { const next = sortDir === 'desc' ? 'asc' : 'desc'; setSortDir(next); saveWithExpiry(storage, 'karting_comp_sort', next); };

  const filtered = competitions
    .filter(c => activeFilters.has(c.format))
    .filter(c => selectedDates.size === 0 || selectedDates.has(compDates.get(c.id) || ''))
    .sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (a.status !== 'live' && b.status === 'live') return 1;
      const cmp = (compDates.get(a.id) || '').localeCompare(compDates.get(b.id) || '');
      return sortDir === 'desc' ? -cmp : cmp;
    });

  const DateBtn = ({ d }: { d: string }) => {
    const isToday = d === todayStr;
    const names = dateCompNames[d] || [];
    const hasData = names.length > 0;
    const isActive = selectedDates.has(d);
    const dayDate = new Date(d + 'T00:00:00');
    const label = `${DAY_NAMES[dayDate.getDay()]} ${String(dayDate.getDate()).padStart(2, '0')}.${String(dayDate.getMonth() + 1).padStart(2, '0')}`;
    return (
      <button
        onClick={() => hasData && toggleDate(d)}
        className={`flex flex-col items-center px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
          isActive ? 'bg-primary-600 text-white ring-1 ring-primary-400' :
          isToday ? 'bg-green-600/20 text-green-400' :
          hasData ? 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700' :
          'bg-dark-900 text-dark-700 cursor-default'
        }`}
      >
        <span>{label}</span>
        <span className={`text-[9px] ${isActive ? 'text-white/70' : 'text-dark-500'}`}>{hasData ? names.join(', ') : '–'}</span>
      </button>
    );
  };

  const SelectAllBtn = ({ dates }: { dates: string[] }) => {
    const withData = dates.filter(d => dateCompNames[d]);
    const notSelected = withData.filter(d => !selectedDates.has(d));
    if (notSelected.length === 0) return null;
    return (
      <button onClick={(e) => { e.stopPropagation(); selectDates(withData); }}
        className="bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 text-[11px] font-bold rounded px-1.5 py-0.5 transition-colors ml-1.5 leading-none">
        +{notSelected.length}
      </button>
    );
  };

  const yearMonths = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const d of allCompDates) {
      const thisSet = new Set(thisWeekDays);
      const prevSet = new Set(prevWeekDays);
      if (thisSet.has(d) || prevSet.has(d)) continue;
      const y = d.slice(0, 4);
      const m = parseInt(d.slice(5, 7)) - 1;
      if (!map.has(y)) map.set(y, new Set());
      map.get(y)!.add(m);
    }
    return map;
  }, [allCompDates]);

  const thisWeekWithData = thisWeekDays.filter(d => dateCompNames[d]);
  const prevWeekWithData = prevWeekDays.filter(d => dateCompNames[d]);

  return (
    <div className="space-y-4">
      <div className="card p-3 space-y-3">
        <div>
          <div className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center">
            Цей тиждень
            <SelectAllBtn dates={thisWeekDays} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {thisWeekDays.map(d => <DateBtn key={d} d={d} />)}
          </div>
        </div>
        {prevWeekDays.length > 0 && (
          <div>
            <button onClick={() => setPrevWeekOpen(v => !v)}
              className="flex items-center gap-1.5 text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5 hover:text-dark-300 transition-colors">
              <span className={`transition-transform text-[8px] ${prevWeekOpen ? 'rotate-90' : ''}`}>&#9654;</span>
              Попередній тиждень
              <SelectAllBtn dates={prevWeekDays} />
            </button>
            {prevWeekOpen && (
              <div className="flex flex-wrap gap-1.5">
                {prevWeekDays.map(d => <DateBtn key={d} d={d} />)}
              </div>
            )}
          </div>
        )}
        {[...yearMonths.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => {
          const yearDates = allCompDates.filter(d => d.startsWith(year) && !new Set(thisWeekDays).has(d) && !new Set(prevWeekDays).has(d));
          return (
            <div key={year}>
              <button onClick={() => { const n = new Set(expandedYears); n.has(year) ? n.delete(year) : n.add(year); setExpandedYears(n); }}
                className="flex items-center gap-1.5 text-dark-300 hover:text-white text-xs font-medium transition-colors">
                <span className={`text-[10px] transition-transform ${expandedYears.has(year) ? 'rotate-90' : ''}`}>&#9654;</span>
                {year}
                <SelectAllBtn dates={yearDates} />
              </button>
              {expandedYears.has(year) && (
                <div className="ml-4 mt-1 space-y-2">
                  {[...months].sort((a, b) => b - a).map(month => {
                    const monthKey = `${year}-${month}`;
                    const weeks = getWeeksInMonth(parseInt(year), month);
                    const monthDates = yearDates.filter(d => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
                    return (
                      <div key={monthKey}>
                        <button onClick={() => { const n = new Set(expandedMonths); n.has(monthKey) ? n.delete(monthKey) : n.add(monthKey); setExpandedMonths(n); }}
                          className="flex items-center gap-1.5 text-dark-400 hover:text-white text-xs transition-colors">
                          <span className={`text-[8px] transition-transform ${expandedMonths.has(monthKey) ? 'rotate-90' : ''}`}>&#9654;</span>
                          {MONTH_NAMES[month]}
                          <SelectAllBtn dates={monthDates} />
                        </button>
                        {expandedMonths.has(monthKey) && (
                          <div className="ml-3 mt-1 space-y-1">
                            {weeks.map((weekDays, wi) => (
                              <div key={wi} className="flex flex-wrap gap-1.5">
                                {weekDays.map(d => <DateBtn key={d} d={d} />)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-1 flex-wrap items-center">
        <button onClick={toggleAll}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${allActive ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>
          Все
        </button>
        {FORMAT_FILTERS.map(f => (
          <button key={f.key} onClick={() => toggleFilter(f.key)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${activeFilters.has(f.key) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600 hover:text-dark-400'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={toggleSort}
          className="px-2 py-1 rounded text-xs font-medium bg-dark-800 text-dark-500 hover:text-dark-300 transition-colors ml-1">
          Дата {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="card text-center py-12 text-dark-500">Немає змагань</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <CompetitionListItem key={c.id} competition={c} type={c.format} onDelete={(id) => setCompetitions(prev => prev.filter(x => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveSessionTable({ competition, liveSessionId, liveEntries, liveTeams, sessionLaps, compSessions, isScrubbing }: {
  competition: Competition;
  liveSessionId: string | null;
  liveEntries: any[];
  liveTeams: any[];
  sessionLaps: Map<string, SessionLap[]>;
  compSessions: SessionTableRow[];
  isScrubbing: boolean;
}) {
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
    const s = competition.sessions.find(cs => cs.sessionId === liveSessionId);
    return s?.phase ?? null;
  }, [competition.sessions, liveSessionId]);

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
        const res = await fetch(`${COLLECTOR_URL}/db/events?session=${liveSessionId}`);
        if (res.ok && !cancelled) setEvents(await res.json());
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
    const cs = compSessions.find(s => s.id === liveSessionId);
    const endTime = cs?.end_time ?? Date.now();
    return Math.max(0, (endTime - sessionStartTime) / 1000);
  }, [sessionStartTime, liveSessionId, compSessions, laps]);

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
    const qualiSessions = competition.sessions.filter(s => s.phase?.startsWith(qualiPhasePrefix));
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
    const maxQualified = isCL ? 24 : 36;
    const qualifiedPilots = qualiSorted.slice(0, maxQualified).map(([p]) => p);

    if (isSprint) {
      if (finalMatch) {
        const qualiSessions1 = competition.sessions.filter(s => s.phase?.startsWith('qualifying_1_'));
        const qualiSessions2 = competition.sessions.filter(s => s.phase?.startsWith('qualifying_2_'));
        const raceSessions1 = competition.sessions.filter(s => s.phase?.startsWith('race_1_'));
        const raceSessions2 = competition.sessions.filter(s => s.phase?.startsWith('race_2_'));

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
          for (const rs of sessions) {
            const gMatch = rs.phase?.match(/group_(\d+)/);
            const gNum = gMatch ? parseInt(gMatch[1]) : 0;
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
            pilots.sort((a, b) => {
              if (a.lapCount !== b.lapCount) return b.lapCount - a.lapCount;
              if (a.lastPos !== b.lastPos) return a.lastPos - b.lastPos;
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
      const rSessions = competition.sessions.filter(s => s.phase?.startsWith(`race_${r}_`));
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
  }, [competition, effectiveLaps, currentPhase, excludedPilots, isCL]);

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

  if (!liveSessionId || (!isQualifying && !isRace) || !hasData || sessionEnded) {
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
      />
    </div>
  );
}


function getCompetitionDisplayName(c: Competition): string {
  let name = c.name.replace(/Тр\.\s*/g, 'Траса ');
  if (c.sessions.length > 0) {
    const firstSid = c.sessions[0].sessionId;
    const m = firstSid.match(/session-(\d+)/);
    if (m) {
      const d = new Date(parseInt(m[1]));
      const realDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
      name = name.replace(/\d{2}\.\d{2}\.\d{2}/, realDate);
    }
  }
  return name;
}

function CompetitionListItem({ competition: c, type, onDelete }: { competition: Competition; type: string; onDelete?: (id: string) => void }) {
  const { isOwner } = useAuth();
  const [confirming, setConfirming] = useState(false);
  let top3: { pilot: string; totalPoints: number }[] = [];
  try {
    const results = typeof c.results === 'string' ? JSON.parse(c.results) : (c.results || {});
    const pilots = results?.standings?.pilots;
    if (Array.isArray(pilots)) {
      top3 = pilots.slice(0, 3).map((p: any) => ({ pilot: p.pilot, totalPoints: p.totalPoints }));
    }
  } catch {}

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    try {
      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(c.id)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ADMIN_TOKEN}` },
      });
      onDelete?.(c.id);
    } catch {}
    setConfirming(false);
  };

  return (
    <Link to={`/results/${type}/${c.id}`}
      className="card p-4 block hover:bg-dark-700/50 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-white font-medium truncate">{getCompetitionDisplayName(c)}</div>
          {top3.length > 0 && (
            <div className="flex flex-col shrink-0">
              {top3.map((p, i) => (
                <span key={p.pilot} className="text-dark-400 text-[10px] leading-tight whitespace-nowrap">
                  {i + 1}. {p.pilot} — {p.totalPoints}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isOwner && (
            <button
              onClick={handleDelete}
              onBlur={() => setConfirming(false)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                confirming ? 'bg-red-600 text-white' : 'text-dark-600 hover:text-red-400'
              }`}
              title="Видалити змагання">
              {confirming ? 'Точно?' : '✕'}
            </button>
          )}
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
            c.status === 'finished' ? 'bg-dark-800 text-dark-400' : 'bg-green-500/15 text-green-400'
          }`}>
            {c.status === 'finished' ? 'Завершено' : 'Live'}
          </span>
        </div>
      </div>
    </Link>
  );
}
