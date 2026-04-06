import { useParams, Link, Navigate } from 'react-router-dom';
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, getPhaseLabel, getPhasesForFormat, splitIntoGroups } from '../../data/competitions';
import { toSeconds, isValidSession, shortName } from '../../utils/timing';
import { useAuth } from '../../services/auth';
import { TRACK_CONFIGS, trackDisplayId, isReverseTrack, baseTrackId } from '../../data/tracks';
import SessionsTable, { type SessionTableRow } from '../../components/Sessions/SessionsTable';
import LeagueResults from '../../components/Results/LeagueResults';
import CompetitionTimeline from '../../components/Results/CompetitionTimeline';
import { parseLapSec, getPositionPoints, calcOvertakePoints, type ScoringData } from '../../utils/scoring';
import { useLayoutPrefs, PAGE_SECTIONS } from '../../services/layoutPrefs';
import TableLayoutBar from '../../components/TableLayoutBar';

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

  const groupCount = competition.results?.groupCountOverride ?? null;
  const effectivePhases = getPhasesForFormat(competition.format, groupCount);
  const totalPhases = effectivePhases.length;
  const linkedPhases = competition.sessions.filter(s => s.phase).length;
  const allPhasesLinked = totalPhases > 0 && linkedPhases >= totalPhases;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">{getCompetitionDisplayName(competition).replace(/,?\s*Траса\s*\d+R?/, '')}</h1>
            <div className="flex items-center gap-1 border border-dark-700 rounded px-1.5 py-0.5">
              <svg className="w-3.5 h-3.5 text-dark-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
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
            {(competition.format === 'light_league' || competition.format === 'champions_league') && (
              <CompetitionParams
                pilotCount={pilotCount}
                pilotOverride={competition.results?.totalPilotsOverride ?? null}
                pilotLocked={competition.results?.totalPilotsLocked ?? false}
                groupOverride={competition.results?.groupCountOverride ?? null}
                autoGroups={autoGroups}
                maxGroups={competition.format === 'champions_league' ? 2 : 3}
                canManage={canManage}
                onSave={async (partial) => {
                  try {
                    const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`);
                    if (!res.ok) return;
                    const comp = await res.json();
                    const currentResults = comp.results || {};
                    await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
                      body: JSON.stringify({ results: { ...currentResults, ...partial } }),
                    });
                    setCompetition(prev => prev ? { ...prev, results: { ...prev.results, ...partial } } : prev);
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

      {isSectionVisible('competition', 'sessions') && compSessions.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-dark-800">
            <h3 className="text-white font-semibold text-sm">Список заїздів ({compSessions.length})</h3>
          </div>
          <SessionsTable sessions={compSessions} />
        </div>
      )}
    </div>
  );
}

function LiveResults({ competition: initialCompetition, allSessionsEnded, compSessions, onPilotCount, onAutoGroups }: { competition: Competition; allSessionsEnded: boolean; compSessions: SessionTableRow[]; onPilotCount: (n: number) => void; onAutoGroups: (n: number) => void }) {
  const { isOwner } = useAuth();
  const [competition, setCompetition] = useState(initialCompetition);
  const [sessionLaps, setSessionLaps] = useState<Map<string, SessionLap[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<{ pilot: string; position: number }[]>([]);
  const [liveEntries, setLiveEntries] = useState<any[]>([]);
  const [liveTeams, setLiveTeams] = useState<any[]>([]);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

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

  if (competition.format === 'gonzales') {
    return <GonzalesLiveTable competition={competition} sessionLaps={sessionLaps} />;
  }

  if (competition.format === 'light_league' || competition.format === 'champions_league') {
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
        onSaveResults={async (partial) => {
          try {
            const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`);
            if (!res.ok) return;
            const comp = await res.json();
            const currentResults = comp.results || {};
            await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
              body: JSON.stringify({ results: { ...currentResults, ...partial } }),
            });
            setCompetition(prev => prev ? { ...prev, results: { ...prev.results, ...partial } } : prev);
          } catch {}
        }}
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

    const sectionMap: Record<string, React.ReactNode> = {
      leaguePoints: leagueResultsEl,
      liveSession: liveSessionEl,
    };

    return (
      <CompetitionLayoutWrapper sessionTimes={sessionTimes} competition={competition} scrubTime={scrubTime} setScrubTime={setScrubTime} allSessionsEnded={allSessionsEnded} setLiveEnabled={setLiveEnabled} isOwner={isOwner}>
        {sectionMap}
      </CompetitionLayoutWrapper>
    );
  }

  const phases = PHASE_CONFIGS[competition.format]?.phases || [];

  return (
    <div className="space-y-4">
      {competition.sessions.map(s => {
        const laps = sessionLaps.get(s.sessionId) || [];
        const phaseLabel = s.phase ? getPhaseLabel(competition.format, s.phase) : 'Невизначений етап';
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
                        <td className="table-cell text-center font-mono text-dark-300">{p.kart}</td>
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

function CompetitionLayoutWrapper({ sessionTimes, competition, scrubTime, setScrubTime, allSessionsEnded, setLiveEnabled, isOwner, children }: {
  sessionTimes: { sessionId: string; phase: string | null; startTime: number; endTime: number | null }[];
  competition: Competition;
  scrubTime: number | null;
  setScrubTime: (t: number | null) => void;
  allSessionsEnded: boolean;
  setLiveEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  isOwner: boolean;
  children: Record<string, ReactNode>;
}) {
  const { isSectionVisible } = useLayoutPrefs();

  const sectionsForBar = [
    ...PAGE_SECTIONS.competition,
    ...(isOwner ? [{ id: 'editLog', label: 'Журнал змін' }] : []),
  ];

  return (
    <div className="space-y-4">
      <TableLayoutBar pageId="competition" sections={sectionsForBar} />
      {isSectionVisible('competition', 'timeline') && sessionTimes.length > 0 && (
        <CompetitionTimeline
          format={competition.format}
          sessions={competition.sessions}
          sessionTimes={sessionTimes}
          currentTime={scrubTime}
          onTimeChange={(t) => { setScrubTime(t); if (t !== null) setLiveEnabled(false); else setLiveEnabled(true); }}
          isLive={competition.status === 'live' && !allSessionsEnded}
        />
      )}
      {isSectionVisible('competition', 'liveSession') && (
        children['liveSession']
      )}
      {isSectionVisible('competition', 'leaguePoints') && (
        children['leaguePoints']
      )}
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

  return (
    <div className="flex items-center gap-3 text-xs">
      {/* Pilots */}
      <div className="border border-dark-700 rounded px-2 py-1 flex items-center gap-1">
        <span title="Пілоти">👥</span>
        {canManage ? (
          <input type="text" inputMode="numeric"
            value={effectivePilots}
            onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) onSave({ totalPilotsOverride: v, totalPilotsLocked: true }); }}
            disabled={pilotsAuto}
            className={`w-6 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${pilotsAuto ? 'text-dark-500 cursor-default' : 'text-dark-300'}`} />
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
            value={effectiveGroups}
            onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0 && v <= maxGroups) onSave({ groupCountOverride: v }); }}
            disabled={groupsAuto}
            className={`w-6 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${groupsAuto ? 'text-dark-500 cursor-default' : 'text-dark-300'}`} />
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

function GonzalesLiveTable({ competition, sessionLaps }: { competition: Competition; sessionLaps: Map<string, SessionLap[]> }) {
  const sessions = competition.sessions;
  const kartNumbers: number[] = [];
  for (const s of sessions) {
    const laps = sessionLaps.get(s.sessionId) || [];
    for (const l of laps) {
      if (!kartNumbers.includes(l.kart)) kartNumbers.push(l.kart);
    }
  }
  kartNumbers.sort((a, b) => a - b);

  // For each round (session), get each pilot's best of 2 laps on their kart
  // Build: pilot → kart → best lap time
  const pilotKartBest = new Map<string, Map<number, number>>();

  for (const s of sessions) {
    const laps = sessionLaps.get(s.sessionId) || [];
    // Group by pilot in this session
    const pilotLaps = new Map<string, SessionLap[]>();
    for (const l of laps) {
      if (!pilotLaps.has(l.pilot)) pilotLaps.set(l.pilot, []);
      pilotLaps.get(l.pilot)!.push(l);
    }
    for (const [pilot, pLaps] of pilotLaps) {
      if (!pilotKartBest.has(pilot)) pilotKartBest.set(pilot, new Map());
      const kartMap = pilotKartBest.get(pilot)!;
      const kart = pLaps[0].kart;
      let best = Infinity;
      for (const l of pLaps) {
        const sec = parseLapSec(l.lap_time);
        if (sec !== null && sec >= 38 && sec < best) best = sec;
      }
      if (best < Infinity) {
        const existing = kartMap.get(kart);
        if (!existing || best < existing) kartMap.set(kart, best);
      }
    }
  }

  // Build rows
  const rows: { pilot: string; kartTimes: (number | null)[]; average: number | null; completedKarts: number }[] = [];
  for (const [pilot, kartMap] of pilotKartBest) {
    const kartTimes = kartNumbers.map(k => kartMap.get(k) ?? null);
    const validTimes = kartTimes.filter((t): t is number => t !== null);
    const average = validTimes.length > 0 ? validTimes.reduce((a, b) => a + b, 0) / validTimes.length : null;
    rows.push({ pilot, kartTimes, average, completedKarts: validTimes.length });
  }

  rows.sort((a, b) => {
    if (a.average === null && b.average === null) return 0;
    if (a.average === null) return 1;
    if (b.average === null) return -1;
    return a.average - b.average;
  });

  const overallBestPerKart = kartNumbers.map((_, ki) => {
    let best = Infinity;
    for (const r of rows) { const t = r.kartTimes[ki]; if (t !== null && t < best) best = t; }
    return best < Infinity ? best : null;
  });

  if (rows.length === 0) return <div className="card text-center py-12 text-dark-500">Немає даних</div>;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-dark-800">
        <h3 className="text-white font-semibold text-sm">Гонзалес — Зведена таблиця</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-6">#</th>
              <th className="table-cell text-left min-w-[100px]">Пілот</th>
              {kartNumbers.map(k => (
                <th key={k} className="table-cell text-center min-w-[60px]">Карт {k}</th>
              ))}
              <th className="table-cell text-center min-w-[70px] font-bold">Середнє</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.pilot} className="table-row">
                <td className="table-cell text-center font-mono text-white font-bold">{i + 1}</td>
                <td className="table-cell text-left text-white">{r.pilot}</td>
                {r.kartTimes.map((t, ki) => {
                  if (t === null) return <td key={ki} className="table-cell text-center text-dark-700">—</td>;
                  const isBestOnKart = overallBestPerKart[ki] !== null && Math.abs(t - overallBestPerKart[ki]!) < 0.002;
                  return (
                    <td key={ki} className={`table-cell text-center font-mono ${isBestOnKart ? 'text-purple-400 font-bold' : 'text-dark-300'}`}>
                      {t.toFixed(3)}
                    </td>
                  );
                })}
                <td className={`table-cell text-center font-mono font-bold ${i === 0 && r.average !== null ? 'text-purple-400' : 'text-green-400'}`}>
                  {r.average !== null ? r.average.toFixed(3) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

function CompetitionList({ competitions, initialFilter }: { competitions: Competition[]; initialFilter?: string }) {
  const { user } = useAuth();
  const storage = user ? localStorage : sessionStorage;

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
            <CompetitionListItem key={c.id} competition={c} type={c.format} />
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
  const [scoring, setScoring] = useState<ScoringData | null>(null);
  useEffect(() => {
    fetch(`${COLLECTOR_URL}/scoring`).then(r => r.ok ? r.json() : fetch('/data/scoring.json').then(r2 => r2.json())).then(setScoring).catch(() => {
      fetch('/data/scoring.json').then(r => r.json()).then(setScoring).catch(() => {});
    });
  }, []);

  const currentPhase = useMemo(() => {
    if (!liveSessionId) return null;
    const s = competition.sessions.find(cs => cs.sessionId === liveSessionId);
    return s?.phase ?? null;
  }, [competition.sessions, liveSessionId]);

  const isQualifying = currentPhase?.startsWith('qualifying') ?? false;
  const isRace = currentPhase?.startsWith('race_') ?? false;

  const sessionEnded = useMemo(() => {
    if (!liveSessionId || isScrubbing) return false;
    const cs = compSessions.find(s => s.id === liveSessionId);
    return cs ? cs.end_time !== null && cs.end_time !== undefined : false;
  }, [liveSessionId, compSessions, isScrubbing]);

  const laps = liveSessionId ? (sessionLaps.get(liveSessionId) || []) : [];
  const hasData = laps.length > 0 || liveEntries.length > 0;

  if (!liveSessionId || (!isQualifying && !isRace) || !hasData || sessionEnded) {
    return (
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-dark-800">
          <h3 className="text-dark-500 font-semibold text-sm">Немає активного заїзду</h3>
        </div>
      </div>
    );
  }

  const phaseLabel = currentPhase ? getPhaseLabel(competition.format, currentPhase) : '';

  if (isQualifying) {
    return <QualifyingLiveTable laps={laps} entries={liveEntries} phaseLabel={phaseLabel} />;
  }

  const raceMatch = currentPhase!.match(/^race_(\d+)_group_(\d+)$/);
  const raceNum = raceMatch ? parseInt(raceMatch[1]) : 1;
  const groupNum = raceMatch ? parseInt(raceMatch[2]) : 1;

  const maxGroups = competition.results?.groupCountOverride ?? undefined;
  const excludedPilots = new Set<string>(competition.results?.excludedPilots || []);

  return (
    <RaceLiveTable
      competition={competition}
      laps={laps}
      entries={liveEntries}
      teams={liveTeams}
      phaseLabel={phaseLabel}
      raceNum={raceNum}
      groupNum={groupNum}
      scoring={scoring}
      sessionLaps={sessionLaps}
      excludedPilots={excludedPilots}
      maxGroups={maxGroups}
    />
  );
}

function QualifyingLiveTable({ laps, entries, phaseLabel }: {
  laps: SessionLap[];
  entries: any[];
  phaseLabel: string;
}) {
  const pilotBest = useMemo(() => {
    const map = new Map<string, { pilot: string; kart: number; bestTime: number; bestTimeStr: string; lapCount: number }>();
    for (const l of laps) {
      if (!l.lap_time) continue;
      const sec = parseLapSec(l.lap_time);
      if (sec === null || sec < 38) continue;
      const ex = map.get(l.pilot);
      if (!ex) {
        map.set(l.pilot, { pilot: l.pilot, kart: l.kart, bestTime: sec, bestTimeStr: l.lap_time!, lapCount: 1 });
      } else {
        ex.lapCount++;
        if (sec < ex.bestTime) { ex.bestTime = sec; ex.bestTimeStr = l.lap_time!; }
      }
    }
    for (const e of entries) {
      if (!map.has(e.pilot) && e.bestLap) {
        const sec = parseLapSec(e.bestLap);
        if (sec !== null && sec >= 38) {
          map.set(e.pilot, { pilot: e.pilot, kart: e.kart ?? 0, bestTime: sec, bestTimeStr: e.bestLap, lapCount: e.lapNumber ?? 0 });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.bestTime - b.bestTime);
  }, [laps, entries]);

  if (pilotBest.length === 0) return null;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-dark-800 flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">{phaseLabel}</h3>
        <span className="text-dark-500 text-[10px]">{pilotBest.length} пілотів</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="table-header">
            <th className="table-cell text-center w-8">#</th>
            <th className="table-cell text-left">Пілот</th>
            <th className="table-cell text-center">Карт</th>
            <th className="table-cell text-right">Найкращий час</th>
            <th className="table-cell text-right">Gap</th>
            <th className="table-cell text-center">Кола</th>
          </tr></thead>
          <tbody>
            {pilotBest.map((p, i) => {
              const gap = i === 0 ? '' : `+${(p.bestTime - pilotBest[0].bestTime).toFixed(3)}`;
              return (
                <tr key={p.pilot} className="table-row">
                  <td className="table-cell text-center font-mono text-white font-bold">{i + 1}</td>
                  <td className="table-cell text-left text-white">
                    <Link to={`/pilots/${encodeURIComponent(p.pilot)}`} className="text-white hover:text-primary-400 transition-colors">
                      {shortName(p.pilot)}
                    </Link>
                  </td>
                  <td className="table-cell text-center font-mono text-dark-300">{p.kart}</td>
                  <td className={`table-cell text-right font-mono font-semibold ${i === 0 ? 'text-purple-400' : 'text-green-400'}`}>
                    {toSeconds(p.bestTimeStr)}
                  </td>
                  <td className="table-cell text-right font-mono text-dark-400 text-[11px]">{gap}</td>
                  <td className="table-cell text-center font-mono text-dark-400">{p.lapCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RaceLiveTable({ competition, laps, entries, teams, phaseLabel, raceNum, groupNum, scoring, sessionLaps, excludedPilots, maxGroups }: {
  competition: Competition;
  laps: SessionLap[];
  entries: any[];
  teams: any[];
  phaseLabel: string;
  raceNum: number;
  groupNum: number;
  scoring: ScoringData | null;
  sessionLaps: Map<string, SessionLap[]>;
  excludedPilots: Set<string>;
  maxGroups?: number;
}) {
  const isCL = competition.format === 'champions_league';

  const { startPositions, startGrid, totalPilots } = useMemo(() => {
    const qualiSessions = competition.sessions.filter(s => s.phase?.startsWith('qualifying'));
    const qualiData = new Map<string, { bestTime: number; pilot: string }>();
    for (const qs of qualiSessions) {
      for (const l of (sessionLaps.get(qs.sessionId) || [])) {
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
    let qualifiedPilots = qualiSorted.slice(0, maxQualified).map(([p]) => p);
    const effectiveMaxGroups = maxGroups ?? (qualifiedPilots.length <= 13 ? 1 : qualifiedPilots.length <= 26 ? 2 : 3);

    let prevRaceTimes: { pilot: string; time: number }[] = qualiSorted.map(([p, d]) => ({ pilot: p, time: d.bestTime }));

    for (let r = 1; r < raceNum; r++) {
      const rSessions = competition.sessions.filter(s => s.phase?.startsWith(`race_${r}_`));
      const raceTimes: { pilot: string; time: number }[] = [];
      for (const rs of rSessions) {
        for (const l of (sessionLaps.get(rs.sessionId) || [])) {
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
    const groups = splitIntoGroups(prevSorted.map(p => p.pilot), effectiveMaxGroups);
    const sp = new Map<string, number>();
    const grid = new Map<number, string>();
    if (groupNum <= groups.length) {
      const g = groups[groupNum - 1];
      g.pilots.forEach((p, pi) => {
        const pos = g.pilots.length - pi;
        sp.set(p, pos);
        grid.set(pos, p);
      });
    }

    const totalPilotsOverride = competition.results?.totalPilotsOverride ?? null;
    const pilotsLocked = competition.results?.totalPilotsLocked ?? false;
    const total = (pilotsLocked && totalPilotsOverride !== null) ? totalPilotsOverride : qualifiedPilots.length;

    return { startPositions: sp, startGrid: grid, totalPilots: total };
  }, [competition, sessionLaps, raceNum, groupNum, excludedPilots, maxGroups, isCL]);

  const raceData = useMemo(() => {
    const lagMap = new Map<number, string>();
    for (const t of teams) {
      if (t.lag) lagMap.set(t.position ?? t.number, t.lag);
    }

    const pilotStats = new Map<string, { kart: number; bestTime: number; bestTimeStr: string; lapCount: number; lastPosition: number }>();
    for (const l of laps) {
      const sec = parseLapSec(l.lap_time);
      if (sec === null || sec < 38) continue;
      const ex = pilotStats.get(l.pilot);
      if (!ex) {
        pilotStats.set(l.pilot, { kart: l.kart, bestTime: sec, bestTimeStr: l.lap_time!, lapCount: 1, lastPosition: l.position ?? 99 });
      } else {
        ex.lapCount++;
        if (l.position !== null) ex.lastPosition = l.position;
        if (sec < ex.bestTime) { ex.bestTime = sec; ex.bestTimeStr = l.lap_time!; }
      }
    }

    for (const e of entries) {
      const ps = pilotStats.get(e.pilot);
      if (ps) {
        ps.lastPosition = e.position;
        ps.kart = e.kart ?? ps.kart;
      } else if (e.pilot) {
        pilotStats.set(e.pilot, { kart: e.kart ?? 0, bestTime: Infinity, bestTimeStr: '', lapCount: e.lapNumber ?? 0, lastPosition: e.position ?? 99 });
      }
    }

    const sorted = [...pilotStats.entries()]
      .filter(([p]) => !excludedPilots.has(p))
      .sort((a, b) => {
        if (a[1].lapCount !== b[1].lapCount) return b[1].lapCount - a[1].lapCount;
        if (a[1].lastPosition !== b[1].lastPosition) return a[1].lastPosition - b[1].lastPosition;
        return 0;
      });

    return sorted.map(([pilot, stats], i) => {
      const finishPos = i + 1;
      const startPos = startPositions.get(pilot) ?? 0;
      const diff = startPos > 0 ? startPos - finishPos : 0;
      const groupLabel = groupNum === 1 ? 'I' : groupNum === 2 ? 'II' : 'III';

      let posPoints = 0;
      let overtakePoints = 0;
      if (scoring && startPos > 0) {
        posPoints = getPositionPoints(scoring, totalPilots, groupLabel, finishPos);
        overtakePoints = calcOvertakePoints(scoring, groupNum, startPos, finishPos, isCL);
      }

      const entryIdx = entries.findIndex((e: any) => e.pilot === pilot);
      const lag = entryIdx >= 0 ? lagMap.get(entries[entryIdx].position) : null;

      return {
        pilot,
        kart: stats.kart,
        startPos,
        finishPos,
        diff,
        gap: lag ?? null,
        posPoints,
        overtakePoints,
        lapCount: stats.lapCount,
      };
    });
  }, [laps, entries, teams, startPositions, scoring, totalPilots, groupNum, isCL, excludedPilots]);

  if (raceData.length === 0) return null;

  const n = raceData.length;
  const arrowW = 96;
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const [tbodyH, setTbodyH] = useState(0);

  useEffect(() => {
    if (!tbodyRef.current) return;
    const obs = new ResizeObserver(([e]) => setTbodyH(e.contentRect.height));
    obs.observe(tbodyRef.current);
    return () => obs.disconnect();
  }, [raceData.length]);

  function arrowColor(diff: number): string {
    if (diff === 0) return '#6b7280';
    const abs = Math.abs(diff);
    if (diff > 0) return abs >= 5 ? '#22c55e' : abs >= 3 ? '#4ade80' : '#86efac';
    return abs >= 5 ? '#ef4444' : abs >= 3 ? '#f87171' : '#fca5a5';
  }

  const rowH = n > 0 ? tbodyH / n : 0;
  const arrows = tbodyH > 0 ? raceData
    .filter(r => r.startPos > 0 && r.startPos <= n)
    .map(r => {
      const sy = (r.startPos - 0.5) * rowH;
      const fy = (r.finishPos - 0.5) * rowH;
      const col = arrowColor(r.diff);
      const w = arrowW;
      return {
        d: `M 2 ${sy} C ${w * 0.4} ${sy} ${w * 0.6} ${fy} ${w - 5} ${fy}`,
        tip: `M ${w - 9} ${fy - 3} L ${w - 4} ${fy} L ${w - 9} ${fy + 3}`,
        col,
      };
    }) : [];

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-dark-800 flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">{phaseLabel}</h3>
        <span className="text-dark-500 text-[10px]">{raceData.length} пілотів</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs [&_th]:px-1.5 [&_th]:py-1 [&_td]:px-1.5 [&_td]:py-1">
          <thead>
            <tr className="table-header">
              <th className="text-left text-dark-300 font-semibold w-6">#</th>
              <th className="text-left text-dark-300 font-semibold">Старт</th>
              <th className="w-24"></th>
              <th className="text-left text-dark-300 font-semibold">Фініш</th>
              <th className="text-left text-dark-300 font-semibold">Gap</th>
              <th className="text-left text-dark-300 font-semibold border-l border-dark-700" colSpan={2}>Бали</th>
            </tr>
            <tr className="table-header">
              <th colSpan={4}></th>
              <th></th>
              <th className="text-left text-dark-500 text-[10px] border-l border-dark-700">Поз</th>
              <th className="text-left text-dark-500 text-[10px]">Обг</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {raceData.map((r, i) => {
              const startPilot = startGrid.get(r.finishPos);
              return (
                <tr key={r.pilot} className="table-row">
                  <td className="font-mono text-white font-bold">{r.finishPos}</td>
                  <td className="text-dark-400 whitespace-nowrap">
                    {startPilot ? shortName(startPilot) : '—'}
                  </td>
                  {i === 0 ? (
                    <td rowSpan={n} className="p-0 relative" style={{ width: arrowW }}>
                      {tbodyH > 0 && (
                        <svg width={arrowW} height={tbodyH} className="absolute top-0 left-0 block">
                          {arrows.map((a, j) => (
                            <g key={j}>
                              <path d={a.d} fill="none" stroke={a.col} strokeWidth="1.5" strokeLinecap="round" />
                              <path d={a.tip} fill="none" stroke={a.col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </g>
                          ))}
                        </svg>
                      )}
                    </td>
                  ) : null}
                  <td className="text-white whitespace-nowrap">
                    {r.diff !== 0 || r.startPos > 0 ? (
                      <span className="font-mono text-[11px] mr-1" style={{ color: arrowColor(r.diff) }}>
                        {r.diff > 0 ? `▲${r.diff}` : r.diff < 0 ? `▼${Math.abs(r.diff)}` : '—'}
                      </span>
                    ) : null}
                    <Link to={`/pilots/${encodeURIComponent(r.pilot)}`} className="text-white hover:text-primary-400 transition-colors">
                      {shortName(r.pilot)}
                    </Link>
                  </td>
                  <td className="font-mono text-dark-400 text-[11px]">
                    {r.gap ? toSeconds(r.gap) : ''}
                  </td>
                  <td className="font-mono text-dark-300 border-l border-dark-700/30">
                    {r.posPoints > 0 ? r.posPoints : '—'}
                  </td>
                  <td className="font-mono text-dark-300">
                    {r.overtakePoints > 0 ? r.overtakePoints : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

function CompetitionListItem({ competition: c, type }: { competition: Competition; type: string }) {
  let top3: { pilot: string; totalPoints: number }[] = [];
  try {
    const results = typeof c.results === 'string' ? JSON.parse(c.results) : (c.results || {});
    const pilots = results?.standings?.pilots;
    if (Array.isArray(pilots)) {
      top3 = pilots.slice(0, 3).map((p: any) => ({ pilot: p.pilot, totalPoints: p.totalPoints }));
    }
  } catch {}

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
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium shrink-0 ${
          c.status === 'finished' ? 'bg-dark-800 text-dark-400' : 'bg-green-500/15 text-green-400'
        }`}>
          {c.status === 'finished' ? 'Завершено' : 'Live'}
        </span>
      </div>
    </Link>
  );
}
