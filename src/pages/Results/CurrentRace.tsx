import { TimingBoard } from '../../components/Timing';
import { useTimingPoller } from '../../services/timingPoller';
import { Link } from 'react-router-dom';

export default function CurrentRace() {
  const { entries, mode, lastUpdate, error, connectLive, startDemo, stop } = useTimingPoller({
    interval: 2000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Поточне змагання</h1>
        <p className="text-dark-400 text-sm">
          Результати поточної сесії в реальному часі.
          Дані оновлюються автоматично.
        </p>
      </div>

      {mode === 'idle' ? (
        <div className="card text-center py-10 space-y-6">
          <div className="text-5xl">📊</div>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Немає активного змагання</h2>
            <p className="text-dark-400 text-sm max-w-md mx-auto">
              Підключіться до таймінгу для відстеження поточного змагання
              або перегляньте результати минулих гонок.
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
              🎮 Демо
            </button>
            <Link
              to="/results/gonzales"
              className="bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-white px-6 py-3 rounded-xl font-semibold transition-colors border border-dark-700"
            >
              📋 Результати змагань
            </Link>
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
                  Демо
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

          <div className="flex items-center justify-end">
            <button
              onClick={stop}
              className="text-dark-500 hover:text-red-400 text-xs px-3 py-1.5 bg-dark-800 hover:bg-dark-700 rounded-lg transition-colors"
            >
              ⏹ Зупинити
            </button>
          </div>

          <TimingBoard
            entries={entries}
            mode={mode}
            lastUpdate={lastUpdate}
          />
        </>
      )}

      <div className="card">
        <h3 className="text-white font-semibold mb-2">ℹ️ Про цю сторінку</h3>
        <p className="text-dark-400 text-sm">
          Тут відображаються проміжні результати поточного змагання. Дані автоматично
          обчислюються на основі інформації з таймінгу. Фінальні результати після завершення
          гонки будуть доступні у відповідному розділі змагань.
        </p>
      </div>
    </div>
  );
}
