import { useState, useEffect, useCallback } from 'react';
import { TrackMap } from '../../components/Track';
import DayTimeline from '../../components/Timing/DayTimeline';
import CompetitionControl from '../../components/Timing/CompetitionControl';
import SessionReplay from '../../components/Timing/SessionReplay';
import { useTimingPoller } from '../../services/timingPoller';
import { useTrack } from '../../services/trackContext';
import { useAuth } from '../../services/auth';
import { COLLECTOR_URL } from '../../services/config';
import { Link } from 'react-router-dom';
import { parseTime, mergePilotNames } from '../../utils/timing';
import type { TimingEntry } from '../../types';

interface DbLap {
  pilot: string;
  kart: number;
  lap_number: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  position: number | null;
  ts: number;
}

export default function Timing() {
  const { entries, mode, lastUpdate, error, collectorStatus } = useTimingPoller({
    interval: 1000,
  });
  const { currentTrack, setCurrentTrack, allTracks } = useTrack();
  const { hasPermission } = useAuth();
  const canChangeTrack = hasPermission('change_track');
  const canManage = hasPermission('manage_results');

  const isLive = mode === 'live';
  const isConnecting = mode === 'connecting';
  const isOffline = mode === 'idle';
  const hasData = entries.length > 0;
  const collectorConnected = collectorStatus !== null;
  const siteReachable = collectorStatus?.siteReachable ?? false;
  const currentSessionId = (collectorStatus as any)?.sessionId || null;
  const currentRaceNumber = (collectorStatus as any)?.raceNumber ?? null;

  const competition = (collectorStatus as any)?.competition ?? null;
  const isCompetition = competition?.state && !['none', 'finished'].includes(competition.state);
  const sessionType = isCompetition ? (competition.competition?.name || 'Змагання') : 'Прокат';

  // Fetch laps for active session (for replay)
  const [replayLaps, setReplayLaps] = useState<DbLap[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [trackEntries, setTrackEntries] = useState<TimingEntry[]>([]);

  const fetchLaps = useCallback(async () => {
    if (!currentSessionId) { setReplayLaps([]); return; }
    try {
      const res = await fetch(`${COLLECTOR_URL}/db/laps?session=${currentSessionId}`);
      if (res.ok) setReplayLaps(await res.json());
    } catch { /* ignore */ }
  }, [currentSessionId]);

  // Get session start time
  useEffect(() => {
    if (!currentSessionId) { setSessionStartTime(null); return; }
    const m = currentSessionId.match(/session-(\d+)/);
    if (m) setSessionStartTime(parseInt(m[1]));
  }, [currentSessionId]);

  // Fetch laps periodically when live
  useEffect(() => {
    if (!currentSessionId || !isLive) return;
    fetchLaps();
    const timer = setInterval(fetchLaps, 3000);
    return () => clearInterval(timer);
  }, [currentSessionId, isLive, fetchLaps]);

  const replayData = mergePilotNames(replayLaps
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
    })));

  const hasReplayData = sessionStartTime != null && currentSessionId != null;
  const replayDuration = sessionStartTime
    ? Math.round((Date.now() - sessionStartTime) / 1000)
    : 600;

  return (
    <div className="space-y-4">
      {/* ===== TOP BAR ===== */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
          isLive && hasData ? 'bg-green-500/10 text-green-400' :
          isLive ? 'bg-green-500/10 text-green-400/60' :
          isConnecting ? 'bg-blue-500/10 text-blue-400' :
          siteReachable ? 'bg-yellow-500/10 text-yellow-400' :
          'bg-dark-800 text-dark-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            isLive && hasData ? 'bg-green-400 animate-pulse' :
            isLive ? 'bg-green-400/50 animate-pulse' :
            isConnecting ? 'bg-blue-400 animate-pulse' :
            siteReachable ? 'bg-yellow-400 animate-pulse' :
            'bg-dark-500'
          }`} />
          {isLive && hasData ? (
            currentRaceNumber != null
              ? <>Заїзд №{currentRaceNumber}{sessionStartTime && <LiveTimer startTime={sessionStartTime} />}</>
              : 'LIVE'
          ) :
           isLive ? 'Online' :
           isConnecting ? 'Підключення...' :
           siteReachable ? 'Очікування заїзду' :
           'Офлайн'}
        </div>

        <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
          isCompetition ? 'bg-purple-500/15 text-purple-400' : 'bg-dark-800 text-dark-400'
        }`}>
          {sessionType}
        </span>

        {canManage && <CompetitionControl inline />}

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <span className="text-dark-500 text-xs">Траса</span>
          {canChangeTrack ? (
            <select
              value={currentTrack.id}
              onChange={(e) => setCurrentTrack(parseInt(e.target.value, 10))}
              className="bg-dark-800 border border-dark-700 text-white text-sm rounded-lg px-2 py-1 outline-none focus:border-primary-500"
            >
              {allTracks.map((t) => (
                <option key={t.id} value={t.id}>№{t.id}</option>
              ))}
            </select>
          ) : (
            <span className="text-white font-mono font-bold">№{currentTrack.id}</span>
          )}
        </div>

      </div>

      {/* ===== OFFLINE / CONNECTING ===== */}
      {(isOffline || isConnecting) && !hasData && (
        <div className="card text-center py-12 space-y-4">
          <div className="text-4xl">{isConnecting ? '🔄' : siteReachable ? '⏳' : collectorConnected ? '🏎️' : '🔌'}</div>
          <div>
            <h2 className="text-lg font-bold text-white mb-1">
              {isConnecting ? 'Підключення до сервера...' :
               siteReachable ? 'Очікування заїзду' :
               collectorConnected ? 'Таймінг картодрому недоступний' :
               'Сервер збору даних недоступний'}
            </h2>
            <p className="text-dark-400 text-sm max-w-md mx-auto">
              {isConnecting
                ? 'Зачекайте, встановлюється з\'єднання з сервером...'
                : siteReachable
                ? 'Картодром працює, але зараз немає активних заїздів. Дані з\'являться автоматично.'
                : collectorConnected
                ? 'Система таймінгу картодрому зараз не відповідає. Дані з\'являться автоматично, як тільки вона стане доступною.'
                : 'Перевірте з\'єднання з сервером або спробуйте пізніше.'}
            </p>
          </div>
          <Link to="/sessions" className="inline-block text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors">
            Переглянути попередні заїзди
          </Link>
        </div>
      )}

      {/* ===== LIVE SESSION WITH REPLAY ===== */}
      {(hasData || siteReachable) && (
        <>
          {hasReplayData ? (
            <>
              <SessionReplay
                laps={replayData}
                durationSec={replayDuration}
                sessionStartTime={sessionStartTime!}
                isLive={true}
                raceNumber={currentRaceNumber}
                autoPlay={true}
                onEntriesUpdate={setTrackEntries}
                renderScrubber={(scrubber) => (
                  <div className="sticky top-0 z-10 bg-dark-900/95 backdrop-blur-sm border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
                    {scrubber}
                  </div>
                )}
              />
              <TrackMap track={currentTrack} entries={trackEntries} static />
            </>
          ) : (
            <>
              <TrackMap track={currentTrack} entries={entries} />
              {hasData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Пілотів" value={entries.length.toString()} />
                  <StatCard label="Лідер" value={entries.length > 0 ? entries[0].pilot.split(' ')[0] : '—'} />
                  <StatCard label="Найкращий час" value={entries.length > 0 ? (entries[0].bestLap || '—') : '—'} />
                </div>
              )}
            </>
          )}
        </>
      )}

      {error && (
        <div className="text-dark-500 text-xs text-center">{error}</div>
      )}

      {/* ===== TIMELINE (bottom) ===== */}
      <DayTimeline
        isTimingOnline={isLive}
        isTimingIdle={siteReachable && !isLive}
        idleSince={collectorStatus?.siteReachableSince ?? null}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center py-3">
      <div className="text-lg font-bold text-white font-mono mb-0.5">{value}</div>
      <div className="text-dark-500 text-[10px]">{label}</div>
    </div>
  );
}

function LiveTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const update = () => {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setElapsed(`${m}:${String(s).padStart(2, '0')}`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startTime]);
  return <span className="font-normal text-dark-400 ml-1.5 font-mono">{elapsed}</span>;
}
