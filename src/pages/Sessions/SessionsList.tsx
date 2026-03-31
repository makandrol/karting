import { useState, useEffect, useCallback, useMemo } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { parseTime } from '../../utils/timing';
import DateNavigator from '../../components/Sessions/DateNavigator';
import SessionsTable, { type SessionTableRow } from '../../components/Sessions/SessionsTable';

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
  const [sessions, setSessions] = useState<SessionTableRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'time_asc' | 'time_desc' | 'best_asc' | 'best_desc'>('time_desc');

  const fetchSessions = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const all: SessionTableRow[] = await res.json();
        setSessions(all.filter(s => !s.end_time || (s.end_time - s.start_time) >= 180000));
      } else setSessions([]);
    } catch { setSessions([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSessions(selectedDate); }, [selectedDate, fetchSessions]);

  const sortedSessions = useMemo(() => {
    const arr = [...sessions];
    if (sortBy === 'time_desc') return arr.reverse();
    if (sortBy === 'best_asc') return arr.sort((a, b) => (parseTime(a.best_lap_time) ?? Infinity) - (parseTime(b.best_lap_time) ?? Infinity));
    if (sortBy === 'best_desc') return arr.sort((a, b) => (parseTime(b.best_lap_time) ?? -Infinity) - (parseTime(a.best_lap_time) ?? -Infinity));
    return arr;
  }, [sessions, sortBy]);

  return (
    <div className="space-y-6">
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
            <div className="flex bg-dark-800 rounded-md p-0.5 gap-0.5">
              <button onClick={() => setSortBy(sortBy === 'time_asc' ? 'time_desc' : 'time_asc')}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors flex items-center gap-1 ${sortBy.startsWith('time') ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
                по часу {sortBy === 'time_asc' ? '↑' : sortBy === 'time_desc' ? '↓' : ''}
              </button>
              <button onClick={() => setSortBy(sortBy === 'best_asc' ? 'best_desc' : 'best_asc')}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors flex items-center gap-1 ${sortBy.startsWith('best') ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
                по колу {sortBy === 'best_asc' ? '↑' : sortBy === 'best_desc' ? '↓' : ''}
              </button>
            </div>
          )}
        </h2>

        {loading ? (
          <div className="card text-center py-6 text-dark-500 text-sm">Завантаження...</div>
        ) : sessions.length === 0 ? (
          <div className="card text-center py-6 text-dark-500 text-sm">Немає заїздів за цю дату</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <SessionsTable sessions={sortedSessions} />
          </div>
        )}
      </div>
    </div>
  );
}
