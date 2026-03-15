import { TimingBoard } from '../../components/Timing';
import { TrackMap } from '../../components/Track';
import { useTimingPoller } from '../../services/timingPoller';
import { useTrack } from '../../services/trackContext';
import { useAuth } from '../../services/auth';
import { Link } from 'react-router-dom';
import { getTodaySessions } from '../../mock/sessionData';

export default function Timing() {
  const { entries, snapshots, mode, lastUpdate, error, startDemo, stop, collectorStatus } = useTimingPoller({
    interval: 1000,
  });
  const { currentTrack, setCurrentTrack, allTracks } = useTrack();
  const { hasPermission, isOwner } = useAuth();
  const canChangeTrack = hasPermission('change_track');
  const todaySessions = getTodaySessions();
  const currentSessionNum = todaySessions.length;

  // Auto-determine status
  const isLive = mode === 'live';
  const isDemo = mode === 'demo';
  const isConnecting = mode === 'connecting';
  const isOffline = mode === 'idle';
  const hasData = entries.length > 0;
  const collectorConnected = collectorStatus !== null;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
            isLive && hasData ? 'bg-green-500/10 text-green-400' :
            isLive ? 'bg-green-500/10 text-green-400/60' :
            isDemo ? 'bg-yellow-500/10 text-yellow-400' :
            isConnecting ? 'bg-blue-500/10 text-blue-400' :
            'bg-dark-800 text-dark-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              isLive && hasData ? 'bg-green-400 animate-pulse' :
              isLive ? 'bg-green-400/50 animate-pulse' :
              isDemo ? 'bg-yellow-400 animate-pulse' :
              isConnecting ? 'bg-blue-400 animate-pulse' :
              'bg-dark-500'
            }`} />
            {isLive && hasData ? 'LIVE' :
             isLive ? 'Таймінг Online (порожнє табло)' :
             isDemo ? 'DEMO' :
             isConnecting ? 'Підключення...' :
             'Офлайн'}
          </div>

          {/* Collector status */}
          {collectorConnected && (
            <span className="text-dark-600 text-[10px] font-mono">
              сервер: ✓ {collectorStatus.online ? 'таймінг online' : 'таймінг offline'} • poll #{collectorStatus.pollCount}
            </span>
          )}
          {!collectorConnected && !isDemo && !isConnecting && (
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
          {/* Session indicator */}
          <div className="text-right">
            <Link to="/sessions" className="text-dark-400 hover:text-primary-400 text-xs transition-colors">
              Заїзд #{currentSessionNum} • {todaySessions.length} сьогодні →
            </Link>
          </div>

          {/* Demo toggle (owner only) */}
          {isOwner && !isLive && (
            <button
              onClick={() => { if (isDemo) stop(); else startDemo(); }}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                isDemo ? 'bg-yellow-500/20 text-yellow-400' : 'bg-dark-800 text-dark-500 hover:text-dark-300'
              }`}
            >
              {isDemo ? '⏹ Стоп демо' : '🎮 Демо'}
            </button>
          )}
        </div>
      </div>

      {/* Offline / Connecting state */}
      {(isOffline || isConnecting) && !hasData && (
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
                ? 'Сервер перевіряє таймінг кожну хвилину. Як тільки картодром запрацює — дані з\'являться автоматично.'
                : 'Перевірте з\'єднання з сервером або спробуйте пізніше.'}
            </p>
          </div>
          {collectorConnected && (
            <div className="flex items-center justify-center gap-2 text-dark-500 text-xs">
              <span className="w-1.5 h-1.5 bg-dark-500 rounded-full animate-pulse" />
              Очікування • запит #{collectorStatus?.pollCount || 0} • кожні {(collectorStatus?.pollInterval || 60000) / 1000}с
            </div>
          )}
        </div>
      )}

      {/* Timing board */}
      {hasData && (
        <>
          <TimingBoard entries={entries} mode={mode} lastUpdate={lastUpdate} />
          <TrackMap track={currentTrack} entries={entries} />

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Пілотів" value={entries.length.toString()} />
            <StatCard
              label="Лідер"
              value={entries.length > 0 ? entries[0].pilot.split(' ')[0] : '—'}
            />
            <StatCard
              label="Найкращий час"
              value={entries.length > 0 ? (entries[0].bestLap || '—') : '—'}
            />
            <StatCard label="Снепшотів" value={snapshots.length.toString()} />
          </div>
        </>
      )}

      {error && (
        <div className="text-dark-500 text-xs text-center">{error}</div>
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
