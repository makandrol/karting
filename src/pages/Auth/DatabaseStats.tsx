import { useAuth } from '../../services/auth';
import { Navigate, Link } from 'react-router-dom';
import { ALL_COMPETITION_EVENTS } from '../../mock/competitionEvents';
import { ALL_SESSIONS } from '../../mock/sessionData';
import { MOCK_KARTS } from '../../mock/timingData';
import { fmtBytes } from '../../utils/timing';

/** Приблизний розмір JSON в байтах */
function estimateSize(obj: unknown): number {
  return new Blob([JSON.stringify(obj)]).size;
}

export default function DatabaseStats() {
  const { isOwner } = useAuth();

  if (!isOwner) return <Navigate to="/login" replace />;

  // Calculate stats from current data
  const competitionEvents = ALL_COMPETITION_EVENTS;
  const sessions = ALL_SESSIONS;
  const karts = MOCK_KARTS;

  const totalPilots = new Set(
    competitionEvents.flatMap(e => e.phases.flatMap(p => p.results.map(r => r.pilot)))
  ).size;

  const totalLaps = sessions.reduce((sum, s) => sum + s.laps.length, 0);
  const totalCompResults = competitionEvents.reduce(
    (sum, e) => sum + e.phases.reduce((s, p) => s + p.results.length, 0), 0
  );

  const competitionEventsSize = estimateSize(competitionEvents);
  const sessionsSize = estimateSize(sessions);
  const kartsSize = estimateSize(karts);

  // Projected DB usage
  const projectedDaily = {
    events: 6.3, // MB (з повними полами)
    lapsOnly: 0.4, // MB
  };

  const today = new Date();
  const projected30d = projectedDaily.events * 10 + projectedDaily.lapsOnly * 20;
  const projectedYear = projectedDaily.lapsOnly * 240 + projectedDaily.events * 52 + 3; // 52 comp days full + overhead

  const stats = [
    { label: 'Пілотів (унікальних)', value: totalPilots, color: 'text-blue-400' },
    { label: 'Подій змагань', value: competitionEvents.length, color: 'text-green-400' },
    { label: 'Результатів змагань', value: totalCompResults, color: 'text-green-400' },
    { label: 'Заїздів (mock)', value: sessions.length, color: 'text-yellow-400' },
    { label: 'Кіл (mock)', value: totalLaps, color: 'text-yellow-400' },
    { label: 'Картів', value: karts.length, color: 'text-purple-400' },
  ];

  const storage = [
    { label: 'Дані змагань (JSON)', size: competitionEventsSize, color: 'bg-green-500' },
    { label: 'Дані заїздів (mock)', size: sessionsSize, color: 'bg-yellow-500' },
    { label: 'Дані картів', size: kartsSize, color: 'bg-purple-500' },
  ];

  const totalCurrentSize = storage.reduce((s, x) => s + x.size, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">💾 База даних</h1>
          <p className="text-dark-400 text-sm">Статистика та моніторинг сховища</p>
        </div>
      </div>

      {/* Current stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="card text-center py-4">
            <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.value.toLocaleString()}</div>
            <div className="text-dark-500 text-xs mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Current storage */}
      <div className="card space-y-4">
        <h3 className="text-white font-semibold">📊 Поточне використання (in-memory)</h3>
        <div className="space-y-2">
          {storage.map((s) => {
            const pct = (s.size / totalCurrentSize) * 100;
            return (
              <div key={s.label} className="flex items-center gap-3">
                <div className="w-40 text-dark-400 text-xs">{s.label}</div>
                <div className="flex-1 h-4 bg-dark-800 rounded-full overflow-hidden">
                  <div className={`h-full ${s.color} rounded-full`} style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
                <div className="w-20 text-right text-dark-300 text-xs font-mono">{fmtBytes(s.size)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-dark-800">
          <span className="text-dark-400 text-sm">Всього in-memory</span>
          <span className="text-white font-mono font-bold">{fmtBytes(totalCurrentSize)}</span>
        </div>
      </div>

      {/* Projected DB usage */}
      <div className="card space-y-4">
        <h3 className="text-white font-semibold">📈 Прогноз використання БД (Supabase)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-left">Компонент</th>
                <th className="table-cell text-right">На день</th>
                <th className="table-cell text-right">30 днів</th>
                <th className="table-cell text-right">1 рік</th>
              </tr>
            </thead>
            <tbody>
              <tr className="table-row">
                <td className="table-cell text-left text-white">Event log (повний, 4 req/s)</td>
                <td className="table-cell text-right font-mono text-dark-300">{projectedDaily.events.toFixed(1)} MB</td>
                <td className="table-cell text-right font-mono text-dark-300">{(projectedDaily.events * 10).toFixed(0)} MB *</td>
                <td className="table-cell text-right font-mono text-dark-300">~330 MB **</td>
              </tr>
              <tr className="table-row">
                <td className="table-cell text-left text-white">Кола (компактно)</td>
                <td className="table-cell text-right font-mono text-dark-300">{projectedDaily.lapsOnly.toFixed(1)} MB</td>
                <td className="table-cell text-right font-mono text-dark-300">{(projectedDaily.lapsOnly * 30).toFixed(0)} MB</td>
                <td className="table-cell text-right font-mono text-dark-300">~96 MB</td>
              </tr>
              <tr className="table-row">
                <td className="table-cell text-left text-white">Результати змагань</td>
                <td className="table-cell text-right font-mono text-dark-400">—</td>
                <td className="table-cell text-right font-mono text-dark-400">~0.2 MB</td>
                <td className="table-cell text-right font-mono text-dark-300">~2 MB</td>
              </tr>
              <tr className="table-row border-t border-dark-700">
                <td className="table-cell text-left text-white font-bold">Всього (прогноз)</td>
                <td className="table-cell text-right font-mono text-primary-400 font-bold">{(projectedDaily.events + projectedDaily.lapsOnly).toFixed(1)} MB</td>
                <td className="table-cell text-right font-mono text-primary-400 font-bold">{projected30d.toFixed(0)} MB</td>
                <td className="table-cell text-right font-mono text-primary-400 font-bold">~{projectedYear.toFixed(0)} MB</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="text-dark-500 text-xs space-y-1">
          <p>* Повний event log зберігається 10 днів, далі компактується до кіл</p>
          <p>** Для змагань event log зберігається весь рік (для реплеїв)</p>
        </div>

        {/* Supabase limit bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-dark-400 text-xs">Supabase Free (500 MB)</span>
            <span className="text-dark-400 text-xs font-mono">{projectedYear.toFixed(0)} / 500 MB</span>
          </div>
          <div className="h-5 bg-dark-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${projectedYear > 450 ? 'bg-red-500' : projectedYear > 300 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${Math.min((projectedYear / 500) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* DB Status */}
      <div className="card">
        <h3 className="text-white font-semibold mb-3">⚙️ Статус</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="text-dark-300">Supabase: не підключено (працює на mock даних)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="text-dark-300">Collector: не запущено</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-dark-300">Firebase Auth: {'{'}готово до налаштування{'}'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
