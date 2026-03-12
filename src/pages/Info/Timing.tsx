import { TimingBoard } from '../../components/Timing';
import { TrackMap } from '../../components/Track';
import { useTimingPoller } from '../../services/timingPoller';
import { useTrack } from '../../services/trackContext';
import { useAuth } from '../../services/auth';

export default function Timing() {
  const { entries, snapshots, mode, lastUpdate, error, connectLive, startDemo, stop } = useTimingPoller({
    interval: 1000,
  });
  const { currentTrack, setCurrentTrack, allTracks } = useTrack();
  const { hasPermission } = useAuth();
  const canChangeTrack = hasPermission('change_track');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">🕐 Live таймінг</h1>
        <p className="text-dark-400 text-sm">
          Дані з табло{' '}
          <a
            href="https://timing.karting.ua/board.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-400 hover:underline"
          >
            timing.karting.ua
          </a>
          . Оновлення кожну секунду.
        </p>
      </div>

      {/* Track config info + selector */}
      <div className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-600/20 text-primary-400 rounded-lg flex items-center justify-center font-bold font-mono shrink-0">
            {currentTrack.id}
          </div>
          <div>
            <div className="text-white font-semibold text-sm">{currentTrack.name}</div>
            <div className="text-dark-500 text-xs">
              {currentTrack.length} • {currentTrack.turns} поворотів
            </div>
          </div>
        </div>
        {canChangeTrack && (
          <select
            value={currentTrack.id}
            onChange={(e) => setCurrentTrack(parseInt(e.target.value, 10))}
            className="bg-dark-800 border border-dark-700 text-white text-sm rounded-lg px-3 py-1.5 outline-none focus:border-primary-500"
          >
            {allTracks.map((t) => (
              <option key={t.id} value={t.id}>
                №{t.id} — {t.length}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Controls */}
      {mode === 'idle' ? (
        <div className="card text-center py-10 space-y-6">
          <div className="text-5xl">🏎️</div>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Таймінг не активний</h2>
            <p className="text-dark-400 text-sm max-w-md mx-auto">
              Підключіться до live таймінгу картодрому або увімкніть демо-режим
              для перегляду інтерфейсу з тестовими даними.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={connectLive}
              className="bg-primary-600 hover:bg-primary-500 text-white px-6 py-3 rounded-xl font-semibold transition-colors flex items-center gap-2"
            >
              <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
              Підключити Live
            </button>
            <button
              onClick={startDemo}
              className="bg-dark-800 hover:bg-dark-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors border border-dark-700"
            >
              🎮 Увімкнути демо
            </button>
          </div>
        </div>
      ) : (
        <>
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
              <span>⚠️ {error}</span>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={startDemo}
                  className="text-yellow-400 hover:text-yellow-300 text-xs font-medium px-3 py-1 bg-yellow-500/10 rounded-lg"
                >
                  Увімкнути демо
                </button>
                <button
                  onClick={stop}
                  className="text-dark-400 hover:text-dark-300 text-xs font-medium px-3 py-1 bg-dark-800 rounded-lg"
                >
                  Зупинити
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {mode === 'live' && (
                <button
                  onClick={startDemo}
                  className="text-dark-400 hover:text-white text-xs px-3 py-1.5 bg-dark-800 hover:bg-dark-700 rounded-lg transition-colors"
                >
                  Перейти на демо
                </button>
              )}
              {mode === 'demo' && (
                <button
                  onClick={connectLive}
                  className="text-dark-400 hover:text-white text-xs px-3 py-1.5 bg-dark-800 hover:bg-dark-700 rounded-lg transition-colors"
                >
                  Спробувати Live
                </button>
              )}
            </div>
            <button
              onClick={stop}
              className="text-dark-500 hover:text-red-400 text-xs px-3 py-1.5 bg-dark-800 hover:bg-dark-700 rounded-lg transition-colors"
            >
              ⏹ Зупинити
            </button>
          </div>

          {/* Track map with animated karts */}
          <TrackMap track={currentTrack} entries={entries} />

          <TimingBoard
            entries={entries}
            mode={mode}
            lastUpdate={lastUpdate}
          />

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Зібрано снепшотів" value={snapshots.length.toString()} />
            <StatCard label="Пілотів на трасі" value={entries.length.toString()} />
            <StatCard
              label="Найкращий час"
              value={entries.length > 0 ? (entries[0].bestLap || '—') : '—'}
            />
            <StatCard
              label="Лідер"
              value={entries.length > 0 ? entries[0].pilot : '—'}
            />
          </div>
        </>
      )}

      <div className="card">
        <h3 className="text-white font-semibold mb-2">📡 Як це працює</h3>
        <div className="text-dark-400 text-sm space-y-2">
          <p>
            Система опитує сайт таймінгу кожну секунду і зберігає кожен "знімок" табла.
            Карти рухаються по обраній конфігурації траси відповідно до свого прогресу на колі.
          </p>
          <p>
            <strong className="text-dark-200">LIVE</strong> — дані з реального табла.{' '}
            <strong className="text-dark-200">DEMO</strong> — згенеровані дані (коли картодром не працює).
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <div className="text-2xl font-bold text-white font-mono mb-1">{value}</div>
      <div className="text-dark-500 text-xs">{label}</div>
    </div>
  );
}
