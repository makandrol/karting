import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { parseTime, toSeconds } from '../../utils/timing';
import DateNavigator from '../../components/Sessions/DateNavigator';

interface KartLap {
  id: number;
  session_id: string;
  pilot: string;
  kart: number;
  lap_number: number;
  lap_time: string;
  s1: string | null;
  s2: string | null;
  best_lap: string | null;
  position: number | null;
  ts: number;
  date: string;
  session_start: number;
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

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shortPilot(name: string): string {
  const p = name.split(' '); return p.length < 2 ? name : `${p[0]} ${p[1][0]}.`;
}

const LS_KART_DETAIL_DATES = 'karting_kart_detail_dates';
function loadSelectedDates(): Set<string> {
  try { const s = localStorage.getItem(LS_KART_DETAIL_DATES); if (s) return new Set(JSON.parse(s)); } catch {} return new Set();
}

export default function KartDetail() {
  const { kartId } = useParams<{ kartId: string }>();
  const kartNumber = parseInt(kartId || '0');
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Selected dates (multi-select, persisted)
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => {
    const saved = loadSelectedDates();
    return saved.size > 0 ? saved : new Set([todayStr]);
  });

  useEffect(() => {
    localStorage.setItem(LS_KART_DETAIL_DATES, JSON.stringify([...selectedDates]));
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

  // Fetch session IDs and details for selected dates
  const [statSessionIds, setStatSessionIds] = useState<Set<string>>(new Set());
  const [statSessionDetails, setStatSessionDetails] = useState<DbSession[]>([]);
  const [laps, setLaps] = useState<KartLap[]>([]);
  const [loading, setLoading] = useState(false);

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
            allSessions.push(...data.filter(s => s.end_time && (s.end_time - s.start_time) >= 60000));
          }
        } catch {}
      }
      if (cancelled) return;
      setStatSessionIds(new Set(allSessions.map(s => s.id)));
      setStatSessionDetails(allSessions);
    })();
    return () => { cancelled = true; };
  }, [selectedDates]);

  // Fetch kart laps for stat sessions
  useEffect(() => {
    if (statSessionIds.size === 0) { setLaps([]); return; }
    setLoading(true);
    const sortedDates = [...selectedDates].sort();
    const from = sortedDates[0] || todayStr;
    const to = sortedDates[sortedDates.length - 1] || todayStr;
    fetch(`${COLLECTOR_URL}/db/laps?kart=${kartNumber}&from=${from}&to=${to}`)
      .then(r => r.json())
      .then((allLaps: KartLap[]) => setLaps(allLaps.filter(l => statSessionIds.has(l.session_id))))
      .catch(() => setLaps([]))
      .finally(() => setLoading(false));
  }, [statSessionIds, kartNumber]);

  const pilotStats = useMemo(() => {
    const map = new Map<string, { pilot: string; bestSec: number; bestTime: string; bestTs: number; lapCount: number; sessions: Set<string> }>();
    for (const l of laps) {
      const sec = parseTime(l.lap_time);
      if (sec === null) continue;
      if (!map.has(l.pilot)) map.set(l.pilot, { pilot: l.pilot, bestSec: Infinity, bestTime: '', bestTs: 0, lapCount: 0, sessions: new Set() });
      const p = map.get(l.pilot)!;
      p.lapCount++; p.sessions.add(l.session_id);
      if (sec < p.bestSec) { p.bestSec = sec; p.bestTime = l.lap_time; p.bestTs = l.ts; }
    }
    return [...map.values()].sort((a, b) => a.bestSec - b.bestSec);
  }, [laps]);

  const sortedLaps = useMemo(() =>
    laps.map(l => ({ ...l, sec: parseTime(l.lap_time) })).filter(l => l.sec !== null).sort((a, b) => a.sec! - b.sec!).slice(0, 50),
  [laps]);

  const overallBest = pilotStats.length > 0 ? pilotStats[0].bestSec : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/info/karts" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Карт {kartNumber}</h1>
          <p className="text-dark-400 text-sm">
            {laps.length} кіл · {pilotStats.length} пілотів
            {overallBest && <> · Рекорд: <span className="text-green-400 font-mono">{toSeconds(pilotStats[0].bestTime)}</span> ({pilotStats[0].pilot})</>}
          </p>
        </div>
      </div>

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
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {statSessionDetails.map(s => (
              <div key={s.id} className="flex items-center justify-between px-2 py-0.5 text-xs text-dark-400">
                <span>
                  <span className="text-dark-300 font-mono">{s.date.slice(5)} {fmtTime(s.start_time)}</span>
                  {s.race_number != null && <span className="text-dark-600 ml-1">#{s.race_number}</span>}
                  <span className="text-dark-600 ml-1">· {s.real_pilot_count ?? s.pilot_count} пілотів</span>
                </span>
                {s.best_lap_time && s.best_lap_pilot && (
                  <span className="text-dark-500 font-mono shrink-0 ml-2">
                    {shortPilot(s.best_lap_pilot)} — <span className="text-green-400">{toSeconds(s.best_lap_time)}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="card text-center py-12 text-dark-500">Завантаження...</div>
      ) : laps.length === 0 ? (
        <div className="card text-center py-12 text-dark-500">Немає даних. Оберіть дні в календарі.</div>
      ) : (
        <>
          {/* Pilots leaderboard */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-800"><h3 className="text-white font-semibold">Пілоти ({pilotStats.length})</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="table-header">
                  <th className="table-cell text-center w-10">#</th><th className="table-cell text-left">Пілот</th>
                  <th className="table-cell text-right">Найкращий</th><th className="table-cell text-center">Дата</th><th className="table-cell text-center">Кіл</th><th className="table-cell text-center">Заїздів</th>
                </tr></thead>
                <tbody>
                  {pilotStats.map((p, i) => (
                    <tr key={p.pilot} className="table-row">
                      <td className={`table-cell text-center font-mono font-bold ${i < 3 ? `position-${i + 1}` : 'text-dark-400'}`}>{i + 1}</td>
                      <td className="table-cell text-left"><Link to={`/pilots/${encodeURIComponent(p.pilot)}`} className="text-white hover:text-primary-400 transition-colors">{p.pilot}</Link></td>
                      <td className={`table-cell text-right font-mono font-semibold ${overallBest && Math.abs(p.bestSec - overallBest) < 0.002 ? 'text-purple-400' : 'text-green-400'}`}>{toSeconds(p.bestTime)}</td>
                      <td className="table-cell text-center text-dark-500 text-[11px]">{p.bestTs ? fmtDate(p.bestTs) : ''}</td>
                      <td className="table-cell text-center font-mono text-dark-300">{p.lapCount}</td>
                      <td className="table-cell text-center font-mono text-dark-300">{p.sessions.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top 50 laps */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-800"><h3 className="text-white font-semibold">Топ 50 кіл</h3></div>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0"><tr className="table-header">
                  <th className="table-cell text-center w-10">#</th><th className="table-cell text-left">Пілот</th>
                  <th className="table-cell text-right">Час</th><th className="table-cell text-right">S1</th><th className="table-cell text-right">S2</th>
                  <th className="table-cell text-left">Дата</th>
                </tr></thead>
                <tbody>
                  {sortedLaps.map((l, i) => (
                    <tr key={l.id} className="table-row">
                      <td className={`table-cell text-center font-mono font-bold ${i < 3 ? `position-${i + 1}` : 'text-dark-400'}`}>{i + 1}</td>
                      <td className="table-cell text-left text-white">{l.pilot}</td>
                      <td className={`table-cell text-right font-mono font-semibold ${i === 0 ? 'text-purple-400' : 'text-green-400'}`}>{toSeconds(l.lap_time)}</td>
                      <td className="table-cell text-right font-mono text-dark-400">{l.s1 ? toSeconds(l.s1) : '—'}</td>
                      <td className="table-cell text-right font-mono text-dark-400">{l.s2 ? toSeconds(l.s2) : '—'}</td>
                      <td className="table-cell text-left text-dark-500">
                        <Link to={`/sessions/${l.session_id}`} className="hover:text-primary-400 transition-colors">{l.date} {fmtTime(l.session_start)}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
