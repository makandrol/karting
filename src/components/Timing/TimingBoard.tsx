import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TimingEntry } from '../../types';
import type { TimingMode } from '../../services/timingPoller';

interface TimingBoardProps {
  entries: TimingEntry[];
  mode: TimingMode;
  lastUpdate: number | null;
  compact?: boolean;
}

export type SortMode = 'race' | 'qualifying';

/** Парсить час "39.800", "1:02.222", "00:42.123" або "14.500" в секунди */
function parseTime(t: string | null): number | null {
  if (!t) return null;
  const lapMatch = t.match(/^(\d+):(\d+\.\d+)$/);
  if (lapMatch) return parseInt(lapMatch[1]) * 60 + parseFloat(lapMatch[2]);
  const secMatch = t.match(/^\d+\.\d+$/);
  if (secMatch) return parseFloat(t);
  return null;
}

type TimeColor = 'purple' | 'green' | 'yellow' | 'none';

function getTimeColor(value: string | null, personalBest: string | null, overallBest: number | null): TimeColor {
  const val = parseTime(value);
  if (val === null) return 'none';
  if (overallBest !== null && Math.abs(val - overallBest) < 0.002) return 'purple';
  const pb = parseTime(personalBest);
  if (pb !== null && Math.abs(val - pb) < 0.002) return 'green';
  if (pb !== null && val > pb) return 'yellow';
  if (overallBest !== null && val <= overallBest + 0.002) return 'purple';
  return 'green';
}

const COLOR_CLASSES: Record<TimeColor, string> = {
  purple: 'text-purple-400',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  none: 'text-dark-500',
};

/**
 * Сортування в режимі гонки:
 * 1. Більше кіл = вище
 * 2. При однаковій к-сті кіл — хто далі по трасі (більший progress) = вище
 * 3. Враховується S1: хто пройшов S1 — далі ніж хто не пройшов
 */
function sortRaceMode(entries: TimingEntry[]): TimingEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // Більше кіл = вище
    if (a.lapNumber !== b.lapNumber) return b.lapNumber - a.lapNumber;
    // Однакова к-сть кіл — хто далі по трасі
    const aProgress = a.progress ?? 0;
    const bProgress = b.progress ?? 0;
    return bProgress - aProgress;
  });
  return sorted.map((e, i) => ({ ...e, position: i + 1 }));
}

/**
 * Сортування в режимі кваліфікації:
 * По найкращому часу кола (bestLap)
 */
function sortQualifyingMode(entries: TimingEntry[]): TimingEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const aTime = parseTime(a.bestLap);
    const bTime = parseTime(b.bestLap);
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return aTime - bTime;
  });
  return sorted.map((e, i) => ({ ...e, position: i + 1 }));
}

export default function TimingBoard({ entries, mode, lastUpdate, compact = false }: TimingBoardProps) {
  const [sortMode, setSortMode] = useState<SortMode>('qualifying');

  const formatTime = (ts: number | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('uk-UA');
  };

  // Сортуємо entries по вибраному режиму
  const sortedEntries = useMemo(() => {
    if (sortMode === 'race') return sortRaceMode(entries);
    return sortQualifyingMode(entries);
  }, [entries, sortMode]);

  // Абсолютно найкращі часи
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
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dark-800">
        <div className="flex items-center gap-3">
          {mode === 'live' ? (
            <span className="badge-live">
              <span className="w-2 h-2 bg-green-400 rounded-full mr-1.5 animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="badge-offline">OFFLINE</span>
          )}
          {lastUpdate && (
            <span className="text-dark-500 text-xs">
              {formatTime(lastUpdate)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Sort mode toggle */}
          <div className="flex bg-dark-800 rounded-md p-0.5">
            <button
              onClick={() => setSortMode('race')}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ${
                sortMode === 'race' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              🏁 Гонка
            </button>
            <button
              onClick={() => setSortMode('qualifying')}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ${
                sortMode === 'qualifying' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              ⏱️ Квала
            </button>
          </div>

          {/* Color legend */}
          <div className="hidden sm:flex items-center gap-2 text-[10px]">
            <span className="text-purple-400">■ Best</span>
            <span className="text-green-400">■ PB</span>
            <span className="text-yellow-400">■ Slow</span>
          </div>
        </div>
      </div>

      {/* Table */}
      {sortedEntries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-center w-10">#</th>
                <th className="table-cell text-left min-w-[160px]">Пілот</th>
                <th className="table-cell text-center w-12">Карт</th>
                <th className="table-cell text-right">Коло</th>
                {!compact && <th className="table-cell text-right">S1</th>}
                {!compact && <th className="table-cell text-right">S2</th>}
                <th className="table-cell text-right">Найкраще</th>
                {!compact && <th className="table-cell text-right">B.S1</th>}
                {!compact && <th className="table-cell text-right">B.S2</th>}
                <th className="table-cell text-center w-10">Л</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => {
                const lastLapColor = getTimeColor(entry.lastLap, entry.bestLap, overallBestLap);
                const s1Color = getTimeColor(entry.s1, entry.bestS1, overallBestS1);
                const s2Color = getTimeColor(entry.s2, entry.bestS2, overallBestS2);
                const bestLapColor = getTimeColor(entry.bestLap, entry.bestLap, overallBestLap);
                const bestS1Color = getTimeColor(entry.bestS1, entry.bestS1, overallBestS1);
                const bestS2Color = getTimeColor(entry.bestS2, entry.bestS2, overallBestS2);

                return (
                  <tr key={`${entry.pilot}-${entry.kart}`} className="table-row">
                    <td className={`table-cell text-center font-mono font-bold text-sm ${
                      entry.position === 1 ? 'position-1' :
                      entry.position === 2 ? 'position-2' :
                      entry.position === 3 ? 'position-3' : 'text-dark-400'
                    }`}>
                      {entry.position}
                    </td>
                    <td className="table-cell text-left py-2">
                      <div className="font-medium text-sm leading-tight">
                        <Link
                          to={`/pilots/${encodeURIComponent(entry.pilot)}`}
                          className="text-white hover:text-primary-400 transition-colors"
                        >
                          {entry.pilot}
                        </Link>
                        {entry.currentLapSec !== null && (
                          <span className="text-dark-600 text-[10px] ml-1 font-mono">
                            ({entry.currentLapSec.toFixed(1)}s)
                          </span>
                        )}
                      </div>
                      {entry.progress !== null && (
                        <div className="mt-1 h-[3px] w-full bg-dark-800 rounded-full overflow-hidden">
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
                    <td className="table-cell text-center font-mono text-dark-300 text-sm">
                      <Link
                        to={`/info/karts/${entry.kart}`}
                        className="hover:text-primary-400 transition-colors"
                      >
                        {entry.kart}
                      </Link>
                    </td>
                    <td className={`table-cell text-right font-mono text-sm font-semibold ${COLOR_CLASSES[lastLapColor]}`}>
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
                    <td className={`table-cell text-right font-mono text-sm font-semibold ${COLOR_CLASSES[bestLapColor]}`}>
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
                    <td className="table-cell text-center font-mono text-dark-400 text-sm">
                      {entry.lapNumber}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 0 && (mode === 'idle' || mode === 'connecting') && (
        <div className="px-4 py-12 text-center text-dark-500">Таймінг не активний</div>
      )}
      {entries.length === 0 && mode !== 'idle' && (
        <div className="px-4 py-12 text-center text-dark-500">Завантаження даних...</div>
      )}
    </div>
  );
}
