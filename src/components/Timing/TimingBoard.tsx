import { useMemo } from 'react';
import type { TimingEntry } from '../../types';
import type { TimingMode } from '../../services/timingPoller';

interface TimingBoardProps {
  entries: TimingEntry[];
  mode: TimingMode;
  lastUpdate: number | null;
  compact?: boolean;
}

/** Парсить час "39.800", "1:02.222", "00:42.123" або "14.500" в секунди */
function parseTime(t: string | null): number | null {
  if (!t) return null;
  // "1:02.222" або "00:42.123"
  const lapMatch = t.match(/^(\d+):(\d+\.\d+)$/);
  if (lapMatch) return parseInt(lapMatch[1]) * 60 + parseFloat(lapMatch[2]);
  // "39.800" або "14.500"
  const secMatch = t.match(/^\d+\.\d+$/);
  if (secMatch) return parseFloat(t);
  return null;
}

type TimeColor = 'purple' | 'green' | 'yellow' | 'none';

/**
 * F1 стиль:
 * purple = абсолютний найкращий в сесії (перше коло теж, бо воно найкраще на момент)
 * green  = особистий найкращий, але не абсолютний
 * yellow = гірше за особистий найкращий
 * none   = немає значення (покажемо '—')
 */
function getTimeColor(value: string | null, personalBest: string | null, overallBest: number | null): TimeColor {
  const val = parseTime(value);
  if (val === null) return 'none';

  // Якщо це абсолютний найкращий час в сесії → фіолетовий
  if (overallBest !== null && Math.abs(val - overallBest) < 0.002) return 'purple';

  // Якщо це особистий найкращий → зелений
  const pb = parseTime(personalBest);
  if (pb !== null && Math.abs(val - pb) < 0.002) return 'green';

  // Якщо гірше за особистий найкращий → жовтий
  if (pb !== null && val > pb) return 'yellow';

  // Перше коло (немає PB для порівняння) — теж перевіряємо overall
  // Якщо pb null, значить ще нема best → це і є перший результат → purple або green
  if (overallBest !== null && val <= overallBest + 0.002) return 'purple';
  return 'green';
}

const COLOR_CLASSES: Record<TimeColor, string> = {
  purple: 'text-purple-400',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  none: 'text-dark-500',
};

