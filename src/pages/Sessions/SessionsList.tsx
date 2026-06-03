import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../services/api';
import { parseTime, isValidSession } from '../../utils/timing';
import { fmtDateLabel, fmtDateISO } from '../../utils/datetime';
import { useLocalStorage } from '../../services/useLocalStorage';
import { LoadingState } from '../../components/States';
import DateNavigator from '../../components/Sessions/DateNavigator';
import SessionsTable, { type SessionTableRow } from '../../components/Sessions/SessionsTable';

type SortBy = 'time_asc' | 'time_desc' | 'best_asc' | 'best_desc';

interface SessionsFilters {
  selectedDate: string;
  sortBy: SortBy;
}

export default function SessionsList() {
  const todayStr = fmtDateISO(new Date());
  const [filters, setFilters] = useLocalStorage<SessionsFilters>(
    'karting_sessions_filters',
    { selectedDate: todayStr, sortBy: 'time_desc' },
    { endOfDayExpiry: true },
  );
  const { selectedDate, sortBy } = filters;
  const setSelectedDate = (v: string) => setFilters(f => ({ ...f, selectedDate: v }));
  const setSortBy = (v: SortBy) => setFilters(f => ({ ...f, sortBy: v }));

  const [sessions, setSessions] = useState<SessionTableRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const all = await api.sessions.byDate(date);
      setSessions((all as unknown as SessionTableRow[]).filter(isValidSession));
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
          <LoadingState size="md" />
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
