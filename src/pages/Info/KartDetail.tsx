import { useParams, Link } from 'react-router-dom';
import { MOCK_KARTS, generateKartLaps } from '../../mock/timingData';
import { useMemo } from 'react';

function formatDatetime(dt: string): string {
  try {
    const d = new Date(dt);
    return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return dt; }
}

export default function KartDetail() {
  const { kartId } = useParams<{ kartId: string }>();
  const kartNumber = parseInt(kartId || '0', 10);
  const kart = MOCK_KARTS.find((k) => k.number === kartNumber);

  const allLaps = useMemo(() => generateKartLaps(kartNumber, 50), [kartNumber]);

  if (!kart) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">🔧</div>
        <h1 className="text-2xl font-bold text-white mb-2">Карт не знайдено</h1>
        <Link to="/info/karts" className="text-primary-400 hover:underline text-sm">← Назад до списку</Link>
      </div>
    );
  }

  const bestLap = kart.top5.length > 0 ? kart.top5[0] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/info/karts"
          className="text-dark-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="w-14 h-14 bg-dark-800 rounded-xl flex items-center justify-center font-mono font-bold text-2xl text-white">
          {kart.number}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Карт #{kart.number}</h1>
          {bestLap && (
            <p className="text-dark-400 text-sm">
              Рекорд: <span className="text-green-400 font-mono font-semibold">{bestLap.bestLap}</span>
              <span className="text-dark-600 ml-2">{bestLap.pilot} • {formatDatetime(bestLap.datetime)}</span>
            </p>
          )}
        </div>
      </div>

      {/* Top 5 */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800">
          <h3 className="text-white font-semibold">🏆 Топ-5 найкращих часів</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-10">#</th>
              <th className="table-cell text-left">Пілот</th>
              <th className="table-cell text-right">Час</th>
              <th className="table-cell text-right">Дата і час</th>
            </tr>
          </thead>
          <tbody>
            {kart.top5.map((r, idx) => (
              <tr key={`${r.pilot}-${idx}`} className="table-row">
                <td className={`table-cell text-center font-mono font-bold ${
                  idx === 0 ? 'position-1' : idx === 1 ? 'position-2' : idx === 2 ? 'position-3' : 'text-dark-400'
                }`}>{idx + 1}</td>
                <td className="table-cell text-left font-medium text-white">{r.pilot}</td>
                <td className="table-cell text-right font-mono text-green-400 font-semibold">{r.bestLap}</td>
                <td className="table-cell text-right text-dark-400 text-xs font-mono">{formatDatetime(r.datetime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* All laps */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800 flex items-center justify-between">
          <h3 className="text-white font-semibold">📊 Всі кола ({allLaps.length})</h3>
          <span className="text-dark-500 text-xs">Сортовано за часом</span>
        </div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0">
              <tr className="table-header">
                <th className="table-cell text-center w-10">#</th>
                <th className="table-cell text-left">Пілот</th>
                <th className="table-cell text-right">Час кола</th>
                <th className="table-cell text-right">S1</th>
                <th className="table-cell text-right">S2</th>
                <th className="table-cell text-left">Сесія</th>
                <th className="table-cell text-center">Коло</th>
                <th className="table-cell text-right">Дата і час</th>
              </tr>
            </thead>
            <tbody>
              {allLaps.map((lap, idx) => (
                <tr key={idx} className="table-row">
                  <td className={`table-cell text-center font-mono text-sm ${
                    idx === 0 ? 'text-purple-400 font-bold' : 'text-dark-500'
                  }`}>{idx + 1}</td>
                  <td className="table-cell text-left text-white text-sm">{lap.pilot}</td>
                  <td className={`table-cell text-right font-mono text-sm font-semibold ${
                    idx === 0 ? 'text-purple-400' : idx < 5 ? 'text-green-400' : 'text-dark-200'
                  }`}>{lap.lapTime}</td>
                  <td className="table-cell text-right font-mono text-xs text-dark-400">{lap.s1 || '—'}</td>
                  <td className="table-cell text-right font-mono text-xs text-dark-400">{lap.s2 || '—'}</td>
                  <td className="table-cell text-left text-dark-500 text-xs">{lap.sessionName}</td>
                  <td className="table-cell text-center font-mono text-dark-500 text-xs">{lap.lapNumber}</td>
                  <td className="table-cell text-right text-dark-500 text-xs font-mono">{formatDatetime(lap.datetime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
