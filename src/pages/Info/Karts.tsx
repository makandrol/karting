import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_KARTS } from '../../mock/timingData';
import { MIN_VALID_LAP_SECONDS } from '../../types';
import { LapFilter, getDefaultFilter, type LapFilterState } from '../../components/Filters';

function formatDatetime(dt: string): string {
  try {
    const d = new Date(dt);
    return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return dt; }
}

export default function Karts() {
  const [expandedKart, setExpandedKart] = useState<number | null>(null);
  const [filter, setFilter] = useState<LapFilterState>(getDefaultFilter);

  const toggleKart = (num: number) => {
    setExpandedKart(expandedKart === num ? null : num);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">🔧 Карти</h1>
        <p className="text-dark-400 text-sm">
          Всі карти картодрому "Жага швидкості" з топ-5 найкращих результатів.
          Кола менше {MIN_VALID_LAP_SECONDS}с автоматично ігноруються.
        </p>
      </div>

      <LapFilter filter={filter} onChange={setFilter} />

      <div className="space-y-3">
        {MOCK_KARTS.map((kart) => {
          const isExpanded = expandedKart === kart.number;
          const bestTime = kart.top5.length > 0 ? kart.top5[0].bestLap : '—';

          return (
            <div
              key={kart.number}
              className="card p-0 overflow-hidden hover:border-dark-600 transition-colors"
            >
              <button
                onClick={() => toggleKart(kart.number)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-dark-800/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <Link
                    to={`/info/karts/${kart.number}`}
                    onClick={(e) => e.stopPropagation()}
                    className="w-12 h-12 bg-dark-800 hover:bg-dark-700 rounded-xl flex items-center justify-center font-mono font-bold text-xl text-white shrink-0 transition-colors"
                  >
                    {kart.number}
                  </Link>
                  <div>
                    <div className="text-white font-semibold">Карт #{kart.number}</div>
                    <div className="text-dark-500 text-xs font-mono">
                      Найкращий: <span className="text-green-400">{bestTime}</span>
                      {kart.top5.length > 0 && (
                        <span className="text-dark-600 ml-2">
                          ({kart.top5[0].pilot})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    to={`/info/karts/${kart.number}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary-400 hover:text-primary-300 text-xs font-medium hidden sm:inline"
                  >
                    Повна статистика →
                  </Link>
                  <svg
                    className={`w-5 h-5 text-dark-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-dark-800">
                  {kart.top5.length > 0 ? (
                    <>
                      <table className="w-full">
                        <thead>
                          <tr className="table-header">
                            <th className="table-cell text-center w-12">#</th>
                            <th className="table-cell text-left">Пілот</th>
                            <th className="table-cell text-right">Час</th>
                            <th className="table-cell text-right">Дата і час</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kart.top5.map((result, idx) => (
                            <tr key={`${result.pilot}-${idx}`} className="table-row">
                              <td className={`table-cell text-center font-mono font-bold ${
                                idx === 0 ? 'position-1' : idx === 1 ? 'position-2' : idx === 2 ? 'position-3' : 'text-dark-400'
                              }`}>{idx + 1}</td>
                              <td className="table-cell text-left font-medium text-white">{result.pilot}</td>
                              <td className="table-cell text-right font-mono text-green-400 font-semibold">{result.bestLap}</td>
                              <td className="table-cell text-right text-dark-500 text-xs">{formatDatetime(result.datetime)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-5 py-3 border-t border-dark-800/50">
                        <Link
                          to={`/info/karts/${kart.number}`}
                          className="text-primary-400 hover:text-primary-300 text-sm font-medium"
                        >
                          Повна статистика карту #{kart.number} →
                        </Link>
                      </div>
                    </>
                  ) : (
                    <div className="px-5 py-6 text-center text-dark-500 text-sm">
                      Немає результатів
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
