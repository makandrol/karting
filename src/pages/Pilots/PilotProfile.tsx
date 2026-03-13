import { useParams, Link } from 'react-router-dom';
import { getPilotProfile, getPilotLapsInSession, getSessionById } from '../../mock/sessionData';
import { useState } from 'react';

export default function PilotProfile() {
  const { pilotName } = useParams<{ pilotName: string }>();
  const name = decodeURIComponent(pilotName || '');
  const profile = getPilotProfile(name);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  if (!profile || profile.totalSessions === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">👤</div>
        <h1 className="text-2xl font-bold text-white mb-2">Пілот не знайдений</h1>
        <Link to="/info/timing" className="text-primary-400 hover:underline text-sm">← Таймінг</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-primary-600/20 text-primary-400 rounded-xl flex items-center justify-center text-2xl">
          👤
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{profile.name}</h1>
          <p className="text-dark-400 text-sm">
            {profile.totalSessions} заїздів • {profile.totalLaps} кіл •
            Рекорд: <span className="text-green-400 font-mono font-semibold">{profile.bestLap || '—'}</span>
          </p>
        </div>
      </div>

      {/* Sessions */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800">
          <h3 className="text-white font-semibold">Заїзди ({profile.sessions.length})</h3>
        </div>
        <div className="divide-y divide-dark-800">
          {profile.sessions.map((s) => {
            const isExpanded = expandedSession === s.sessionId;
            const laps = isExpanded ? getPilotLapsInSession(s.sessionId, name) : [];
            const session = isExpanded ? getSessionById(s.sessionId) : null;

            return (
              <div key={s.sessionId}>
                <button
                  onClick={() => setExpandedSession(isExpanded ? null : s.sessionId)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-dark-800/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-dark-800 rounded-lg flex items-center justify-center font-mono font-bold text-sm text-white">
                      {s.sessionNumber}
                    </div>
                    <div>
                      <span className="text-white text-sm font-medium">
                        Заїзд #{s.sessionNumber}
                      </span>
                      <span className="text-dark-500 text-xs ml-2">
                        {new Date(s.date).toLocaleDateString('uk-UA')}
                      </span>
                      <span className={`text-xs ml-2 ${s.competitionName ? 'text-primary-400' : 'text-dark-600'}`}>
                        {s.competitionName || 'Прокат'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-green-400 font-mono text-sm font-semibold">{s.bestLap}</div>
                      <div className="text-dark-500 text-xs">{s.laps} кіл • карт {s.kart}</div>
                    </div>
                    <svg className={`w-4 h-4 text-dark-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-dark-800/50 bg-dark-900/50">
                    <div className="px-4 py-2 flex items-center justify-between">
                      <span className="text-dark-500 text-xs">{laps.length} кіл у цьому заїзді</span>
                      <Link
                        to={`/sessions/${s.sessionId}`}
                        className="text-primary-400 hover:text-primary-300 text-xs font-medium"
                      >
                        Відкрити заїзд →
                      </Link>
                    </div>
                    <table className="w-full">
                      <thead>
                        <tr className="table-header">
                          <th className="table-cell text-center w-10">#</th>
                          <th className="table-cell text-right">Час</th>
                          <th className="table-cell text-right">S1</th>
                          <th className="table-cell text-right">S2</th>
                          <th className="table-cell text-center">Карт</th>
                        </tr>
                      </thead>
                      <tbody>
                        {laps.map((lap, idx) => {
                          const isBest = laps.length > 0 && lap.lapTimeSec === Math.min(...laps.map(l => l.lapTimeSec));
                          return (
                            <tr key={idx} className="table-row">
                              <td className="table-cell text-center font-mono text-dark-500 text-xs">{lap.lapNumber}</td>
                              <td className={`table-cell text-right font-mono text-sm ${isBest ? 'text-purple-400 font-bold' : 'text-dark-200'}`}>
                                {lap.lapTime}
                              </td>
                              <td className="table-cell text-right font-mono text-xs text-dark-400">{lap.s1}</td>
                              <td className="table-cell text-right font-mono text-xs text-dark-400">{lap.s2}</td>
                              <td className="table-cell text-center font-mono text-dark-400 text-xs">
                                <Link to={`/info/karts/${lap.kart}`} className="hover:text-primary-400">{lap.kart}</Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
