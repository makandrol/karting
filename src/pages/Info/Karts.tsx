import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';
import { toSeconds } from '../../utils/timing';
import { fmtDateTimeShort as fmtDate } from '../../utils/datetime';
import { useLocalStorage } from '../../services/useLocalStorage';
import { useKartFilters, useSelectedDateSessions } from '../../services/useKartFilters';
import DateNavigator from '../../components/Sessions/DateNavigator';
import SessionsTable from '../../components/Sessions/SessionsTable';
import TrackFilter from '../../components/Sessions/TrackFilter';

interface KartStat {
  kart: number;
  top5: {
    pilot: string;
    lap_time: string | null;
    lap_sec: number | null;
    s1: string | null;
    s2: string | null;
    ts: number | null;
    tb_s1: string | null;
    tb_s2: string | null;
    tb_sec: number | null;
  }[];
}

type SortMode = 'best' | 'tb' | 'number';

interface KartsFilters {
  sortMode: SortMode;
  topN: number;
  displayLaps: number;
  showDisabled: boolean;
}

const DEFAULT_FILTERS: KartsFilters = {
  sortMode: 'best',
  topN: 1,
  displayLaps: 3,
  showDisabled: false,
};

export default function Karts() {
  const [filters, setFilters] = useLocalStorage<KartsFilters>('karting_karts_filters', DEFAULT_FILTERS);
  const { topN, showDisabled } = filters;
  // Fallback на дефолт для користувачів зі старим збереженим стейтом без цих полів.
  const displayLaps = filters.displayLaps ?? DEFAULT_FILTERS.displayLaps;
  const sortMode: SortMode = filters.sortMode ?? DEFAULT_FILTERS.sortMode;
  const setSortMode = (v: SortMode) => setFilters(f => ({ ...f, sortMode: v }));
  const setTopN = (v: number) => setFilters(f => ({ ...f, topN: v }));
  const setDisplayLaps = (v: number) => setFilters(f => ({ ...f, displayLaps: v }));
  const setShowDisabled = (v: boolean | ((p: boolean) => boolean)) =>
    setFilters(f => ({ ...f, showDisabled: typeof v === 'function' ? v(f.showDisabled) : v }));

  const [topNInput, setTopNInput] = useState(() => String(filters.topN));
  const [topNPrev, setTopNPrev] = useState(() => String(filters.topN));
  const [displayLapsInput, setDisplayLapsInput] = useState(() => String(filters.displayLaps ?? DEFAULT_FILTERS.displayLaps));
  const [displayLapsPrev, setDisplayLapsPrev] = useState(() => String(filters.displayLaps ?? DEFAULT_FILTERS.displayLaps));

  const {
    todayStr,
    selectedDates, toggleDate: handleToggleDate, selectDates: handleSelectDates, clearDates: clearAllDates,
    selectedTracks, trackFilter, toggleTrack, selectAllTracks, clearAllTracks,
    excludedSessions, toggleExcludeSession,
  } = useKartFilters();

  // Сесії вибраних днів (raw, без фільтра трас) — спільний хук.
  const { sessions: statSessionDetails } = useSelectedDateSessions(selectedDates);

  // Заїзди вибраних днів на вибраних трасах (для таблиці).
  const visibleSessions = useMemo(
    () => statSessionDetails.filter(s => selectedTracks.has(s.track_id || 1)),
    [statSessionDetails, selectedTracks],
  );

  // ID заїздів для статистики: на вибраних трасах та не виключені вручну.
  const statSessionIds = useMemo(
    () => new Set(visibleSessions.filter(s => !excludedSessions.has(s.id)).map(s => s.id)),
    [visibleSessions, excludedSessions],
  );
  // Стабільний ключ для повторних запитів статистики (sorted ids).
  const statSessionsKey = useMemo(() => [...statSessionIds].sort().join(','), [statSessionIds]);

  // Kart stats from selected sessions
  const [kartStats, setKartStats] = useState<KartStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = statSessionsKey ? statSessionsKey.split(',') : [];
    if (ids.length === 0) { setKartStats([]); return; }
    setLoading(true);
    api.karts.statsBySessions(ids)
      .then(setKartStats)
      .catch(() => setKartStats([]))
      .finally(() => { setLoading(false); });
  }, [statSessionsKey]);

  const [disabledKartsArr, setDisabledKartsArr] = useLocalStorage<number[]>('karting_disabled_karts', []);
  const disabledKarts = useMemo(() => new Set(disabledKartsArr), [disabledKartsArr]);
  const setDisabledKarts = (next: Set<number>) => setDisabledKartsArr([...next]);
  const toggleKartDisabled = (num: number) => {
    const next = new Set(disabledKarts); next.has(num) ? next.delete(num) : next.add(num); setDisabledKarts(next);
  };

  // Метрика для рейтингу/сортування: lap_sec для 'best', tb_sec для 'tb'.
  const metricOf = (l: KartStat['top5'][number]) =>
    sortMode === 'tb' ? (l.tb_sec ?? Infinity) : (l.lap_sec ?? Infinity);

  // top5 пілотів, відсортований за активною метрикою (для TB порядок інший).
  const sortedTop = (k: KartStat) =>
    [...k.top5].sort((a, b) => metricOf(a) - metricOf(b));

  const kartRanking = useMemo(() => {
    const metric = (l: KartStat['top5'][number]) =>
      sortMode === 'tb' ? (l.tb_sec ?? Infinity) : (l.lap_sec ?? Infinity);
    const ranked = kartStats
      .filter(k => !disabledKarts.has(k.kart) && k.top5.length > 0)
      .map(k => {
        const topLaps = [...k.top5].sort((a, b) => metric(a) - metric(b)).slice(0, topN);
        const avg = topLaps.length > 0 ? topLaps.reduce((s, l) => s + metric(l), 0) / topLaps.length : Infinity;
        return { number: k.kart, avg };
      })
      .sort((a, b) => a.avg - b.avg);
    const map = new Map<number, number>();
    ranked.forEach((k, i) => map.set(k.number, i + 1));
    return map;
  }, [kartStats, disabledKarts, topN, sortMode]);

  const activeKartsRaw = kartStats.filter(k => !disabledKarts.has(k.kart));
  const activeKarts = sortMode === 'number'
    ? activeKartsRaw
    : [...activeKartsRaw].sort((a, b) => (kartRanking.get(a.kart) ?? 999) - (kartRanking.get(b.kart) ?? 999));
  const inactiveKarts = kartStats.filter(k => disabledKarts.has(k.kart));
  // У режимах рейтингу (best/tb) карти йдуть #1, #2... тож номер ранку зайвий.
  const showRankBadge = sortMode === 'number';

  return (
    <div className="space-y-6">
      {/* Track filter */}
      <TrackFilter
        selected={selectedTracks}
        onToggle={toggleTrack}
        onSelectAll={selectAllTracks}
        onClearAll={clearAllTracks}
      />

      {/* Date multi-select */}
      <DateNavigator
        selectedDate={todayStr}
        onSelectDate={handleToggleDate}
        selectedDates={selectedDates}
        onToggleDate={handleToggleDate}
        onSelectDates={handleSelectDates}
        trackFilter={trackFilter}
      />

      {/* Stat summary */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Статистика: {selectedDates.size} {selectedDates.size === 1 ? 'день' : selectedDates.size < 5 ? 'дні' : 'днів'}, {statSessionIds.size} заїздів
            {excludedSessions.size > 0 && visibleSessions.length > 0 && (
              <span className="text-dark-600 ml-1 normal-case">({excludedSessions.size} прибрано)</span>
            )}
            {loading && <span className="text-dark-600 ml-2">завантаження...</span>}
          </div>
          {selectedDates.size > 0 && (
            <button onClick={clearAllDates}
              className="text-red-400/60 text-[10px] hover:text-red-400 transition-colors">очистити</button>
          )}
        </div>
        {visibleSessions.length > 0 && (
          <div className="max-h-48 overflow-y-auto">
            <SessionsTable
              sessions={visibleSessions}
              showDate
              excludedIds={excludedSessions}
              onToggleExclude={toggleExcludeSession}
            />
          </div>
        )}
      </div>

      {/* Kart list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Карти ({activeKarts.length} активних{inactiveKarts.length > 0 ? `, ${inactiveKarts.length} прихованих` : ''})
          </div>
          <div className="flex items-center gap-2">
            <label className="text-dark-400 text-[10px] flex items-center gap-1">
              <input type="text" inputMode="numeric" value={displayLapsInput}
                onChange={e => setDisplayLapsInput(e.target.value.replace(/\D/g, ''))}
                onFocus={() => setDisplayLapsPrev(displayLapsInput)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={() => { const v = parseInt(displayLapsInput); if (!v || v < 1) { setDisplayLapsInput(displayLapsPrev); return; } setDisplayLaps(v); }}
                className="w-8 bg-dark-800 border border-dark-700 text-white rounded px-1 py-0.5 outline-none focus:border-primary-500 text-[10px] text-center" />
              пілотів
            </label>
            <span className="text-dark-700">|</span>
            <label className="text-dark-400 text-[10px] flex items-center gap-1">
              <input type="text" inputMode="numeric" value={topNInput}
                onChange={e => setTopNInput(e.target.value.replace(/\D/g, ''))}
                onFocus={() => setTopNPrev(topNInput)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={() => { const v = parseInt(topNInput); if (!v || v < 1) { setTopNInput(topNPrev); return; } setTopN(v); }}
                className="w-8 bg-dark-800 border border-dark-700 text-white rounded px-1 py-0.5 outline-none focus:border-primary-500 text-[10px] text-center" />
              best laps
            </label>
            <span className="text-dark-700">|</span>
            <div className="flex bg-dark-800 rounded-md p-0.5">
              <button onClick={() => setSortMode('best')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortMode === 'best' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>Best lap</button>
              <button onClick={() => setSortMode('tb')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortMode === 'tb' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>TB</button>
              <button onClick={() => setSortMode('number')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortMode === 'number' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по номеру</button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-dark-800/50">
          {activeKarts.map(kart => (
            <KartRow key={kart.kart} kart={kart} rank={showRankBadge ? kartRanking.get(kart.kart) : undefined}
              onDisable={() => toggleKartDisabled(kart.kart)} disabled={false} displayLaps={displayLaps}
              sortMode={sortMode} laps={sortedTop(kart)} />
          ))}
        </div>
        {showDisabled && inactiveKarts.length > 0 && (
          <div className="mt-3 opacity-50">
            <div className="text-dark-500 text-[10px] uppercase tracking-wider px-1 pb-1">Неактивні</div>
            <div className="divide-y divide-dark-800/50">
              {inactiveKarts.map(kart => (
                <KartRow key={kart.kart} kart={kart} rank={undefined}
                  onDisable={() => toggleKartDisabled(kart.kart)} disabled displayLaps={displayLaps}
                  sortMode={sortMode} laps={sortedTop(kart)} />
              ))}
            </div>
          </div>
        )}

        {/* Controls under the list */}
        <div className="flex items-center justify-end gap-2 mt-3">
          <button onClick={() => setDisabledKarts(new Set())} className="text-dark-400 text-[10px] hover:text-white transition-colors">показати всі</button>
          <span className="text-dark-700">|</span>
          <button onClick={() => setShowDisabled((v: boolean) => !v)} className="text-dark-400 text-[10px] hover:text-white transition-colors">
            {showDisabled ? 'сховати неактивні' : 'показати неактивні'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KartRow({ kart, onDisable, disabled, rank, displayLaps, sortMode, laps }: {
  kart: KartStat; onDisable: () => void; disabled: boolean; rank?: number; displayLaps: number;
  sortMode: SortMode; laps: KartStat['top5'];
}) {
  const top = laps.slice(0, displayLaps);
  const useTB = sortMode === 'tb';
  return (
    <div className="flex items-start group">
      <Link to={`/info/karts/${kart.kart}`} className="flex-1 flex items-start gap-4 px-3 py-2 rounded-lg hover:bg-dark-700/50 transition-colors">
        <span className={`text-sm w-24 shrink-0 pt-0.5 ${disabled ? 'text-dark-600' : 'text-dark-300'}`}>
          Карт {kart.kart}{rank ? <span className="text-dark-500">, #{rank}</span> : ''}
        </span>
        <div className="flex-1 space-y-0.5">
          {top.length > 0 ? top.map((r, idx) => {
            const time = useTB ? (r.tb_sec != null ? r.tb_sec.toFixed(3) : null) : r.lap_time;
            const s1 = useTB ? r.tb_s1 : r.s1;
            const s2 = useTB ? r.tb_s2 : r.s2;
            return (
              <div key={idx} className="text-xs">
                <span className="font-mono text-green-400">{time ? toSeconds(time) : '—'}</span>
                {(s1 || s2) && (
                  <span className="font-mono text-dark-500 ml-1">- {s1 ? toSeconds(s1) : '—'}, {s2 ? toSeconds(s2) : '—'}</span>
                )}
                <span className="text-dark-500 ml-1.5">— {r.pilot}</span>
                {r.ts && <span className="text-dark-600 ml-1">{fmtDate(r.ts)}</span>}
              </div>
            );
          }) : <div className="text-dark-700 text-xs">—</div>}
        </div>
      </Link>
      <button onClick={onDisable} title={disabled ? 'Активувати' : 'Деактивувати'}
        className={`px-2 py-2 text-[10px] rounded transition-colors shrink-0 ${disabled ? 'text-green-400/50 hover:text-green-400' : 'text-dark-700 hover:text-red-400'}`}>
        {disabled ? '✓' : '✕'}
      </button>
    </div>
  );
}
