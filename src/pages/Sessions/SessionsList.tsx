import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';
import { toSeconds, shortName, parseTime } from '../../utils/timing';
import DateNavigator from '../../components/Sessions/DateNavigator';

interface DbSession {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  real_pilot_count: number | null;
  track_id: number;
  race_number: number | null;
  is_race: number;
  date: string;
  best_lap_time: string | null;
  best_lap_pilot: string | null;
  best_lap_kart: number | null;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(startMs: number, endMs: number): string {
  const sec = Math.round((endMs - startMs) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}с`;
  return `${m}хв ${s}с`;
}

function fmtDateLabel(dateStr: string): string {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (dateStr === todayStr) return 'Сьогодні';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (dateStr === yesterdayStr) return 'Вчора';
  const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const d = new Date(dateStr + 'T00:00:00');
  return `${DAY_NAMES[d.getDay()]} ${d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

export default function SessionsList() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'asc' | 'desc' | 'best'>('asc');

  const fetchSessions = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const all: DbSession[] = await res.json();
        setSessions(all.filter(s => !s.end_time || (s.end_time - s.start_time) >= 60000));
      } else setSessions([]);
    } catch { setSessions([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSessions(selectedDate); }, [selectedDate, fetchSessions]);

  const sortedSessions = useMemo(() => {
    const arr = [...sessions];
    if (sortBy === 'desc') return arr.reverse();
    if (sortBy === 'best') return arr.sort((a, b) => {
      const at = parseTime(a.best_lap_time) ?? Infinity;
      const bt = parseTime(b.best_lap_time) ?? Infinity;
      return at - bt;
    });
    return arr;
  }, [sessions, sortBy]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Заїзди</h1>

      <DateNavigator selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <div>
        <h2 className="text-dark-300 text-sm font-semibold mb-2 flex items-center gap-3">
          <span>
            {fmtDateLabel(selectedDate)}
            {!loading && sessions.length > 0 && (
              <span className="text-dark-500 font-normal ml-2">({sessions.length} заїздів)</span>
            )}
          </span>
          {sessions.length > 1 && (
            <div className="flex bg-dark-800 rounded-md p-0.5">
              <button onClick={() => setSortBy('asc')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortBy === 'asc' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>від першого</button>
              <button onClick={() => setSortBy('desc')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortBy === 'desc' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>від останнього</button>
              <button onClick={() => setSortBy('best')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortBy === 'best' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по колу</button>
            </div>
          )}
        </h2>

        {loading ? (
          <div className="card text-center py-6 text-dark-500 text-sm">Завантаження...</div>
        ) : sessions.length === 0 ? (
          <div className="card text-center py-6 text-dark-500 text-sm">Немає заїздів за цю дату</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                {sortedSessions.map((s) => {
                  const isActive = !s.end_time;
                  const pilots = s.real_pilot_count ?? s.pilot_count;
                  return (
                    <tr key={s.id} className="border-b border-dark-800/50 last:border-0">
                      <td className="py-1.5 pl-3 pr-1">
                        <Link to={isActive ? '/' : `/sessions/${s.id}`} className="text-dark-500 hover:text-primary-400 transition-colors whitespace-nowrap font-mono">
                          №{s.race_number ?? '—'}
                        </Link>
                      </td>
                      <td className="py-1.5 font-mono text-white whitespace-nowrap">{fmtTime(s.start_time)}</td>
                      <td className="py-1.5 font-mono whitespace-nowrap">
                        {isActive
                          ? <span className="text-green-400">LIVE</span>
                          : <span className="text-dark-400">{s.end_time ? fmtDuration(s.start_time, s.end_time) : '—'}</span>}
                      </td>
                      <td className="py-1.5 text-dark-500 whitespace-nowrap">{pilots} пілот{pilots === 1 ? '' : pilots < 5 ? 'и' : 'ів'}</td>
                      <td className="py-1.5 text-dark-500 whitespace-nowrap">Прокат</td>
                      <td className="py-1.5 text-dark-500 whitespace-nowrap">Траса {s.track_id || 1}</td>
                      <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">
                        {s.best_lap_time && s.best_lap_pilot ? (
                          <>
                            <span className="text-dark-500">
                              {shortName(s.best_lap_pilot)}
                              {s.best_lap_kart ? <span className="text-dark-600"> (карт {s.best_lap_kart})</span> : ''}
                            </span>
                            <span className="text-dark-600 mx-1">—</span>
                            <span className="text-green-400">{toSeconds(s.best_lap_time)}</span>
                          </>
                        ) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
