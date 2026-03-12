import { MOCK_KARTS } from '../../mock/timingData';

export default function Karts() {
  const statusColors = {
    good: 'text-green-400 bg-green-500/10',
    average: 'text-yellow-400 bg-yellow-500/10',
    poor: 'text-red-400 bg-red-500/10',
    unknown: 'text-dark-400 bg-dark-700',
  };

  const statusLabels = {
    good: 'Хороший',
    average: 'Середній',
    poor: 'Слабкий',
    unknown: 'Невідомо',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">🔧 Карти</h1>
        <p className="text-dark-400 text-sm">
          Інформація та статистика по кожному карту на картодромі. Дані збираються
          автоматично на основі результатів гонок.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MOCK_KARTS.map((kart) => (
          <div key={kart.number} className="card hover:border-dark-600 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-dark-800 rounded-xl flex items-center justify-center font-mono font-bold text-xl text-white">
                  {kart.number}
                </div>
                <div>
                  <div className="text-white font-semibold">Карт #{kart.number}</div>
                  <div className="text-dark-500 text-xs font-mono">
                    Avg: {kart.avgLapTime}
                  </div>
                </div>
              </div>
              <span className={`badge ${statusColors[kart.status]}`}>
                {statusLabels[kart.status]}
              </span>
            </div>
            {kart.notes && (
              <p className="text-dark-400 text-sm">{kart.notes}</p>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="text-white font-semibold mb-2">📊 Як формується рейтинг</h3>
        <p className="text-dark-400 text-sm">
          Статус кожного карту визначається автоматично на основі середнього часу кола
          в порівнянні з іншими картами. Дані оновлюються після кожної сесії.
        </p>
      </div>
    </div>
  );
}
