import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { toSeconds, mergePilotNames } from '../../utils/timing';
import SessionReplay from '../../components/Timing/SessionReplay';
import { TrackMap } from '../../components/Track';
import { useTrack } from '../../services/trackContext';
import type { TimingEntry } from '../../types';

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

interface DbLap {
  id: number;
  session_id: string;
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

  const [dbSession, setDbSession] = useState<DbSession | null>(null);
  const [daySessions, setDaySessions] = useState<DbSession[]>([]);
  const [dbLaps, setDbLaps] = useState<DbLap[]>([]);
  const [liveEntries, setLiveEntries] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [trackEntries, setTrackEntries] = useState<TimingEntry[]>([]);

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
        for (const sid of sessionIds) {
          const sLaps = await fetch(`${COLLECTOR_URL}/db/laps?session=${sid}`).then(r => r.json());
          allLaps.push(...sLaps);
        }
        setDbLaps(allLaps);

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

  // Merge "Карт X" → real pilot name and build stats
  const mergedLaps = mergePilotNames(dbLaps);
  const pilotMap = new Map<string, { kart: number; laps: DbLap[]; bestLap: number }>();
  for (const lap of mergedLaps) {
    if (!pilotMap.has(lap.pilot)) pilotMap.set(lap.pilot, { kart: lap.kart, laps: [], bestLap: Infinity });
    const p = pilotMap.get(lap.pilot)!;
    p.laps.push(lap);
    if (lap.lap_time) {
      const sec = parseLapTime(lap.lap_time);
      if (sec !== null && sec < p.bestLap) p.bestLap = sec;
    }
  }
  const pilots = [...pilotMap.entries()]
    .sort((a, b) => a[1].bestLap - b[1].bestLap)
    .map(([name, data], i) => ({ name, ...data, position: i + 1 }));

  const dateStr = new Date(dbSession.start_time).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' });
  const pilotCount = pilots.length > 0 ? pilots.length : (liveEntries.length > 0 ? liveEntries.length : (dbSession.real_pilot_count ?? 0));
  const raceNum = dbSession.race_number;

  const currentIdx = daySessions.findIndex(s => s.id === sessionId);
  const prevSession = currentIdx > 0 ? daySessions[currentIdx - 1] : null;
  const nextSession = currentIdx >= 0 && currentIdx < daySessions.length - 1 ? daySessions[currentIdx + 1] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/sessions" className="text-dark-400 hover:text-white transition-colors flex-shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">
            Заїзд {raceNum ?? ''}
            <span className="text-dark-500 font-normal text-sm ml-2">Траса #{dbSession.track_id}</span>
          </h1>
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
          {/* Live entries (no completed laps yet) */}
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

          {/* Replay (only for finished sessions with laps) */}
          {dbSession.end_time && dbLaps.length > 0 && (() => {
            const replayLaps = mergePilotNames(mergedLaps)
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
            const realDurationSec = dbSession.end_time
              ? Math.round((dbSession.end_time - dbSession.start_time) / 1000)
              : Math.max(...dbLaps.map(l => l.lap_number), 1) * (parseLapTime(dbLaps.find(l => l.lap_time)?.lap_time || '') || 42) + 30;
            const track = allTracks.find(t => t.id === dbSession.track_id) || allTracks[0];

            return replayLaps.length > 0 ? (
              <>
                <SessionReplay
                  laps={replayLaps}
                  durationSec={realDurationSec}
                  sessionStartTime={dbSession.start_time}
                  raceNumber={dbSession.race_number}
                  autoPlay={true}
                  onEntriesUpdate={setTrackEntries}
                  renderScrubber={(scrubber) => (
                    <div className="sticky top-0 z-10 bg-dark-900/95 backdrop-blur-sm border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
                      {scrubber}
                    </div>
                  )}
                />
                {track?.svgPath && <TrackMap track={track} entries={trackEntries} static />}
              </>
            ) : null;
          })()}

          {/* Results table - laps grid */}
          <DbLapsGrid pilots={pilots} currentEntries={trackEntries} />
        </>
      )}
    </div>
  );
}

// ============================================================
// Helpers for DB session display
// ============================================================

function parseLapTime(t: string): number | null {
  const lapMatch = t.match(/^(\d+):(\d+\.\d+)$/);
  if (lapMatch) return parseInt(lapMatch[1]) * 60 + parseFloat(lapMatch[2]);
  const secMatch = t.match(/^\d+\.\d+$/);
  if (secMatch) return parseFloat(t);
  return null;
}

function formatSeconds(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  }
  return sec.toFixed(3);
}

function DbLapsGrid({ pilots, currentEntries = [] }: { pilots: { name: string; laps: DbLap[]; bestLap: number }[]; currentEntries?: TimingEntry[] }) {
  const overallBest = Math.min(...pilots.map(p => p.bestLap).filter(v => v < Infinity));
  const maxLaps = Math.max(...pilots.map(p => p.laps.length), 0);

  const completedLapsMap = new Map<string, number>();
  for (const e of currentEntries) {
    if (e.lapNumber >= 0) completedLapsMap.set(e.pilot, e.lapNumber);
  }
  const hasReplayState = currentEntries.length > 0 && currentEntries.some(e => e.lapNumber > 0);

  if (maxLaps === 0) return null;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Кола по пілотах</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-8">Коло</th>
              {pilots.map(p => (
                <th key={p.name} className="table-cell text-center min-w-[80px]">
                  <Link to={`/pilots/${encodeURIComponent(p.name)}`} className="text-white hover:text-primary-400 transition-colors">
                    {p.name.split(' ')[0]}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxLaps }, (_, lapIdx) => (
              <tr key={lapIdx} className="table-row">
                <td className="table-cell text-center font-mono text-dark-500">{lapIdx + 1}</td>
                {pilots.map(p => {
                  const lap = p.laps[lapIdx];
                  if (!lap?.lap_time) return <td key={p.name} className="table-cell text-center text-dark-700">—</td>;
                  const sec = parseLapTime(lap.lap_time);
                  const isPB = sec !== null && Math.abs(sec - p.bestLap) < 0.002;
                  const isOverall = sec !== null && Math.abs(sec - overallBest) < 0.002;
                  const completed = completedLapsMap.get(p.name) ?? 0;
                  const isCurrent = hasReplayState && completed > 0 && lapIdx === completed - 1;
                  return (
                    <td key={p.name} className={`table-cell text-center font-mono ${
                      isOverall ? 'text-purple-400 font-bold' : isPB ? 'text-green-400 font-bold' : 'text-dark-300'
                    } ${isCurrent ? 'ring-1 ring-primary-500/60 bg-primary-500/10 rounded' : ''}`}>
                      {toSeconds(lap.lap_time)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
