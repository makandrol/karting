import { TimingBoard } from '../../components/Timing';
import { useTimingPoller } from '../../services/timingPoller';
import { Link } from 'react-router-dom';

export default function CurrentRace() {
  const { entries, mode, lastUpdate, error } = useTimingPoller({
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
              Як тільки картодром запрацює — дані з'являться автоматично.
            </p>
          </div>
          <Link
            to="/results/gonzales"
            className="inline-block bg-dark-800 hover:bg-dark-700 text-dark-300 hover:text-white px-6 py-3 rounded-xl font-semibold transition-colors border border-dark-700"
          >
            📋 Результати змагань
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
              ⚠️ {error}
            </div>
          )}

          <TimingBoard entries={entries} mode={mode} lastUpdate={lastUpdate} />
        </>
      )}
    </div>
  );
}
