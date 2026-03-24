import { useState, useEffect, useCallback } from 'react';
import { TrackMap } from '../../components/Track';
import DayTimeline from '../../components/Timing/DayTimeline';
import CompetitionControl from '../../components/Timing/CompetitionControl';
import SessionReplay from '../../components/Timing/SessionReplay';
import { useTimingPoller } from '../../services/timingPoller';
import { useTrack } from '../../services/trackContext';
import { useAuth } from '../../services/auth';
import { COLLECTOR_URL } from '../../services/config';
import { Link, useNavigate } from 'react-router-dom';
import { parseTime, mergePilotNames, shortName, toSeconds } from '../../utils/timing';
import type { TimingEntry } from '../../types';
import SessionsTable from '../../components/Sessions/SessionsTable';
import LapsByPilots, { buildPilotLaps } from '../../components/Timing/LapsByPilots';
import SessionTypeChanger from '../../components/Timing/SessionTypeChanger';
import { useViewPrefs } from '../../services/viewPrefs';

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
  const navigate = useNavigate();
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

  interface RecentSession {
    id: string; start_time: number; end_time: number | null; pilot_count: number;
    real_pilot_count: number | null; race_number: number | null; track_id: number;
    best_lap_time: string | null; best_lap_pilot: string | null; best_lap_kart: number | null;
  }
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);

  useEffect(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fetch(`${COLLECTOR_URL}/db/sessions?date=${todayStr}`)
      .then(r => r.json())
      .then((data: RecentSession[]) => {
        setRecentSessions(data.filter(s => s.end_time && (s.end_time - s.start_time) >= 60000).slice(-5).reverse());
      })
      .catch(() => {});
  }, []);

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

  const replayPilots = buildPilotLaps(replayLaps.filter(l => l.lap_time).map(l => ({ pilot: l.pilot, kart: l.kart, lap_time: l.lap_time })));
  const { prefs, toggle } = useViewPrefs();
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

        {(isLive && hasData) && (
          <SessionTypeChanger
            sessionId={currentSessionId}
            currentFormat={(collectorStatus as any)?.competition?.competition?.format || null}
            currentPhase={null}
            currentCompetitionId={null}
          />
        )}

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
        <div className="space-y-4">
          <div className="card text-center py-8 space-y-3">
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
          </div>

          {recentSessions.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <SessionsTable sessions={recentSessions} />
            </div>
          )}

          <Link to="/sessions" className="block text-center text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors">
            Всі заїзди →
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
                liveEntries={entries}
                onEntriesUpdate={setTrackEntries}
                renderScrubber={(scrubber) => (
                  <div className="sticky top-12 z-10 bg-dark-900/95 backdrop-blur-sm border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
                    {scrubber}
                  </div>
                )}
              />
              {prefs.showTrack ? (
                <div className="relative">
                  <button onClick={() => toggle('showTrack')}
                    className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-md text-[10px] bg-dark-900/80 text-dark-400 hover:text-white transition-colors">
                    сховати
                  </button>
                  <TrackMap track={currentTrack} entries={trackEntries} static />
                </div>
              ) : (
                <button onClick={() => toggle('showTrack')}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-dark-800 text-dark-500 hover:text-white transition-colors">
                  Показати трек
                </button>
              )}
              {prefs.showLapsByPilots ? (
                <div className="relative">
                  <button onClick={() => toggle('showLapsByPilots')}
                    className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-md text-[10px] bg-dark-900/80 text-dark-400 hover:text-white transition-colors">
                    сховати
                  </button>
                  <LapsByPilots pilots={replayPilots} currentEntries={trackEntries} isLive />
                </div>
              ) : (
                <button onClick={() => toggle('showLapsByPilots')}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-dark-800 text-dark-500 hover:text-white transition-colors">
                  Показати кола по пілотах
                </button>
              )}
            </>
          ) : (
            <>
              {prefs.showTrack && <TrackMap track={currentTrack} entries={entries} />}
              {hasData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Пілотів" value={entries.length.toString()} />
                  <StatCard label="Лідер" value={entries.length > 0 ? shortName(entries[0].pilot) : '—'} />
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
