import { useEffect, useState } from 'react';
import { useAuth } from '../../services/auth';
import { Navigate, Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';
import { fmtBytes } from '../../utils/timing';

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}д ${h}г ${m}хв`;
  if (h > 0) return `${h}г ${m}хв`;
  return `${m}хв`;
}

export default function Monitoring() {
  const { isOwner } = useAuth();
  const [system, setSystem] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let active = true;

    async function load() {
      try {
        const token = import.meta.env.VITE_ADMIN_TOKEN || '';
        const authHeaders: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};
        const [sysRes, anaRes, statRes] = await Promise.all([
          fetch(`${COLLECTOR_URL}/system`, { headers: authHeaders }).then(r => r.json()),
          fetch(`${COLLECTOR_URL}/analytics?days=30`, { headers: authHeaders }).then(r => r.json()),
          fetch(`${COLLECTOR_URL}/status`).then(r => r.json()),
        ]);
        if (active) {
          setSystem(sysRes);
          setAnalytics(anaRes);
          setStatus(statRes);
          setError(null);
        }
      } catch {
        if (active) setError('Collector сервер недоступний');
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 30000); // refresh every 30s
    return () => { active = false; clearInterval(timer); };
  }, [isOwner]);

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
          <h1 className="text-2xl font-bold text-white">📊 Моніторинг</h1>
          <p className="text-dark-400 text-sm">Статистика сервера, БД та відвідувань</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">⚠️ {error}</div>
      )}

      {loading ? (
        <div className="card text-center py-12 text-dark-500">Завантаження...</div>
      ) : (
        <>
          {/* Server stats */}
          {system && (
            <div className="card space-y-4">
              <h3 className="text-white font-semibold">🖥️ Сервер</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Hostname" value={system.hostname} />
                <Stat label="Platform" value={system.platform} />
                <Stat label="Node.js" value={system.nodeVersion} />
                <Stat label="Uptime сервера" value={fmtUptime(system.serverUptime)} />
                <Stat label="Uptime процесу" value={fmtUptime(system.processUptime)} />
                <Stat label="CPU" value={`${system.cpu.cores} cores`} sub={system.cpu.model.slice(0, 30)} />
                <Stat label="Load" value={system.cpu.loadAvg.map((l: number) => l.toFixed(1)).join(' / ')} />
              </div>

              {/* RAM */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-dark-400">RAM: {fmtBytes(system.memory.usedBytes)} / {fmtBytes(system.memory.totalBytes)}</span>
                  <span className="text-dark-400">{system.memory.usedPercent}%</span>
                </div>
                <Bar percent={system.memory.usedPercent} color={system.memory.usedPercent > 80 ? 'bg-red-500' : system.memory.usedPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'} />
              </div>

              {/* Disk */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-dark-400">Диск: {fmtBytes(system.disk.usedBytes)} / {fmtBytes(system.disk.totalBytes)}</span>
                  <span className="text-dark-400">{system.disk.usedPercent}%</span>
                </div>
                <Bar percent={system.disk.usedPercent} color={system.disk.usedPercent > 80 ? 'bg-red-500' : 'bg-blue-500'} />
              </div>

              {/* Process memory */}
              <div className="text-dark-500 text-xs">
                Процес: RSS {fmtBytes(system.memory.process.rssBytes)} • Heap {fmtBytes(system.memory.process.heapUsedBytes)} / {fmtBytes(system.memory.process.heapTotalBytes)}
              </div>
            </div>
          )}

          {/* DB stats */}
          {system?.db && (
            <div className="card space-y-3">
              <h3 className="text-white font-semibold">💾 База даних</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Розмір БД" value={system.db.dbSizeMB + ' MB'} color="text-primary-400" />
                <Stat label="Сесій" value={system.db.totalSessions} />
                <Stat label="Подій" value={system.db.totalEvents.toLocaleString()} />
                <Stat label="Кіл" value={system.db.totalLaps.toLocaleString()} />
              </div>
              <div className="text-dark-600 text-[10px] font-mono">{system.db.dbPath}</div>
            </div>
          )}

          {/* Collector status */}
          {status && (
            <div className="card space-y-3">
              <h3 className="text-white font-semibold">🔄 Collector</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Таймінг" value={status.online ? 'ONLINE' : 'OFFLINE'} color={status.online ? 'text-green-400' : 'text-red-400'} />
                <Stat label="Запитів" value={status.pollCount.toLocaleString()} />
                <Stat label="Помилок" value={status.errorCount.toLocaleString()} color={status.errorCount > 0 ? 'text-yellow-400' : 'text-green-400'} />
                <Stat label="Інтервал" value={status.pollInterval === 1000 ? '1 сек' : '60 сек'} />
              </div>
            </div>
          )}

          {/* Analytics */}
          {analytics && (
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold">👥 Відвідувачі</h3>
                <span className="text-dark-500 text-xs">Всього: {analytics.totalPageViews} переглядів</span>
              </div>

              {/* By date */}
              {analytics.byDate.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="table-header">
                        <th className="table-cell text-left">Дата</th>
                        <th className="table-cell text-right">Перегляди</th>
                        <th className="table-cell text-right">Сесій</th>
                        <th className="table-cell text-right">Авторизованих</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.byDate.map((d: any) => (
                        <tr key={d.date} className="table-row">
                          <td className="table-cell text-left font-mono text-dark-200">{d.date}</td>
                          <td className="table-cell text-right font-mono text-white font-semibold">{d.views}</td>
                          <td className="table-cell text-right font-mono text-dark-300">{d.unique_sessions}</td>
                          <td className="table-cell text-right font-mono text-dark-400">{d.users}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-dark-500 text-sm text-center py-4">Немає даних за останні 30 днів</p>
              )}

              {/* Popular pages */}
              {analytics.byPath.length > 0 && (
                <>
                  <h4 className="text-dark-300 text-xs font-semibold">Популярні сторінки</h4>
                  <div className="space-y-1">
                    {analytics.byPath.slice(0, 10).map((p: any) => {
                      const maxViews = analytics.byPath[0]?.views || 1;
                      return (
                        <div key={p.path} className="flex items-center gap-2">
                          <span className="text-dark-400 text-xs font-mono w-32 truncate">{p.path}</span>
                          <div className="flex-1 h-3 bg-dark-800 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500/40 rounded-full" style={{ width: `${(p.views / maxViews) * 100}%` }} />
                          </div>
                          <span className="text-dark-300 text-xs font-mono w-8 text-right">{p.views}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Recent users */}
              {analytics.recentUsers.length > 0 && (
                <>
                  <h4 className="text-dark-300 text-xs font-semibold">Авторизовані користувачі</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="table-header">
                          <th className="table-cell text-left">Email</th>
                          <th className="table-cell text-left">Ім'я</th>
                          <th className="table-cell text-right">Останній візит</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.recentUsers.map((u: any) => (
                          <tr key={u.user_email} className="table-row">
                            <td className="table-cell text-left font-mono text-dark-200">{u.user_email}</td>
                            <td className="table-cell text-left text-dark-300">{u.user_name || '—'}</td>
                            <td className="table-cell text-right font-mono text-dark-500">{new Date(u.last_seen).toLocaleString('uk-UA')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Visitor sessions with duration */}
              {analytics.visitorSessions?.length > 0 && (
                <>
                  <h4 className="text-dark-300 text-xs font-semibold">Останні сесії відвідувачів</h4>
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0">
                        <tr className="table-header">
                          <th className="table-cell text-left">Користувач</th>
                          <th className="table-cell text-center">Сторінок</th>
                          <th className="table-cell text-right">Тривалість</th>
                          <th className="table-cell text-right">Час</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.visitorSessions.map((s: any) => (
                          <tr key={s.session_id} className="table-row">
                            <td className="table-cell text-left text-dark-200">
                              {s.user_email || <span className="text-dark-500">анонім</span>}
                            </td>
                            <td className="table-cell text-center font-mono text-dark-300">{s.page_count}</td>
                            <td className={`table-cell text-right font-mono font-semibold ${
                              s.durationMin >= 5 ? 'text-green-400' : s.durationMin >= 1 ? 'text-yellow-400' : 'text-dark-400'
                            }`}>
                              {s.durationMin >= 60 ? `${Math.floor(s.durationMin / 60)}г ${Math.round(s.durationMin % 60)}хв` :
                               s.durationMin >= 1 ? `${s.durationMin.toFixed(1)} хв` :
                               `${Math.round(s.duration_sec || 0)}с`}
                            </td>
                            <td className="table-cell text-right font-mono text-dark-500">
                              {new Date(s.last_seen).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-dark-800/50 rounded-lg px-3 py-2">
      <div className={`font-mono font-bold text-sm ${color || 'text-white'}`}>{value}</div>
      <div className="text-dark-500 text-[10px]">{label}</div>
      {sub && <div className="text-dark-600 text-[9px] truncate">{sub}</div>}
    </div>
  );
}

function Bar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-2 bg-dark-800 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}
