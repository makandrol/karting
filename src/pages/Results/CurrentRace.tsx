import { TimingBoard } from '../../components/Timing';
import { useTimingPoller } from '../../services/timingPoller';

export default function CurrentRace() {
  const { entries, isLive, isMock, lastUpdate } = useTimingPoller({
    interval: 2000,
    useMock: false,
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

      <TimingBoard
        entries={entries}
        isLive={isLive}
        isMock={isMock}
        lastUpdate={lastUpdate}
      />

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
