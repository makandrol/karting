import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TimingEntry } from '../../types';
import type { TimingMode } from '../../services/timingPoller';
import { parseTime, getTimeColor, COLOR_CLASSES, KART_COLOR, type TimeColor } from '../../utils/timing';

interface TimingBoardProps {
  entries: TimingEntry[];
  mode: TimingMode;
  lastUpdate: number | null;
  compact?: boolean;
}

export type SortMode = 'race' | 'qualifying';

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
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    try { const s = localStorage.getItem('karting_board_sort'); if (s === 'race' || s === 'qualifying') return s; } catch {} return 'qualifying';
  });

  const updateSortMode = (m: SortMode) => { setSortMode(m); localStorage.setItem('karting_board_sort', m); };

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
          <span className="text-dark-500 text-[10px]">Режим:</span>
          <div className="flex bg-dark-800 rounded-md p-0.5">
            <button
              onClick={() => updateSortMode('qualifying')}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ${
                sortMode === 'qualifying' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              ⏱️ Квала
            </button>
            <button
              onClick={() => updateSortMode('race')}
              className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ${
                sortMode === 'race' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              🏁 Гонка
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

      {/* Table — always show headers */}
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
              <th className="table-cell w-8"></th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.length > 0 ? sortedEntries.map((entry) => {
                const lastLapColor = getTimeColor(entry.lastLap, entry.bestLap, overallBestLap);
                const s1Color = getTimeColor(entry.s1, entry.bestS1, overallBestS1);
                const s2Color = getTimeColor(entry.s2, entry.bestS2, overallBestS2);
                const bestLapColor = getTimeColor(entry.bestLap, entry.bestLap, overallBestLap);
                const bestS1Color = getTimeColor(entry.bestS1, entry.bestS1, overallBestS1);
                const bestS2Color = getTimeColor(entry.bestS2, entry.bestS2, overallBestS2);

                return (
                  <tr key={`${entry.pilot}-${entry.kart}`} className="table-row">
                    <td className="table-cell text-center font-mono font-bold text-sm text-white">
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
                    <td className={`table-cell text-center font-mono ${KART_COLOR} text-sm`}>
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
                    <td className="table-cell text-center w-8 px-1">
                      <Link
                        to={`/onboard/${entry.kart}`}
                        className="text-dark-600 hover:text-primary-400 transition-colors"
                        title="Onboard"
                      >
                        <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={compact ? 6 : 11} className="table-cell text-center text-dark-500 py-8">
                    Очікування пілотів на трасі...
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
