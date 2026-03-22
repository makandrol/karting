import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';
import { toSeconds } from '../../utils/timing';
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

function shortPilotName(name: string): string {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1][0]}.`;
}

export default function SessionsList() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Заїзди</h1>

      <DateNavigator selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <div>
        <h2 className="text-dark-300 text-sm font-semibold mb-2">
          {fmtDateLabel(selectedDate)}
          {!loading && sessions.length > 0 && (
            <span className="text-dark-500 font-normal ml-2">({sessions.length} заїздів)</span>
          )}
        </h2>

        {loading ? (
          <div className="card text-center py-6 text-dark-500 text-sm">Завантаження...</div>
        ) : sessions.length === 0 ? (
          <div className="card text-center py-6 text-dark-500 text-sm">Немає заїздів за цю дату</div>
        ) : (
          <div className="card p-2 space-y-0.5">
            {sessions.map(s => {
              const isActive = !s.end_time;
              const pilots = s.real_pilot_count ?? (s.end_time ? 0 : s.pilot_count);
              return (
                <Link
                  key={s.id}
                  to={`/sessions/${s.id}`}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-dark-700/50 transition-colors group"
                >
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />}
                    <span className="text-dark-500 font-mono text-xs w-6 text-right flex-shrink-0">
                      {s.race_number ?? '—'}
                    </span>
                    <span className="font-mono text-xs">
                      <span className="text-white">{fmtTime(s.start_time)}</span>
                      <span className="text-dark-600"> – </span>
                      {s.end_time
                        ? <span className="text-dark-400">{fmtTime(s.end_time)}</span>
                        : <span className="text-green-400">live</span>
                      }
                    </span>
                    <span className="text-dark-400 text-xs">Прокат</span>
                    <span className="text-dark-600 text-xs">
                      · {pilots} пілотів
                      {s.end_time && ` · ${fmtDuration(s.start_time, s.end_time)}`}
                    </span>
                  </span>
                  {s.best_lap_time && s.best_lap_pilot && (
                    <span className="text-dark-500 text-xs font-mono shrink-0 ml-4">
                      {shortPilotName(s.best_lap_pilot)} — <span className="text-green-400">{toSeconds(s.best_lap_time)}</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
