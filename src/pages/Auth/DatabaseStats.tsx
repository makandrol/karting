import { useEffect, useState } from 'react';
import { useAuth } from '../../services/auth';
import { Navigate, Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';
import { fmtBytes } from '../../utils/timing';

export default function DatabaseStats() {
  const { isOwner } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`${COLLECTOR_URL}/status`);
        if (res.ok && active) setStatus(await res.json());
      } catch { /* ignore */ }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [isOwner]);

  if (!isOwner) return <Navigate to="/login" replace />;

  const db = status?.db;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">База даних</h1>
          <p className="text-dark-400 text-sm">Статистика SQLite колектора</p>
        </div>
      </div>

      {loading ? (
        <div className="card text-center py-12 text-dark-500">Завантаження...</div>
      ) : !db ? (
        <div className="card text-center py-12 text-dark-500">Collector недоступний</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card text-center py-4">
              <div className="text-2xl font-bold font-mono text-primary-400">{fmtBytes(db.dbSizeBytes)}</div>
              <div className="text-dark-500 text-xs mt-1">Розмір БД</div>
            </div>
            <div className="card text-center py-4">
              <div className="text-2xl font-bold font-mono text-green-400">{db.totalSessions}</div>
              <div className="text-dark-500 text-xs mt-1">Сесій</div>
            </div>
            <div className="card text-center py-4">
              <div className="text-2xl font-bold font-mono text-yellow-400">{db.totalEvents.toLocaleString()}</div>
              <div className="text-dark-500 text-xs mt-1">Подій</div>
            </div>
            <div className="card text-center py-4">
              <div className="text-2xl font-bold font-mono text-blue-400">{db.totalLaps.toLocaleString()}</div>
              <div className="text-dark-500 text-xs mt-1">Кіл</div>
            </div>
          </div>

          <div className="card">
            <h3 className="text-white font-semibold mb-3">Статус</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-dark-300">Collector: онлайн</span>
              </div>
              <div className="text-dark-600 text-xs font-mono mt-2">{db.dbPath}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
