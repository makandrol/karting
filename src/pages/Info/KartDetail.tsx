import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { parseTime, toSeconds, mergePilotNames } from '../../utils/timing';
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
  const p = name.trim().split(' ').filter(Boolean);
  return p.length < 2 ? p[0] || name : `${p[0]} ${p[1][0]}.`;
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

  // Fetch sessions + kart laps in one flow, filter to only sessions with this kart
  useEffect(() => {
    if (selectedDates.size === 0) {
      setStatSessionIds(new Set());
      setStatSessionDetails([]);
      setLaps([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // 1. Fetch all sessions for selected dates
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

      // 2. Fetch laps for this kart
      const sortedDates = [...selectedDates].sort();
      const from = sortedDates[0];
      const to = sortedDates[sortedDates.length - 1];
      let kartLaps: KartLap[] = [];
      try {
        const res = await fetch(`${COLLECTOR_URL}/db/laps?kart=${kartNumber}&from=${from}&to=${to}`);
        if (res.ok) kartLaps = await res.json();
      } catch {}
      if (cancelled) return;

      // 3. Filter to sessions where this kart has laps
      const allIds = new Set(allSessions.map(s => s.id));
      const filtered = kartLaps.filter(l => allIds.has(l.session_id));
      const bySession = new Map<string, KartLap[]>();
      for (const l of filtered) {
        if (!bySession.has(l.session_id)) bySession.set(l.session_id, []);
        bySession.get(l.session_id)!.push(l);
      }
      const merged: KartLap[] = [];
      for (const sessionLaps of bySession.values()) {
        merged.push(...mergePilotNames(sessionLaps));
      }
      const kartSessionIds = new Set(filtered.map(l => l.session_id));

      setLaps(merged);
      setStatSessionIds(kartSessionIds);
      setStatSessionDetails(allSessions.filter(s => kartSessionIds.has(s.id)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedDates, kartNumber]);

  const [sortBy, setSortBy] = useState<'best' | 'date'>('best');

  // Per-date session counts for this kart only
  const kartDateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of statSessionDetails) {
      counts[s.date] = (counts[s.date] || 0) + 1;
    }
    return counts;
  }, [statSessionDetails]);

  // Per-session stats for this kart
  const sessionStats = useMemo(() => {
    const bySession = new Map<string, KartLap[]>();
    for (const l of laps) {
      if (!bySession.has(l.session_id)) bySession.set(l.session_id, []);
      bySession.get(l.session_id)!.push(l);
    }
    const result: { pilot: string; bestLap: string; bestLapSec: number; bestS1: string | null; bestS2: string | null; sessionId: string; date: string; sessionStart: number; raceNumber: number | null; lapCount: number }[] = [];
    for (const [sessionId, sessionLaps] of bySession) {
      let bestLap = '', bestLapSec = Infinity, bestS1: string | null = null, bestS1Sec = Infinity, bestS2: string | null = null, bestS2Sec = Infinity;
      const pilots = new Set<string>();
      for (const l of sessionLaps) {
        pilots.add(l.pilot);
        const sec = parseTime(l.lap_time);
        if (sec !== null && sec < bestLapSec) { bestLapSec = sec; bestLap = l.lap_time; }
        const s1sec = parseTime(l.s1);
        if (s1sec !== null && s1sec < bestS1Sec) { bestS1Sec = s1sec; bestS1 = l.s1; }
        const s2sec = parseTime(l.s2);
        if (s2sec !== null && s2sec < bestS2Sec) { bestS2Sec = s2sec; bestS2 = l.s2; }
      }
      const detail = statSessionDetails.find(s => s.id === sessionId);
      result.push({
        pilot: [...pilots].join(', '),
        bestLap, bestLapSec, bestS1, bestS2,
        sessionId, date: sessionLaps[0].date, sessionStart: sessionLaps[0].session_start,
        raceNumber: detail?.race_number ?? null,
        lapCount: sessionLaps.length,
      });
    }
    return result.sort((a, b) =>
      sortBy === 'date' ? b.sessionStart - a.sessionStart : a.bestLapSec - b.bestLapSec
    );
  }, [laps, statSessionDetails, sortBy]);

  const overallBestSec = sessionStats.length > 0 ? sessionStats[0].bestLapSec : null;
  const overallBestS1 = sessionStats.reduce((best, s) => { const v = parseTime(s.bestS1); return v !== null && v < best ? v : best; }, Infinity);
  const overallBestS2 = sessionStats.reduce((best, s) => { const v = parseTime(s.bestS2); return v !== null && v < best ? v : best; }, Infinity);

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
            {laps.length} кіл · {sessionStats.length} заїздів
            {overallBestSec !== null && overallBestSec < Infinity && <> · Рекорд: <span className="text-green-400 font-mono">{toSeconds(sessionStats[0].bestLap)}</span> ({sessionStats[0].pilot})</>}
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
        overrideCounts={kartDateCounts}
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
          {/* Sessions table */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-800 flex items-center justify-between">
              <h3 className="text-white font-semibold">Заїзди ({sessionStats.length})</h3>
              <div className="flex bg-dark-800 rounded-md p-0.5">
                <button onClick={() => setSortBy('best')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortBy === 'best' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по швидкості</button>
                <button onClick={() => setSortBy('date')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortBy === 'date' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по даті</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="table-header">
                  <th className="table-cell text-center w-8">#</th>
                  <th className="table-cell text-left">Pilot</th>
                  <th className="table-cell text-right">Best</th>
                  <th className="table-cell text-right">B.S1</th>
                  <th className="table-cell text-right">B.S2</th>
                  <th className="table-cell text-left">Session</th>
                </tr></thead>
                <tbody>
                  {sessionStats.map((s, i) => {
                    const isBestLap = overallBestSec !== null && Math.abs(s.bestLapSec - overallBestSec) < 0.002;
                    const s1sec = parseTime(s.bestS1);
                    const isBestS1 = s1sec !== null && Math.abs(s1sec - overallBestS1) < 0.002;
                    const s2sec = parseTime(s.bestS2);
                    const isBestS2 = s2sec !== null && Math.abs(s2sec - overallBestS2) < 0.002;
                    return (
                      <tr key={s.sessionId} className="table-row">
                        <td className="table-cell text-center font-mono font-bold text-white">{i + 1}</td>
                        <td className="table-cell text-left text-white">{s.pilot}</td>
                        <td className={`table-cell text-right font-mono font-semibold ${isBestLap ? 'text-purple-400' : 'text-green-400'}`}>{toSeconds(s.bestLap)}</td>
                        <td className={`table-cell text-right font-mono text-[11px] ${isBestS1 ? 'text-purple-400' : 'text-dark-400'}`}>{s.bestS1 ? toSeconds(s.bestS1) : '—'}</td>
                        <td className={`table-cell text-right font-mono text-[11px] ${isBestS2 ? 'text-purple-400' : 'text-dark-400'}`}>{s.bestS2 ? toSeconds(s.bestS2) : '—'}</td>
                        <td className="table-cell text-left">
                          <Link to={`/sessions/${s.sessionId}`} className="text-primary-400 hover:text-primary-300 transition-colors underline underline-offset-2 decoration-primary-400/30">
                            {s.date.slice(5)} {fmtTime(s.sessionStart)}{s.raceNumber != null ? ` · Заїзд ${s.raceNumber}` : ''} · Прокат
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
