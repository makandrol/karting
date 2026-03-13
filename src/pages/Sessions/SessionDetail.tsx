import { useParams, Link } from 'react-router-dom';
import { getSessionById } from '../../mock/sessionData';

function fmtDt(dt: string): string {
  try { return new Date(dt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return dt; }
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const session = getSessionById(sessionId || '');

  if (!session) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-white mb-2">Заїзд не знайдено</h1>
        <Link to="/info/timing" className="text-primary-400 hover:underline text-sm">← Таймінг</Link>
      </div>
    );
  }

  // Групуємо кола по пілотах
  const pilotMap = new Map<string, { laps: typeof session.laps; bestSec: number }>();
  for (const lap of session.laps) {
    if (!pilotMap.has(lap.pilot)) pilotMap.set(lap.pilot, { laps: [], bestSec: Infinity });
    const entry = pilotMap.get(lap.pilot)!;
    entry.laps.push(lap);
    if (lap.lapTimeSec < entry.bestSec) entry.bestSec = lap.lapTimeSec;
  }

  // Сортуємо пілотів по найкращому колу
  const sortedPilots = [...pilotMap.entries()].sort((a, b) => a[1].bestSec - b[1].bestSec);
  const maxLaps = Math.max(...sortedPilots.map(([, v]) => v.laps.length), 0);

  // Абсолютний best
  const overallBest = sortedPilots.length > 0 ? sortedPilots[0][1].bestSec : Infinity;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/info/timing" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">
            Заїзд #{session.number} — {new Date(session.date).toLocaleDateString('uk-UA')}
          </h1>
          <p className="text-dark-400 text-sm">
            {session.startTime.slice(0, 5)} – {session.endTime.slice(0, 5)} • {session.pilots.length} пілотів • {session.laps.length} кіл
          </p>
        </div>
      </div>

      {/* Laps grid: columns = pilots, rows = lap numbers */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800">
          <h3 className="text-white font-semibold">Кола по пілотах</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-center w-10">Коло</th>
                {sortedPilots.map(([pilot]) => (
                  <th key={pilot} className="table-cell text-center min-w-[100px]">
                    <Link to={`/pilots/${encodeURIComponent(pilot)}`} className="text-white hover:text-primary-400 transition-colors">
                      {pilot.split(' ')[0]}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxLaps }, (_, lapIdx) => (
                <tr key={lapIdx} className="table-row">
                  <td className="table-cell text-center font-mono text-dark-500 text-xs">{lapIdx + 1}</td>
                  {sortedPilots.map(([pilot, data]) => {
                    const lap = data.laps[lapIdx];
                    if (!lap) return <td key={pilot} className="table-cell text-center text-dark-700">—</td>;

                    const isBest = Math.abs(lap.lapTimeSec - data.bestSec) < 0.002;
                    const isOverallBest = Math.abs(lap.lapTimeSec - overallBest) < 0.002;

                    return (
                      <td key={pilot} className={`table-cell text-center font-mono text-xs ${
                        isOverallBest ? 'text-purple-400 font-bold' :
                        isBest ? 'text-green-400 font-bold' :
                        'text-dark-300'
                      }`}>
                        {lap.lapTime}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
