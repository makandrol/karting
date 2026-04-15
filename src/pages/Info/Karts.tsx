import { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';
import { toSeconds, isValidSession } from '../../utils/timing';
import DateNavigator from '../../components/Sessions/DateNavigator';
import SessionsTable from '../../components/Sessions/SessionsTable';

interface KartStat {
  kart: number;
  top5: { pilot: string; lap_time: string; lap_sec: number; ts: number | null }[];
}

interface DbSession {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  real_pilot_count: number | null;
  race_number: number | null;
  date: string;
  best_lap_time: string | null;
  best_lap_pilot: string | null;
}

const LS_DISABLED_KARTS = 'karting_disabled_karts';
const LS_KARTS_FILTERS = 'karting_karts_filters';
const LS_KARTS_SELECTED_DATES = 'karting_karts_selected_dates';

function loadDisabledKarts(): Set<number> {
  try { const s = localStorage.getItem(LS_DISABLED_KARTS); if (s) return new Set(JSON.parse(s)); } catch {} return new Set();
}
function loadFilters() {
  try { const s = localStorage.getItem(LS_KARTS_FILTERS); if (s) return JSON.parse(s); } catch {} return null;
}
function loadSelectedDates(): Set<string> {
  try {
    const s = localStorage.getItem(LS_KARTS_SELECTED_DATES);
    if (s) {
      const { value, expiresAt } = JSON.parse(s);
      if (expiresAt && Date.now() > expiresAt) { localStorage.removeItem(LS_KARTS_SELECTED_DATES); return new Set(); }
      if (Array.isArray(value)) return new Set(value);
      if (Array.isArray(JSON.parse(s))) return new Set(JSON.parse(s));
    }
  } catch {} return new Set();
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}, ${hh}:${min}`;
}
function shortPilot(name: string): string {
  const p = name.trim().split(' ').filter(Boolean);
  return p.length < 2 ? p[0] || name : `${p[0]} ${p[1][0]}.`;
}

export default function Karts() {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => loadFilters()?.viewMode || 'list');
  const [sortByRank, setSortByRank] = useState(() => loadFilters()?.sortByRank ?? true);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [topNInput, setTopNInput] = useState(() => String(loadFilters()?.topN ?? 1));
  const [topNPrev, setTopNPrev] = useState(() => String(loadFilters()?.topN ?? 1));
  const [topN, setTopN] = useState(() => loadFilters()?.topN ?? 1);
  const [showDisabled, setShowDisabled] = useState(() => loadFilters()?.showDisabled ?? false);

  useEffect(() => {
    localStorage.setItem(LS_KARTS_FILTERS, JSON.stringify({ viewMode, sortByRank, topN, showDisabled }));
  }, [viewMode, sortByRank, topN, showDisabled]);

  // Selected dates for stats (multi-select)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => {
    const saved = loadSelectedDates();
    return saved.size > 0 ? saved : new Set([todayStr]);
  });

  useEffect(() => {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    localStorage.setItem(LS_KARTS_SELECTED_DATES, JSON.stringify({ value: [...selectedDates], expiresAt: endOfDay.getTime() }));
  }, [selectedDates]);

  const handleToggleDate = useCallback((date: string) => {
    setSelectedDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }, []);

  const handleSelectDates = useCallback((dates: string[]) => {
    setSelectedDates(prev => {
      const next = new Set(prev);
      for (const d of dates) next.add(d);
      return next;
    });
  }, []);

  const clearAllDates = useCallback(() => {
    setSelectedDates(new Set());
  }, []);

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
          const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`);
          if (res.ok) {
            const data: DbSession[] = await res.json();
            allSessions.push(...data.filter(s => s.end_time && isValidSession(s)));
          }
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
    fetch(`${COLLECTOR_URL}/db/kart-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: [...statSessionIds] }),
    })
      .then(r => r.json())
      .then(setKartStats)
      .catch(() => setKartStats([]))
      .finally(() => setLoading(false));
  }, [statSessionIds]);

  const [disabledKarts, setDisabledKarts] = useState<Set<number>>(loadDisabledKarts);
  useEffect(() => { localStorage.setItem(LS_DISABLED_KARTS, JSON.stringify([...disabledKarts])); }, [disabledKarts]);
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
