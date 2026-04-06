import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, type ReactNode } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { toSeconds, mergePilotNames, fetchRaceStartPositions, parseTime } from '../../utils/timing';
import { useAuth } from '../../services/auth';
import SessionReplay, { type S1Event, type ReplaySortMode, type SnapshotPosition, parseSessionEvents } from '../../components/Timing/SessionReplay';
import LapsByPilots, { buildPilotLaps } from '../../components/Timing/LapsByPilots';
import SessionTypeChanger from '../../components/Timing/SessionTypeChanger';
import { TrackMap } from '../../components/Track';
import { useTrack } from '../../services/trackContext';
import { trackDisplayId } from '../../data/tracks';
import { useLayoutPrefs, PAGE_SECTIONS } from '../../services/layoutPrefs';
import TableLayoutBar from '../../components/TableLayoutBar';
import type { TimingEntry } from '../../types';
import { type DbLap, buildReplayLaps, extractCompetitionReplayProps } from '../../utils/session';

interface DbSession {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  real_pilot_count: number | null;
  track_id: number;
  race_number: number | null;
  is_race: number;
  date: string;
  best_lap_time: string | null;
  best_lap_pilot: string | null;
  merged_session_ids?: string[];
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(startMs: number, endMs: number): string {
  const sec = Math.round((endMs - startMs) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}с`;
  return `${m}хв ${s}с`;
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { allTracks } = useTrack();
  const { isOwner } = useAuth();
  const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

  const [dbSession, setDbSession] = useState<DbSession | null>(null);
  const [daySessions, setDaySessions] = useState<DbSession[]>([]);
  const [dbLaps, setDbLaps] = useState<DbLap[]>([]);
  const [s1Events, setS1Events] = useState<S1Event[]>([]);
  const [replaySnapshots, setReplaySnapshots] = useState<SnapshotPosition[]>([]);
  const [startPositions, setStartPositions] = useState<Map<string, number>>(new Map());
  const [totalQualifiedPilots, setTotalQualifiedPilots] = useState(0);
  const [liveEntries, setLiveEntries] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [trackEntries, setTrackEntries] = useState<TimingEntry[]>([]);
  const [excludedLaps, setExcludedLaps] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    (async () => {
      try {
        // Extract date from session ID (format: session-{timestamp})
        const tsMatch = sessionId.match(/session-(\d+)/);
        const date = tsMatch ? new Date(parseInt(tsMatch[1])).toISOString().split('T')[0] : null;

        const [sessRes] = await Promise.all([
          date
            ? fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`).then(r => r.json())
            : fetch(`${COLLECTOR_URL}/db/sessions`).then(r => r.json()),
        ]);
        if (!active) return;
        const allSessions = sessRes as DbSession[];
        setDaySessions(allSessions);
        const found = allSessions.find(s => s.id === sessionId);
        if (found) setDbSession(found);
        
        // Fetch laps from all merged session IDs
        const sessionIds = found?.merged_session_ids || [sessionId];
        const allLaps: DbLap[] = [];
        const allEvents: any[] = [];
        for (const sid of sessionIds) {
          const [sLaps, sEvents] = await Promise.all([
            fetch(`${COLLECTOR_URL}/db/laps?session=${sid}`).then(r => r.json()),
            fetch(`${COLLECTOR_URL}/db/events?session=${sid}`).then(r => r.json()).catch(() => []),
          ]);
          allLaps.push(...sLaps);
          allEvents.push(...sEvents);
        }
        const parsed = parseSessionEvents(allEvents);
        setDbLaps(allLaps);
        setS1Events(parsed.s1Events);
        setReplaySnapshots(parsed.snapshots);

        // Compute start positions from competition data
        const compPhase = (found as any)?.competition_phase;
        const compId = (found as any)?.competition_id;
        const compFormat = (found as any)?.competition_format;
        if (compId) {
          try {
            const compRes = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(compId)}`);
            if (compRes.ok) {
              const comp = await compRes.json();
              const results = typeof comp.results === 'string' ? JSON.parse(comp.results) : (comp.results || {});
              if (active && results.excludedLaps) setExcludedLaps(new Set(results.excludedLaps));
            }
          } catch {}
        }
        if (compId && compPhase?.startsWith('race_') && compFormat) {
          const sp = await fetchRaceStartPositions(COLLECTOR_URL, compId, compPhase, compFormat);
          if (active) { setStartPositions(sp.positions); setTotalQualifiedPilots(sp.totalQualified); }
        } else if (parsed.firstSnapshotPos) {
          if (active) setStartPositions(parsed.firstSnapshotPos);
        }

        if (found && !found.end_time) {
          try {
            const timingRes = await fetch(`${COLLECTOR_URL}/timing`).then(r => r.json());
            if (active && timingRes.sessionId === sessionId && timingRes.entries) {
              setLiveEntries(timingRes.entries);
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      if (active) setDbLoading(false);
    })();
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!dbSession || dbSession.end_time) return;
    const timer = setInterval(async () => {
      try {
        const [lapsRes, timingRes] = await Promise.all([
          fetch(`${COLLECTOR_URL}/db/laps?session=${dbSession.id}`).then(r => r.json()),
          fetch(`${COLLECTOR_URL}/timing`).then(r => r.json()),
        ]);
        setDbLaps(lapsRes);
        if (timingRes.sessionId === dbSession.id && timingRes.entries) {
          setLiveEntries(timingRes.entries);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [dbSession]);

  const { isSectionVisible, getPageLayout } = useLayoutPrefs();
  const sessionLayout = getPageLayout('sessionDetail');

  const handleRenamePilot = async (oldName: string, newName: string) => {
    if (!sessionId) return;
    const sessionIds = dbSession?.merged_session_ids || [sessionId];
    for (const sid of sessionIds) {
      await fetch(`${COLLECTOR_URL}/db/rename-pilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ sessionId: sid, oldName, newName }),
      }).catch(() => {});
    }
    window.location.reload();
  };

  const compId = (dbSession as any)?.competition_id;
  const handleToggleLap = async (lapKey: string) => {
    if (!compId) return;
    const next = new Set(excludedLaps);
    next.has(lapKey) ? next.delete(lapKey) : next.add(lapKey);
    setExcludedLaps(next);
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(compId)}`);
      if (!res.ok) return;
      const comp = await res.json();
      const results = typeof comp.results === 'string' ? JSON.parse(comp.results) : (comp.results || {});
      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(compId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ results: { ...results, excludedLaps: [...next] } }),
      });
    } catch {}
  };

  if (dbLoading) {
    return <div className="card text-center py-12 text-dark-500">Завантаження...</div>;
  }

  if (!dbSession) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-white mb-2">Заїзд не знайдено</h1>
        <Link to="/sessions" className="text-primary-400 hover:underline text-sm">← Всі заїзди</Link>
      </div>
    );
  }

  const mergedLaps = mergePilotNames(dbLaps);
  const pilots = buildPilotLaps(
    mergedLaps.filter(l => l.lap_time).map(l => ({ pilot: l.pilot, kart: l.kart, lap_time: l.lap_time, s1: l.s1, s2: l.s2, ts: l.ts })),
    excludedLaps.size > 0 ? excludedLaps : undefined,
    sessionId,
  );

  const dateStr = new Date(dbSession.start_time).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' });
  const pilotCount = pilots.length > 0 ? pilots.length : (liveEntries.length > 0 ? liveEntries.length : (dbSession.real_pilot_count ?? 0));

  const currentIdx = daySessions.findIndex(s => s.id === sessionId);
  const dayOrder = (dbSession as any).day_order ?? (currentIdx >= 0 ? currentIdx + 1 : null);
  const prevSession = currentIdx > 0 ? daySessions[currentIdx - 1] : null;
  const nextSession = currentIdx >= 0 && currentIdx < daySessions.length - 1 ? daySessions[currentIdx + 1] : null;

  const compPhaseStr = (dbSession as any).competition_phase as string | null;
  const { raceGroup, isRace } = extractCompetitionReplayProps(compPhaseStr);

  return (
    <div className="space-y-6">
      <TableLayoutBar pageId="sessionDetail" sections={PAGE_SECTIONS.sessionDetail} />
      <div className="flex items-center gap-3">
        <Link to="/sessions" className="text-dark-400 hover:text-white transition-colors flex-shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">
              Заїзд {dayOrder ?? ''}
            </h1>
            <div className="flex items-center gap-1 border border-dark-700 rounded px-2 py-1">
              <svg className="w-3.5 h-3.5 text-dark-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              <span className="text-dark-300 text-xs font-mono">{trackDisplayId(dbSession.track_id)}</span>
            </div>
            <SessionTypeChanger
              sessionId={sessionId!}
              currentFormat={(dbSession as any).competition_format || null}
              currentPhase={compPhaseStr}
              currentCompetitionId={(dbSession as any).competition_id || null}
              onChanged={() => window.location.reload()}
            />
          </div>
          <p className="text-dark-400 text-sm">
            {dateStr}, {fmtTime(dbSession.start_time)}
            {dbSession.end_time && ` – ${fmtTime(dbSession.end_time)}`}
            {dbSession.end_time && ` · ${fmtDuration(dbSession.start_time, dbSession.end_time)}`}
            {` · ${pilotCount} пілотів`}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {prevSession ? (
            <Link to={`/sessions/${prevSession.id}`}
              className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
              title={`Заїзд ${prevSession.race_number ?? ''}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          ) : (
            <span className="p-1.5 text-dark-700"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></span>
          )}
          {nextSession ? (
            <Link to={`/sessions/${nextSession.id}`}
              className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
              title={`Заїзд ${nextSession.race_number ?? ''}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : (
            <span className="p-1.5 text-dark-700"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></span>
          )}
        </div>
      </div>

      {pilots.length === 0 && liveEntries.length === 0 ? (
        <div className="card text-center py-8 text-dark-500 text-sm">
          {!dbSession.end_time ? 'Заїзд активний, кола ще не зафіксовані' : 'Немає даних кіл для цього заїзду'}
        </div>
      ) : pilots.length === 0 && liveEntries.length > 0 ? (
        <>
          {!dbSession.end_time && (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Заїзд активний — дані оновлюються кожні 3 секунди
            </div>
          )}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-800">
              <h3 className="text-white font-semibold">Пілоти на трасі</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="table-header">
                    <th className="table-cell text-center w-10">#</th>
                    <th className="table-cell text-left">Пілот</th>
                    <th className="table-cell text-center">Карт</th>
                    <th className="table-cell text-center">Кіл</th>
                    <th className="table-cell text-right">Останній час</th>
                    <th className="table-cell text-right">Найкращий</th>
                  </tr>
                </thead>
                <tbody>
                  {liveEntries.map((e: any, i: number) => (
                    <tr key={e.pilot} className="table-row">
                      <td className="table-cell text-center font-mono font-bold text-white">{e.position || i + 1}</td>
                      <td className="table-cell text-left text-white">{e.pilot}</td>
                      <td className="table-cell text-center font-mono text-dark-300">{e.kart}</td>
                      <td className="table-cell text-center font-mono text-dark-300">{e.lapNumber || 0}</td>
                      <td className="table-cell text-right font-mono text-dark-300">{toSeconds(e.lastLap)}</td>
                      <td className="table-cell text-right font-mono text-green-400 font-semibold">{toSeconds(e.bestLap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          {!dbSession.end_time && (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Заїзд активний — дані оновлюються кожні 3 секунди
            </div>
          )}

          {dbSession.end_time && dbLaps.length > 0 && (() => {
            const replayLaps = buildReplayLaps(mergedLaps);
            const realDurationSec = dbSession.end_time
              ? Math.round((dbSession.end_time - dbSession.start_time) / 1000)
              : Math.max(...dbLaps.map(l => l.lap_number), 1) * (parseTime(dbLaps.find(l => l.lap_time)?.lap_time ?? null) || 42) + 30;
            const track = allTracks.find(t => t.id === dbSession.track_id) || allTracks[0];

            const lapsByPilotsEl = (
              <LapsByPilots key="lapsByPilots" pilots={pilots} currentEntries={trackEntries} onRenamePilot={isOwner ? handleRenamePilot : undefined}
                excludedLaps={excludedLaps.size > 0 ? excludedLaps : undefined}
                onToggleLap={isOwner && compId ? handleToggleLap : undefined}
                sessionId={sessionId} />
            );

            return replayLaps.length > 0 ? (
              <SessionReplay
                laps={replayLaps}
                durationSec={realDurationSec}
                sessionStartTime={dbSession.start_time}
                raceNumber={dbSession.race_number}
                autoPlay={true}
                s1Events={s1Events}
                snapshots={replaySnapshots}
                startPositions={startPositions}
                raceGroup={raceGroup}
                totalQualifiedPilots={totalQualifiedPilots || undefined}
                defaultSortMode={isRace ? 'race' as ReplaySortMode : 'qualifying' as ReplaySortMode}
                onEntriesUpdate={setTrackEntries}
                renderScrubber={(scrubber) => (
                  <div className="sticky top-0 z-10 bg-dark-900/95 backdrop-blur-sm border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
                    {scrubber}
                  </div>
                )}
                renderContent={({ scrubber, table }) => {
                  const sectionMap: Record<string, ReactNode> = {
                    replay: scrubber,
                    timingTable: table,
                    track: track?.svgPath ? <TrackMap track={track} entries={trackEntries} static /> : null,
                    lapsByPilots: lapsByPilotsEl,
                  };
                  return (
                    <>
                      {sessionLayout.map(s => {
                        if (!s.visible || !sectionMap[s.id]) return null;
                        return <div key={s.id}>{sectionMap[s.id]}</div>;
                      })}
                    </>
                  );
                }}
              />
            ) : lapsByPilotsEl;
          })()}

          {!(dbSession.end_time && dbLaps.length > 0) && (
            <LapsByPilots key="lapsByPilots" pilots={pilots} currentEntries={trackEntries} onRenamePilot={isOwner ? handleRenamePilot : undefined}
              excludedLaps={excludedLaps.size > 0 ? excludedLaps : undefined}
              onToggleLap={isOwner && compId ? handleToggleLap : undefined}
              sessionId={sessionId} />
          )}
        </>
      )}
    </div>
  );
}
