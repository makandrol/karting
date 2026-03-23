import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';
import { toSeconds, shortName } from '../../utils/timing';
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
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const time = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${mm}-${dd} ${time}`;
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
            {sessions.map((s) => {
              const isActive = !s.end_time;
              const pilots = s.real_pilot_count ?? s.pilot_count;
              return (
                <Link
                  key={s.id}
                  to={isActive ? '/' : `/sessions/${s.id}`}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-dark-700/50 transition-colors text-xs"
                >
                  <span className="flex items-center gap-4 min-w-0">
                    <span className="text-white shrink-0">
                      Прокат{s.race_number != null ? ` · №${s.race_number}` : ''} · {fmtTime(s.start_time)}
                      {isActive && <span className="text-green-400 ml-1.5">LIVE</span>}
                    </span>
                    <span className="text-dark-400 font-mono shrink-0">
                      {s.end_time ? fmtDuration(s.start_time, s.end_time) : '—'}
                    </span>
                    <span className="text-dark-500 shrink-0">{pilots} пілотів</span>
                  </span>
                  {s.best_lap_time && s.best_lap_pilot && (
                    <span className="font-mono shrink-0 ml-4">
                      <span className="text-dark-500">{shortName(s.best_lap_pilot)}</span>
                      <span className="text-dark-600 mx-1">—</span>
                      <span className="text-green-400">{toSeconds(s.best_lap_time)}</span>
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