export default function TimingBoard({ entries, mode, lastUpdate, compact = false }: TimingBoardProps) {
  const formatTime = (ts: number | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('uk-UA');
  };

  // Обчислюємо абсолютно найкращі часи в сесії
  const { overallBestLap, overallBestS1, overallBestS2 } = useMemo(() => {
    let bestLap: number | null = null;
    let bestS1: number | null = null;
    let bestS2: number | null = null;

    for (const e of entries) {
      const lap = parseTime(e.bestLap);
      if (lap !== null && (bestLap === null || lap < bestLap)) bestLap = lap;
      const s1 = parseTime(e.bestS1);
      if (s1 !== null && (bestS1 === null || s1 < bestS1)) bestS1 = s1;
      const s2 = parseTime(e.bestS2);
      if (s2 !== null && (bestS2 === null || s2 < bestS2)) bestS2 = s2;
    }

    return { overallBestLap: bestLap, overallBestS1: bestS1, overallBestS2: bestS2 };
  }, [entries]);

  return (
    <div className="card p-0 overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800">
        <div className="flex items-center gap-3">
          {mode === 'live' ? (
            <span className="badge-live">
              <span className="w-2 h-2 bg-green-400 rounded-full mr-1.5 animate-pulse" />
              LIVE
            </span>
          ) : mode === 'demo' ? (
            <span className="badge-mock">
              <span className="w-2 h-2 bg-yellow-400 rounded-full mr-1.5 animate-pulse" />
              DEMO
            </span>
          ) : (
            <span className="badge-offline">OFFLINE</span>
          )}
          {lastUpdate && (
            <span className="text-dark-500 text-xs">
              Оновлено: {formatTime(lastUpdate)}
            </span>
          )}
        </div>

        {/* Color legend */}
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-purple-400">■ Найкращий</span>
          <span className="text-green-400">■ Особистий рекорд</span>
          <span className="text-yellow-400">■ Повільніше</span>
        </div>
      </div>

      {/* Table */}
      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-center w-12">#</th>
                <th className="table-cell text-left min-w-[180px]">Пілот</th>
                <th className="table-cell text-center">Карт</th>
                <th className="table-cell text-right">Останнє коло</th>
                {!compact && <th className="table-cell text-right">S1</th>}
                {!compact && <th className="table-cell text-right">S2</th>}
                <th className="table-cell text-right">Найкраще</th>
                {!compact && <th className="table-cell text-right">Best S1</th>}
                {!compact && <th className="table-cell text-right">Best S2</th>}
                <th className="table-cell text-center">Коло</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const lastLapColor = getTimeColor(entry.lastLap, entry.bestLap, overallBestLap);
                const s1Color = getTimeColor(entry.s1, entry.bestS1, overallBestS1);
                const s2Color = getTimeColor(entry.s2, entry.bestS2, overallBestS2);
                const bestLapColor = getTimeColor(entry.bestLap, entry.bestLap, overallBestLap);
                const bestS1Color = getTimeColor(entry.bestS1, entry.bestS1, overallBestS1);
                const bestS2Color = getTimeColor(entry.bestS2, entry.bestS2, overallBestS2);

                return (
                  <tr key={`${entry.pilot}-${entry.kart}`} className="table-row group">
                    <td className={`table-cell text-center font-mono font-bold ${
                      entry.position === 1 ? 'position-1' :
                      entry.position === 2 ? 'position-2' :
                      entry.position === 3 ? 'position-3' : 'text-dark-400'
                    }`}>
                      {entry.position}
                    </td>
                    <td className="table-cell text-left">
                      <div className="font-medium text-white text-sm">
                        {entry.pilot}
                        {entry.currentLapSec !== null && (
                          <span className="text-dark-600 text-[10px] ml-1.5 font-mono">
                            ({entry.currentLapSec.toFixed(1)}s)
                          </span>
                        )}
                      </div>
                      {entry.progress !== null && (
                        <div className="mt-1 h-1 w-full bg-dark-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-linear ${
                              entry.position === 1 ? 'bg-yellow-500/70' :
                              entry.position <= 3 ? 'bg-primary-500/50' : 'bg-dark-500/50'
                            }`}
                            style={{ width: `${Math.round(entry.progress * 100)}%` }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="table-cell text-center font-mono text-dark-300">
                      {entry.kart}
                    </td>
                    <td className={`table-cell text-right font-mono font-semibold ${COLOR_CLASSES[lastLapColor]}`}>
                      {entry.lastLap || '—'}
                    </td>
                    {!compact && (
                      <td className={`table-cell text-right font-mono text-xs ${COLOR_CLASSES[s1Color]}`}>
                        {entry.s1 || '—'}
                      </td>
                    )}
                    {!compact && (
                      <td className={`table-cell text-right font-mono text-xs ${COLOR_CLASSES[s2Color]}`}>
                        {entry.s2 || '—'}
                      </td>
                    )}
                    <td className={`table-cell text-right font-mono font-semibold ${COLOR_CLASSES[bestLapColor]}`}>
                      {entry.bestLap || '—'}
                    </td>
                    {!compact && (
                      <td className={`table-cell text-right font-mono text-xs ${COLOR_CLASSES[bestS1Color]}`}>
                        {entry.bestS1 || '—'}
                      </td>
                    )}
                    {!compact && (
                      <td className={`table-cell text-right font-mono text-xs ${COLOR_CLASSES[bestS2Color]}`}>
                        {entry.bestS2 || '—'}
                      </td>
                    )}
                    <td className="table-cell text-center font-mono text-dark-400">
                      {entry.lapNumber}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 0 && mode === 'idle' && (
        <div className="px-4 py-12 text-center text-dark-500">Таймінг не активний</div>
      )}
      {entries.length === 0 && mode !== 'idle' && (
        <div className="px-4 py-12 text-center text-dark-500">Завантаження даних...</div>
      )}
    </div>
  );
}
