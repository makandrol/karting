import { TimingBoard } from '../../components/Timing';
import { useTimingPoller } from '../../services/timingPoller';

export default function Timing() {
  const { entries, snapshots, isLive, isMock, lastUpdate, error } = useTimingPoller({
    interval: 1000,
    useMock: false,
  });

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

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">
          ⚠️ {error}
        </div>
      )}

      <TimingBoard
        entries={entries}
        isLive={isLive}
        isMock={isMock}
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

      <div className="card">
        <h3 className="text-white font-semibold mb-2">📡 Як це працює</h3>
        <div className="text-dark-400 text-sm space-y-2">
          <p>
            Система опитує сайт таймінгу кожну секунду і зберігає кожен "знімок" табла.
            Це дозволяє відстежувати зміни позицій, обгони та динаміку гонки.
          </p>
          <p>
            <strong className="text-dark-200">LIVE</strong> — дані з реального табла.{' '}
            <strong className="text-dark-200">DEMO</strong> — згенеровані дані (коли картодром не працює).
          </p>
          <p className="text-dark-500 text-xs">
            В майбутньому: постійний збір даних на сервері → БД → аналітика обгонів, статистика пілотів.
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
