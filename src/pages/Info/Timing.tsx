import { useMemo } from 'react';
import { TimingBoard } from '../../components/Timing';
import { TrackMap } from '../../components/Track';
import DayTimeline from '../../components/Timing/DayTimeline';
import CompetitionControl from '../../components/Timing/CompetitionControl';
import { SessionRows } from '../../components/Sessions/SessionRows';
import { ALL_COMPETITION_EVENTS } from '../../mock/competitionEvents';
import { useTimingPoller } from '../../services/timingPoller';
import { useTrack } from '../../services/trackContext';
import { useAuth } from '../../services/auth';
import { Link } from 'react-router-dom';

export default function Timing() {
  const { entries, snapshots, mode, lastUpdate, error, collectorStatus } = useTimingPoller({
    interval: 1000,
  });
  const { currentTrack, setCurrentTrack, allTracks } = useTrack();
  const { hasPermission, isModerator } = useAuth();
  const canChangeTrack = hasPermission('change_track');

  const today = new Date().toISOString().split('T')[0];
  const todayEvents = useMemo(() =>
    ALL_COMPETITION_EVENTS.filter(e => e.date === today).slice(-3),
  [today]);

  const todaySessions: any[] = [];
  const currentSessionNum = todaySessions.length;

  const isLive = mode === 'live';
  const isConnecting = mode === 'connecting';
  const isOffline = mode === 'idle';
  const hasData = entries.length > 0;
  const collectorConnected = collectorStatus !== null;
  const siteReachable = collectorStatus?.siteReachable ?? false;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
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
            {isLive && hasData ? 'LIVE' :
             isLive ? 'Таймінг Online (порожнє табло)' :
             isConnecting ? 'Підключення...' :
             siteReachable ? 'Очікування заїзду' :
             'Офлайн'}
          </div>

          {/* Collector status (admin only) */}
          {isModerator && collectorConnected && (
            <span className="text-dark-600 text-[10px] font-mono">
              сервер: ✓ {collectorStatus.online ? 'таймінг online' : collectorStatus.siteReachable ? 'таймінг idle' : 'таймінг offline'} • poll #{collectorStatus.pollCount}
            </span>
          )}
          {isModerator && !collectorConnected && !isConnecting && (
            <span className="text-red-400/50 text-[10px]">сервер недоступний</span>
          )}

          {/* Track selector */}
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

        <div className="flex items-center gap-4">
          <div className="text-right">
            <Link to="/sessions" className="text-dark-400 hover:text-primary-400 text-xs transition-colors">
              Заїзд #{currentSessionNum} • {todaySessions.length} сьогодні →
            </Link>
          </div>
        </div>
      </div>

      {/* Day timeline */}
      <DayTimeline
        sessions={todaySessions.map(s => ({
          id: s.id,
          number: s.number,
          startTime: s.startTime,
          endTime: s.endTime,
          type: s.type,
          competitionName: s.competitionName,
        }))}
        isTimingOnline={isLive}
        isTimingIdle={siteReachable && !isLive}
      />

      {/* Competition control (admin) */}
      {isModerator && <CompetitionControl />}

      {/* Offline / Connecting state (only when site not reachable) */}
      {(isOffline || isConnecting) && !hasData && !siteReachable && (
        <div className="card text-center py-12 space-y-4">
          <div className="text-4xl">{isConnecting ? '🔄' : '🏎️'}</div>
          <div>
            <h2 className="text-lg font-bold text-white mb-1">
              {isConnecting ? 'Підключення до сервера...' :
               collectorConnected ? 'Картодром зараз не працює' :
               'Сервер збору даних недоступний'}
            </h2>
            <p className="text-dark-400 text-sm max-w-md mx-auto">
              {collectorConnected
                ? 'Дані з\'являться автоматично, як тільки картодром запрацює.'
                : 'Перевірте з\'єднання з сервером або спробуйте пізніше.'}
            </p>
          </div>
          <Link
            to="/sessions"
            className="inline-block text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors"
          >
            📅 Переглянути попередні заїзди →
          </Link>
        </div>
      )}

      {/* Timing board + track — show when live OR site reachable (even if empty) */}
      {(hasData || siteReachable) && (
        <>
          <TimingBoard entries={entries} mode={siteReachable && !isLive ? 'live' : mode} lastUpdate={lastUpdate} />
          <TrackMap track={currentTrack} entries={entries} />

          {hasData && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Пілотів" value={entries.length.toString()} />
              <StatCard label="Лідер" value={entries.length > 0 ? entries[0].pilot.split(' ')[0] : '—'} />
              <StatCard label="Найкращий час" value={entries.length > 0 ? (entries[0].bestLap || '—') : '—'} />
              <StatCard label="Снепшотів" value={snapshots.length.toString()} />
            </div>
          )}
        </>
      )}

      {error && (
        <div className="text-dark-500 text-xs text-center">{error}</div>
      )}

      {/* Today's recent sessions */}
      {todayEvents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-dark-400 text-xs font-semibold">Останні заїзди сьогодні</span>
            <Link to="/sessions" className="text-dark-500 hover:text-primary-400 text-xs transition-colors">
              Всі заїзди →
            </Link>
          </div>
          <div className="card p-2 space-y-0.5">
            <SessionRows events={todayEvents} />
          </div>
        </div>
      )}
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
