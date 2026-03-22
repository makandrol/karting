import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
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
function shortPilot(name: string): string {
  const p = name.split(' '); return p.length < 2 ? name : `${p[0]} ${p[1][0]}.`;
}

const LS_KART_STAT_IDS = 'karting_kart_detail_stat_ids';
function loadStatIds(): Set<string> {
  try { const s = localStorage.getItem(LS_KART_STAT_IDS); if (s) return new Set(JSON.parse(s)); } catch {} return new Set();
}

export default function KartDetail() {
  const { kartId } = useParams<{ kartId: string }>();
  const kartNumber = parseInt(kartId || '0');
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const [pickerDate, setPickerDate] = useState(todayStr);
  const [pickerSessions, setPickerSessions] = useState<DbSession[]>([]);
  const [selectedForAdd, setSelectedForAdd] = useState<Set<string>>(new Set());
  const [statSessionIds, setStatSessionIds] = useState<Set<string>>(loadStatIds);
  const [selectedToRemove, setSelectedToRemove] = useState<Set<string>>(new Set());
  const [statSessionDetails, setStatSessionDetails] = useState<DbSession[]>([]);
  const [laps, setLaps] = useState<KartLap[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { localStorage.setItem(LS_KART_STAT_IDS, JSON.stringify([...statSessionIds])); }, [statSessionIds]);

  // Fetch sessions for picker date
  useEffect(() => {
    fetch(`${COLLECTOR_URL}/db/sessions?date=${pickerDate}`)
      .then(r => r.json())
      .then((data: DbSession[]) => setPickerSessions(data.filter(s => s.end_time && (s.end_time - s.start_time) >= 60000)))
      .catch(() => setPickerSessions([]));
  }, [pickerDate]);

  // Auto-add today on first load
  useEffect(() => {
    if (statSessionIds.size > 0) return;
    fetch(`${COLLECTOR_URL}/db/sessions?date=${todayStr}`)
      .then(r => r.json())
      .then((data: DbSession[]) => {
        const ids = data.filter(s => s.end_time && (s.end_time - s.start_time) >= 60000).map(s => s.id);
        if (ids.length > 0) setStatSessionIds(new Set(ids));
      }).catch(() => {});
  }, []);

  // Fetch stat session details
  useEffect(() => {
    if (statSessionIds.size === 0) { setStatSessionDetails([]); return; }
    const dates = new Set<string>();
    for (const id of statSessionIds) {
      const m = id.match(/session-(\d+)/);
      if (m) { const d = new Date(parseInt(m[1])); dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
    }
    (async () => {
      const all: DbSession[] = [];
      for (const date of dates) {
        try { const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`); if (res.ok) all.push(...(await res.json())); } catch {}
      }
      setStatSessionDetails(all.filter(s => statSessionIds.has(s.id)));
    })();
  }, [statSessionIds]);

  // Fetch kart laps for stat sessions
  useEffect(() => {
    if (statSessionIds.size === 0) { setLaps([]); return; }
    setLoading(true);
    fetch(`${COLLECTOR_URL}/db/kart-stats`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: [...statSessionIds] }),
    }).then(() => {
      // Also fetch raw laps for this kart from all stat session dates
      const dates = new Set<string>();
      for (const id of statSessionIds) {
        const m = id.match(/session-(\d+)/);
        if (m) { const d = new Date(parseInt(m[1])); dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); }
      }
      const sortedDates = [...dates].sort();
      const from = sortedDates[0] || todayStr;
      const to = sortedDates[sortedDates.length - 1] || todayStr;
      return fetch(`${COLLECTOR_URL}/db/laps?kart=${kartNumber}&from=${from}&to=${to}`);
    })
      .then(r => r.json())
      .then((allLaps: KartLap[]) => setLaps(allLaps.filter(l => statSessionIds.has(l.session_id))))
      .catch(() => setLaps([]))
      .finally(() => setLoading(false));
  }, [statSessionIds, kartNumber]);

  const addToStats = () => {
    const next = new Set(statSessionIds);
    for (const id of selectedForAdd) next.add(id);
    setStatSessionIds(next); setSelectedForAdd(new Set());
  };
  const removeFromStats = () => {
    const next = new Set(statSessionIds);
    for (const id of selectedToRemove) next.delete(id);
    setStatSessionIds(next); setSelectedToRemove(new Set());
  };

  const pilotStats = useMemo(() => {
    const map = new Map<string, { pilot: string; bestSec: number; bestTime: string; lapCount: number; sessions: Set<string> }>();
    for (const l of laps) {
      const sec = parseTime(l.lap_time);
      if (sec === null) continue;
      if (!map.has(l.pilot)) map.set(l.pilot, { pilot: l.pilot, bestSec: Infinity, bestTime: '', lapCount: 0, sessions: new Set() });
      const p = map.get(l.pilot)!;
      p.lapCount++; p.sessions.add(l.session_id);
      if (sec < p.bestSec) { p.bestSec = sec; p.bestTime = l.lap_time; }
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

      {/* Same date navigator as everywhere */}
      <DateNavigator selectedDate={pickerDate} onSelectDate={setPickerDate} />

      {/* Sessions for picked date */}
      {pickerSessions.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">Заїзди за {pickerDate} ({pickerSessions.length})</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedForAdd(new Set(pickerSessions.map(s => s.id)))} className="text-dark-400 text-[10px] hover:text-white transition-colors">виділити всі</button>
              <span className="text-dark-700">|</span>
              <button onClick={() => setSelectedForAdd(new Set())} className="text-dark-400 text-[10px] hover:text-white transition-colors">зняти всі</button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {pickerSessions.map(s => {
              const inStats = statSessionIds.has(s.id);
              return (
                <label key={s.id} className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-dark-800/50 cursor-pointer text-xs ${inStats ? 'text-dark-600' : 'text-dark-300'}`}>
                  <input type="checkbox" checked={selectedForAdd.has(s.id)} disabled={inStats}
                    onChange={e => { const n = new Set(selectedForAdd); e.target.checked ? n.add(s.id) : n.delete(s.id); setSelectedForAdd(n); }}
                    className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0 shrink-0" />
                  <span className="flex-1 flex items-center justify-between">
                    <span>
                      <span className="text-white font-mono">{fmtTime(s.start_time)}</span>
                      {s.race_number != null && <span className="text-dark-500 ml-1">#{s.race_number}</span>}
                      <span className="text-dark-500 ml-1">· {s.real_pilot_count ?? s.pilot_count} пілотів</span>
                      {inStats && <span className="text-dark-600 ml-1">(в статистиці)</span>}
                    </span>
                    {s.best_lap_time && s.best_lap_pilot && (
                      <span className="text-dark-500 font-mono shrink-0 ml-2">{shortPilot(s.best_lap_pilot)} — <span className="text-green-400">{toSeconds(s.best_lap_time)}</span></span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {selectedForAdd.size > 0 && (
            <button onClick={addToStats} className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-500 transition-colors">
              Додати до статистики ({selectedForAdd.size})
            </button>
          )}
        </div>
      )}

      {/* Stat sessions */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">Заїзди для статистики ({statSessionIds.size})</div>
          {statSessionIds.size > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedToRemove(new Set(statSessionIds))} className="text-dark-400 text-[10px] hover:text-white transition-colors">виділити всі</button>
              <span className="text-dark-700">|</span>
              <button onClick={() => { setStatSessionIds(new Set()); setSelectedToRemove(new Set()); }} className="text-red-400/60 text-[10px] hover:text-red-400 transition-colors">очистити</button>
            </div>
          )}
        </div>
        {statSessionDetails.length === 0 ? (
          <div className="text-dark-600 text-xs py-2">Немає заїздів. Додайте через календар вище.</div>
        ) : (
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {statSessionDetails.map(s => (
              <label key={s.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-dark-800/50 cursor-pointer text-xs text-dark-300">
                <input type="checkbox" checked={selectedToRemove.has(s.id)}
                  onChange={e => { const n = new Set(selectedToRemove); e.target.checked ? n.add(s.id) : n.delete(s.id); setSelectedToRemove(n); }}
                  className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0 shrink-0" />
                <span><span className="text-white font-mono">{s.date.slice(5)} {fmtTime(s.start_time)}</span> · {s.real_pilot_count ?? s.pilot_count} пілотів</span>
              </label>
            ))}
          </div>
        )}
        {selectedToRemove.size > 0 && (
          <button onClick={removeFromStats} className="px-3 py-1.5 bg-red-600/20 text-red-400 text-xs rounded-lg hover:bg-red-600/30 transition-colors">Видалити ({selectedToRemove.size})</button>
        )}
      </div>

      {loading ? (
        <div className="card text-center py-12 text-dark-500">Завантаження...</div>
      ) : laps.length === 0 ? (
        <div className="card text-center py-12 text-dark-500">Немає даних. Додайте заїзди до статистики.</div>
      ) : (
        <>
          {/* Pilots leaderboard */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-800"><h3 className="text-white font-semibold">Пілоти ({pilotStats.length})</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="table-header">
                  <th className="table-cell text-center w-10">#</th><th className="table-cell text-left">Пілот</th>
                  <th className="table-cell text-right">Найкращий</th><th className="table-cell text-center">Кіл</th><th className="table-cell text-center">Заїздів</th>
                </tr></thead>
                <tbody>
                  {pilotStats.map((p, i) => (
                    <tr key={p.pilot} className="table-row">
                      <td className={`table-cell text-center font-mono font-bold ${i < 3 ? `position-${i + 1}` : 'text-dark-400'}`}>{i + 1}</td>
                      <td className="table-cell text-left"><Link to={`/pilots/${encodeURIComponent(p.pilot)}`} className="text-white hover:text-primary-400 transition-colors">{p.pilot}</Link></td>
                      <td className={`table-cell text-right font-mono font-semibold ${overallBest && Math.abs(p.bestSec - overallBest) < 0.002 ? 'text-purple-400' : 'text-green-400'}`}>{toSeconds(p.bestTime)}</td>
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
