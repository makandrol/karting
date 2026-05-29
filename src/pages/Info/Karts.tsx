import { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, type DbSession } from '../../services/api';
import { toSeconds, isValidSession } from '../../utils/timing';
import { fmtTimeShort as fmtTime, fmtDateTimeShort as fmtDate, fmtDateISO } from '../../utils/datetime';
import { useLocalStorage } from '../../services/useLocalStorage';
import DateNavigator from '../../components/Sessions/DateNavigator';
import SessionsTable from '../../components/Sessions/SessionsTable';

interface KartStat {
  kart: number;
  top5: { pilot: string; lap_time: string; lap_sec: number; ts: number | null }[];
}

interface KartsFilters {
  viewMode: 'list' | 'grid';
  sortByRank: boolean;
  topN: number;
  showDisabled: boolean;
}

const DEFAULT_FILTERS: KartsFilters = {
  viewMode: 'list',
  sortByRank: true,
  topN: 1,
  showDisabled: false,
};

function shortPilot(name: string): string {
  const p = name.trim().split(' ').filter(Boolean);
  return p.length < 2 ? p[0] || name : `${p[0]} ${p[1][0]}.`;
}

export default function Karts() {
  const [filters, setFilters] = useLocalStorage<KartsFilters>('karting_karts_filters', DEFAULT_FILTERS);
  const { viewMode, sortByRank, topN, showDisabled } = filters;
  const setViewMode = (v: 'list' | 'grid') => setFilters(f => ({ ...f, viewMode: v }));
  const setSortByRank = (v: boolean | ((p: boolean) => boolean)) =>
    setFilters(f => ({ ...f, sortByRank: typeof v === 'function' ? v(f.sortByRank) : v }));
  const setTopN = (v: number) => setFilters(f => ({ ...f, topN: v }));
  const setShowDisabled = (v: boolean | ((p: boolean) => boolean)) =>
    setFilters(f => ({ ...f, showDisabled: typeof v === 'function' ? v(f.showDisabled) : v }));

  const todayStr = fmtDateISO(new Date());
  const [topNInput, setTopNInput] = useState(() => String(filters.topN));
  const [topNPrev, setTopNPrev] = useState(() => String(filters.topN));

  // Selected dates for stats (multi-select), end-of-day expiry, default = today.
  const [selectedDatesArr, setSelectedDatesArr] = useLocalStorage<string[]>(
    'karting_karts_selected_dates',
    [todayStr],
    { endOfDayExpiry: true },
  );
  const selectedDates = useMemo(() => new Set(selectedDatesArr), [selectedDatesArr]);

  const handleToggleDate = useCallback((date: string) => {
    setSelectedDatesArr(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return [...next];
    });
  }, [setSelectedDatesArr]);

  const handleSelectDates = useCallback((dates: string[]) => {
    setSelectedDatesArr(prev => {
      const next = new Set(prev);
      for (const d of dates) next.add(d);
      return [...next];
    });
  }, [setSelectedDatesArr]);

  const clearAllDates = useCallback(() => {
    setSelectedDatesArr([]);
  }, [setSelectedDatesArr]);

  // Fetch session IDs for all selected dates
  const [statSessionIds, setStatSessionIds] = useState<Set<string>>(new Set());
  const [statSessionDetails, setStatSessionDetails] = useState<DbSession[]>([]);

  useEffect(() => {
    if (selectedDates.size === 0) {
      setStatSessionIds(new Set());
      setStatSessionDetails([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const allSessions: DbSession[] = [];
      for (const date of selectedDates) {
        try {
          const data = await api.sessions.byDate(date);
          allSessions.push(...(data as unknown as DbSession[]).filter(s => s.end_time && isValidSession(s)));
        } catch {}
      }
      if (cancelled) return;
      setStatSessionIds(new Set(allSessions.map(s => s.id)));
      setStatSessionDetails(allSessions);
    })();
    return () => { cancelled = true; };
  }, [selectedDates]);

  // Kart stats from selected sessions
  const [kartStats, setKartStats] = useState<KartStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (statSessionIds.size === 0) { setKartStats([]); return; }
    setLoading(true);
    api.karts.statsBySessions([...statSessionIds])
      .then(setKartStats)
      .catch(() => setKartStats([]))
      .finally(() => setLoading(false));
  }, [statSessionIds]);

  const [disabledKartsArr, setDisabledKartsArr] = useLocalStorage<number[]>('karting_disabled_karts', []);
  const disabledKarts = useMemo(() => new Set(disabledKartsArr), [disabledKartsArr]);
  const setDisabledKarts = (next: Set<number>) => setDisabledKartsArr([...next]);
  const toggleKartDisabled = (num: number) => {
    const next = new Set(disabledKarts); next.has(num) ? next.delete(num) : next.add(num); setDisabledKarts(next);
  };

  const kartRanking = useMemo(() => {
    const ranked = kartStats
      .filter(k => !disabledKarts.has(k.kart) && k.top5.length > 0)
      .map(k => {
        const topLaps = k.top5.slice(0, topN);
        const avg = topLaps.length > 0 ? topLaps.reduce((s, l) => s + l.lap_sec, 0) / topLaps.length : Infinity;
        return { number: k.kart, avg };
      })
      .sort((a, b) => a.avg - b.avg);
    const map = new Map<number, number>();
    ranked.forEach((k, i) => map.set(k.number, i + 1));
    return map;
  }, [kartStats, disabledKarts, topN]);

  const activeKartsRaw = kartStats.filter(k => !disabledKarts.has(k.kart));
  const activeKarts = sortByRank
    ? [...activeKartsRaw].sort((a, b) => (kartRanking.get(a.kart) ?? 999) - (kartRanking.get(b.kart) ?? 999))
    : activeKartsRaw;
  const inactiveKarts = kartStats.filter(k => disabledKarts.has(k.kart));

  return (
    <div className="space-y-6">
      {/* Date multi-select */}
      <DateNavigator
        selectedDate={todayStr}
        onSelectDate={handleToggleDate}
        selectedDates={selectedDates}
        onToggleDate={handleToggleDate}
        onSelectDates={handleSelectDates}
      />

      {/* Stat summary */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Статистика: {selectedDates.size} {selectedDates.size === 1 ? 'день' : selectedDates.size < 5 ? 'дні' : 'днів'}, {statSessionIds.size} заїздів
            {loading && <span className="text-dark-600 ml-2">завантаження...</span>}
          </div>
          {selectedDates.size > 0 && (
            <button onClick={clearAllDates}
              className="text-red-400/60 text-[10px] hover:text-red-400 transition-colors">очистити</button>
          )}
        </div>
        {statSessionDetails.length > 0 && (
          <div className="max-h-48 overflow-y-auto">
            <SessionsTable sessions={statSessionDetails} showDate />
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
              Рейтинг по
              <input type="text" inputMode="numeric" value={topNInput}
                onChange={e => setTopNInput(e.target.value.replace(/\D/g, ''))}
                onFocus={() => setTopNPrev(topNInput)}
                onBlur={() => { const v = parseInt(topNInput); if (!v || v < 1) { setTopNInput(topNPrev); return; } setTopN(v); }}
                className="w-8 bg-dark-800 border border-dark-700 text-white rounded px-1 py-0.5 outline-none focus:border-primary-500 text-[10px] text-center" />
              кіл
            </label>
            <span className="text-dark-700">|</span>
            <div className="flex bg-dark-800 rounded-md p-0.5">
              <button onClick={() => setSortByRank(true)} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortByRank ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по швидкості</button>
              <button onClick={() => setSortByRank(false)} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${!sortByRank ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по номеру</button>
            </div>
            <span className="text-dark-700">|</span>
            <div className="flex bg-dark-800 rounded-md p-0.5">
              <button onClick={() => setViewMode('list')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>☰ список</button>
              <button onClick={() => setViewMode('grid')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${viewMode === 'grid' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>▦ таблиця</button>
            </div>
            <span className="text-dark-700">|</span>
            <button onClick={() => setDisabledKarts(new Set())} className="text-dark-400 text-[10px] hover:text-white transition-colors">показати всі</button>
            <span className="text-dark-700">|</span>
            <button onClick={() => setShowDisabled((v: boolean) => !v)} className="text-dark-400 text-[10px] hover:text-white transition-colors">
              {showDisabled ? 'сховати неактивні' : 'показати неактивні'}
            </button>
          </div>
        </div>

        {viewMode === 'list' ? (
          <>
            <div className="divide-y divide-dark-800/50">
              {activeKarts.map(kart => (
                <KartRow key={kart.kart} kart={kart} rank={kartRanking.get(kart.kart)} onDisable={() => toggleKartDisabled(kart.kart)} disabled={false} />
              ))}
            </div>
            {showDisabled && inactiveKarts.length > 0 && (
              <div className="mt-3 opacity-50">
                <div className="text-dark-500 text-[10px] uppercase tracking-wider px-1 pb-1">Неактивні</div>
                <div className="divide-y divide-dark-800/50">
                  {inactiveKarts.map(kart => (
                    <KartRow key={kart.kart} kart={kart} rank={undefined} onDisable={() => toggleKartDisabled(kart.kart)} disabled />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {activeKarts.map(kart => (
                <KartCard key={kart.kart} kart={kart} disabled={false} rank={kartRanking.get(kart.kart)} onDisable={() => toggleKartDisabled(kart.kart)} />
              ))}
            </div>
            {showDisabled && inactiveKarts.length > 0 && (
              <div className="mt-3 opacity-50">
                <div className="text-dark-500 text-[10px] uppercase tracking-wider px-1 pb-2">Неактивні</div>
                <div className="grid grid-cols-3 gap-2">
                  {inactiveKarts.map(kart => (
                    <KartCard key={kart.kart} kart={kart} disabled rank={undefined} onDisable={() => toggleKartDisabled(kart.kart)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function KartRow({ kart, onDisable, disabled, rank }: { kart: KartStat; onDisable: () => void; disabled: boolean; rank?: number }) {
  const top3 = kart.top5.slice(0, 3);
  return (
    <div className="flex items-start group">
      <Link to={`/info/karts/${kart.kart}`} className="flex-1 flex items-start gap-4 px-3 py-2 rounded-lg hover:bg-dark-700/50 transition-colors">
        <span className={`text-sm w-24 shrink-0 pt-0.5 ${disabled ? 'text-dark-600' : 'text-dark-300'}`}>
          Карт {kart.kart}{rank ? <span className="text-dark-500">, #{rank}</span> : ''}
        </span>
        <div className="flex-1 space-y-0.5">
          {top3.length > 0 ? top3.map((r, idx) => (
            <div key={idx} className="text-xs">
              <span className="font-mono text-green-400">{toSeconds(r.lap_time)}</span>
              <span className="text-dark-500 ml-1.5">— {r.pilot}</span>
              {r.ts && <span className="text-dark-600 ml-1">{fmtDate(r.ts)}</span>}
            </div>
          )) : <div className="text-dark-700 text-xs">—</div>}
        </div>
      </Link>
      <button onClick={onDisable} title={disabled ? 'Активувати' : 'Деактивувати'}
        className={`px-2 py-2 text-[10px] rounded transition-colors shrink-0 ${disabled ? 'text-green-400/50 hover:text-green-400' : 'text-dark-700 hover:text-red-400'}`}>
        {disabled ? '✓' : '✕'}
      </button>
    </div>
  );
}

function KartCard({ kart, disabled, onDisable, rank }: { kart: KartStat; disabled: boolean; onDisable: () => void; rank?: number }) {
  const top3 = kart.top5.slice(0, 3);
  return (
    <Link to={`/info/karts/${kart.kart}`}
      className={`relative block rounded-xl border p-3 transition-colors ${disabled ? 'border-dark-800 bg-dark-900/50' : 'border-dark-700 bg-dark-800/50 hover:border-dark-600 hover:bg-dark-700/50'}`}>
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDisable(); }}
        className={`absolute top-1 right-1 text-[10px] px-1 rounded transition-colors ${disabled ? 'text-green-400/50 hover:text-green-400' : 'text-dark-700 hover:text-red-400'}`}>
        {disabled ? '✓' : '✕'}
      </button>
      <div className="text-center mb-2">
        <span className={`font-mono font-bold text-2xl ${disabled ? 'text-dark-600' : 'text-white'}`}>{kart.kart}</span>
        {rank && <span className="text-dark-500 text-sm ml-1">#{rank}</span>}
      </div>
      <div className="space-y-1">
        {top3.length > 0 ? top3.map((r, idx) => (
          <div key={idx} className="text-[10px] text-center leading-snug">
            <span className="font-mono text-green-400">{toSeconds(r.lap_time)}</span>
            <span className="text-dark-500"> — {r.pilot}</span>
            {r.ts && <span className="text-dark-600"> {fmtDate(r.ts)}</span>}
          </div>
        )) : <div className="text-dark-700 text-[10px] text-center">—</div>}
      </div>
    </Link>
  );
}
