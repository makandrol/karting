import type { TimingEntry } from '../../types';
import type { TimingMode } from '../../services/timingPoller';

interface TimingBoardProps {
  entries: TimingEntry[];
  mode: TimingMode;
  lastUpdate: number | null;
  compact?: boolean;
}

export default function TimingBoard({ entries, mode, lastUpdate, compact = false }: TimingBoardProps) {
  const formatTime = (ts: number | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('uk-UA');
  };

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
        {entries.length > 0 && (
          <span className="text-dark-500 text-xs font-mono">
            {entries.length} пілотів
          </span>
        )}
      </div>

      {/* Table */}
      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-center w-12">#</th>
                <th className="table-cell text-left">Пілот</th>
                <th className="table-cell text-center">Карт</th>
                <th className="table-cell text-right">Останнє коло</th>
                {!compact && <th className="table-cell text-right">S1</th>}
                {!compact && <th className="table-cell text-right">S2</th>}
                <th className="table-cell text-right">Найкраще коло</th>
                {!compact && <th className="table-cell text-right">Best S1</th>}
                {!compact && <th className="table-cell text-right">Best S2</th>}
                <th className="table-cell text-center">Коло</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.pilot}-${entry.kart}`} className="table-row">
                  <td className={`table-cell text-center font-mono font-bold ${
                    entry.position === 1 ? 'position-1' :
                    entry.position === 2 ? 'position-2' :
                    entry.position === 3 ? 'position-3' : 'text-dark-400'
                  }`}>
                    {entry.position}
                  </td>
                  <td className="table-cell text-left font-medium text-white">
                    {entry.pilot}
                  </td>
                  <td className="table-cell text-center font-mono text-dark-300">
                    {entry.kart}
                  </td>
                  <td className="table-cell text-right font-mono text-dark-200">
                    {entry.lastLap || '—'}
                  </td>
                  {!compact && (
                    <td className="table-cell text-right font-mono text-dark-400 text-xs">
                      {entry.s1 || '—'}
                    </td>
                  )}
                  {!compact && (
                    <td className="table-cell text-right font-mono text-dark-400 text-xs">
                      {entry.s2 || '—'}
                    </td>
                  )}
                  <td className="table-cell text-right font-mono text-green-400 font-semibold">
                    {entry.bestLap || '—'}
                  </td>
                  {!compact && (
                    <td className="table-cell text-right font-mono text-purple-400 text-xs">
                      {entry.bestS1 || '—'}
                    </td>
                  )}
                  {!compact && (
                    <td className="table-cell text-right font-mono text-purple-400 text-xs">
                      {entry.bestS2 || '—'}
                    </td>
                  )}
                  <td className="table-cell text-center font-mono text-dark-400">
                    {entry.lapNumber}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 0 && mode === 'idle' && (
        <div className="px-4 py-12 text-center text-dark-500">
          Таймінг не активний
        </div>
      )}

      {entries.length === 0 && mode !== 'idle' && (
        <div className="px-4 py-12 text-center text-dark-500">
          Завантаження даних...
        </div>
      )}
    </div>
  );
}
