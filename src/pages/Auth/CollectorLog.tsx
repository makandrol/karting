import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../services/auth';
import { Navigate, Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';

interface SessionRow {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  track_id: number;
  race_number: number | null;
  is_race: number;
  date: string;
}

function fmtDuration(startMs: number, endMs: number | null): string {
  if (!endMs) return '—';
  const sec = Math.round((endMs - startMs) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}с`;
  return `${m}хв ${s}с`;
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${date} ${time}`;
}

export default function CollectorLog() {
  const { isOwner } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'today' | 'week'>('all');

  useEffect(() => {
    if (!isOwner) return;
    let active = true;

    async function load() {
      try {
        const res = await fetch(`${COLLECTOR_URL}/db/sessions`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SessionRow[] = await res.json();
        if (active) {
          setSessions(data);
          setError(null);
        }
      } catch {
        if (active) setError('Collector сервер недоступний');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [isOwner]);

  const filtered = useMemo(() => {
    if (filter === 'all') return sessions;
    const now = Date.now();
    const cutoff = filter === 'today'
      ? new Date().setHours(0, 0, 0, 0)
      : now - 7 * 24 * 60 * 60 * 1000;
    return sessions.filter(s => s.start_time >= cutoff);
  }, [sessions, filter]);

  if (!isOwner) return <Navigate to="/login" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Лог колектора</h1>
          <p className="text-dark-400 text-sm">Останні результати збору даних з таймінгу</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        {(['all', 'week', 'today'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                : 'bg-dark-800 text-dark-400 border border-dark-700 hover:text-white'
            }`}
          >
            {f === 'all' ? 'Все' : f === 'week' ? 'Тиждень' : 'Сьогодні'}
          </button>
        ))}
        <span className="text-dark-500 text-xs ml-2">
          {filtered.length} заїздів
        </span>
      </div>

      {loading ? (
        <div className="card text-center py-12 text-dark-500">Завантаження...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12 text-dark-500">Немає даних</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="table-header">
                  <th className="table-cell text-left">Дата і час</th>
                  <th className="table-cell text-center">Статус</th>
                  <th className="table-cell text-center">Заїзд #</th>
                  <th className="table-cell text-right">Тривалість</th>
                  <th className="table-cell text-center">Пілотів</th>
                  <th className="table-cell text-center">Траса</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const isActive = !s.end_time;
                  return (
                    <tr key={s.id} className="table-row">
                      <td className="table-cell text-left font-mono text-dark-200 whitespace-nowrap">
                        {fmtDateTime(s.start_time)}
                      </td>
                      <td className="table-cell text-center">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                            LIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-dark-700 text-dark-400 text-[10px] font-semibold">
                            <span className="w-1.5 h-1.5 rounded-full bg-dark-500" />
                            OK
                          </span>
                        )}
                      </td>
                      <td className="table-cell text-center font-mono text-dark-300">
                        {s.race_number ?? '—'}
                      </td>
                      <td className="table-cell text-right font-mono text-dark-300 whitespace-nowrap">
                        {fmtDuration(s.start_time, s.end_time)}
                      </td>
                      <td className="table-cell text-center">
                        <span className={`font-mono font-semibold ${
                          s.pilot_count >= 10 ? 'text-green-400' :
                          s.pilot_count >= 5 ? 'text-yellow-400' :
                          'text-dark-300'
                        }`}>
                          {s.pilot_count}
                        </span>
                      </td>
                      <td className="table-cell text-center font-mono text-dark-500">
                        #{s.track_id}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
