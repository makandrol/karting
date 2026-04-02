import { useParams, Link, Navigate } from 'react-router-dom';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, getPhaseLabel, getPhasesForFormat } from '../../data/competitions';
import { toSeconds, isValidSession } from '../../utils/timing';
import { useAuth } from '../../services/auth';
import { TRACK_CONFIGS } from '../../data/tracks';
import SessionsTable, { type SessionTableRow } from '../../components/Sessions/SessionsTable';
import LeagueResults from '../../components/Results/LeagueResults';
import CompetitionTimeline from '../../components/Results/CompetitionTimeline';

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
  const { hasPermission, user } = useAuth();
  const canManage = hasPermission('manage_results');

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Load saved tab preference or default to 'live'
  const [tab, setTab] = useState<'live' | 'final'>(() => {
    const storage = user ? localStorage : sessionStorage;
    const saved = storage.getItem('competition_tab_preference');
    return (saved === 'final' ? 'final' : 'live') as 'live' | 'final';
  });
  
  // Save tab preference when it changes
  useEffect(() => {
    const storage = user ? localStorage : sessionStorage;
    storage.setItem('competition_tab_preference', tab);
  }, [tab, user]);
  
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
      setLoading(false);
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

  if (!eventId && type) {
    const config = COMPETITION_CONFIGS[type as keyof typeof COMPETITION_CONFIGS];
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">{config?.name || type}</h1>
        {competitions.length === 0 ? (
          <div className="card text-center py-12 text-dark-500">Немає змагань цього типу</div>
        ) : (
          <div className="space-y-2">
            {competitions.map(c => (
              <Link key={c.id} to={`/results/${type}/${c.id}`}
                className="card p-4 block hover:bg-dark-700/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">{c.name}</div>
                    <div className="text-dark-400 text-sm">{c.date} · {c.sessions.length} заїздів</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                    c.status === 'finished' ? 'bg-dark-800 text-dark-400' : 'bg-green-500/15 text-green-400'
                  }`}>
                    {c.status === 'finished' ? 'Завершено' : 'Live'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
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
  const trackLabel = trackConfig ? `Траса ${trackConfig.id}` : null;

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
            <h1 className="text-xl font-bold text-white">{competition.name.replace(/,?\s*Тр\.\s*\d+/, '')}</h1>
            <select
              value={trackId ?? ''}
              onChange={e => { if (!canManage) return; const v = parseInt(e.target.value); if (!isNaN(v)) changeTrack(v); }}
              disabled={!canManage}
              className={`bg-dark-800 text-dark-300 text-xs rounded px-0.5 py-0.5 border border-dark-700 outline-none focus:border-primary-500 w-10 ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <option value=""></option>
              {TRACK_CONFIGS.map(t => (
                <option key={t.id} value={t.id}>{t.id}</option>
              ))}
            </select>
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

      <div className="flex bg-dark-800 rounded-md p-0.5 w-fit">
        <button onClick={() => setTab('live')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'live' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
          Live результати
        </button>
        <button onClick={() => setTab('final')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'final' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
          Фінальні результати
        </button>
      </div>

      {tab === 'final' ? (
        <FinalResults competition={competition} />
      ) : (
        <LiveResults competition={competition} allSessionsEnded={allSessionsEnded && allPhasesLinked} compSessions={compSessions} onPilotCount={setPilotCount} onAutoGroups={setAutoGroups} />
      )}

      {compSessions.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-dark-800">
            <h3 className="text-white font-semibold text-sm">Заїзди ({compSessions.length})</h3>
          </div>
          <SessionsTable sessions={compSessions} />
        </div>
      )}
    </div>
  );
}

function FinalResults({ competition }: { competition: Competition }) {
  if (competition.status === 'live') {
    return <div className="card text-center py-12 text-dark-500">Фінальні результати будуть опубліковані після завершення змагання</div>;
  }
  if (!competition.uploaded_results) {
    return <div className="card text-center py-12 text-dark-500">Фінальні результати ще не завантажені</div>;
  }

  const results = competition.uploaded_results;
  if (Array.isArray(results)) {
    return (
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="table-header">
              {Object.keys(results[0] || {}).map(key => (
                <th key={key} className="table-cell text-center">{key}</th>
              ))}
            </tr></thead>
            <tbody>
              {results.map((row: any, i: number) => (
                <tr key={i} className="table-row">
                  {Object.values(row).map((val: any, j: number) => (
                    <td key={j} className="table-cell text-center font-mono text-dark-300">{String(val ?? '—')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return <div className="card p-4"><pre className="text-dark-300 text-xs overflow-auto">{JSON.stringify(results, null, 2)}</pre></div>;
}

function LiveResults({ competition: initialCompetition, allSessionsEnded, compSessions, onPilotCount, onAutoGroups }: { competition: Competition; allSessionsEnded: boolean; compSessions: SessionTableRow[]; onPilotCount: (n: number) => void; onAutoGroups: (n: number) => void }) {
  const [competition, setCompetition] = useState(initialCompetition);
  const [sessionLaps, setSessionLaps] = useState<Map<string, SessionLap[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<{ pilot: string; position: number }[]>([]);
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
        } else {
          setLivePositions([]);
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
    return (
      <div className="space-y-4">
        {sessionTimes.length > 0 && (
          <CompetitionTimeline
            format={competition.format}
            sessions={competition.sessions}
            sessionTimes={sessionTimes}
            currentTime={scrubTime}
            onTimeChange={(t) => { setScrubTime(t); if (t !== null) setLiveEnabled(false); else setLiveEnabled(true); }}
            isLive={competition.status === 'live' && !allSessionsEnded}
          />
        )}
        <LeagueResults
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
      </div>
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

function parseLapSec(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+\.\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  const s = t.match(/^\d+\.\d+$/);
  if (s) return parseFloat(t);
  return null;
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
