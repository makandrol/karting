import { useParams, Link, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { COLLECTOR_URL } from '../../services/config';
import { COMPETITION_CONFIGS, PHASE_CONFIGS, getPhaseLabel } from '../../data/competitions';
import { toSeconds } from '../../utils/timing';
import { useAuth } from '../../services/auth';

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

interface Competition {
  id: string;
  name: string;
  format: string;
  date: string;
  status: string;
  sessions: { sessionId: string; phase: string | null }[];
  results: any;
  uploaded_results: any;
}

interface SessionLap {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  ts: number;
}

export default function CompetitionPage() {
  const { type, eventId } = useParams<{ type: string; eventId?: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manage_results');

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competition, setCompetition] = useState<Competition | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'live' | 'final'>('live');

  useEffect(() => {
    if (eventId) {
      fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(eventId)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          setCompetition(data);
          if (data?.status === 'finished') setTab('final');
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else if (type) {
      fetch(`${COLLECTOR_URL}/competitions?format=${type}`)
        .then(r => r.json())
        .then(data => { setCompetitions(data); setLoading(false); })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [type, eventId]);

  const toggleStatus = async () => {
    if (!competition) return;
    const newStatus = competition.status === 'live' ? 'finished' : 'live';
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competition.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) setCompetition(await res.json());
    } catch {}
  };

  if (loading) return <div className="card text-center py-12 text-dark-500">Завантаження...</div>;

  if (!eventId && type) {
    const config = COMPETITION_CONFIGS[type as keyof typeof COMPETITION_CONFIGS];
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">{config?.name || type}</h1>
        {competitions.length === 0 ? (
          <div className="card text-center py-12 text-dark-500">Немає змагань цього типу</div>
        ) : (
          <div className="space-y-2">
            {competitions.map(c => (
              <Link key={c.id} to={`/results/${type}/${c.id}`}
                className="card p-4 block hover:bg-dark-700/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">{c.name}</div>
                    <div className="text-dark-400 text-sm">{c.date} · {c.sessions.length} заїздів</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                    c.status === 'finished' ? 'bg-dark-800 text-dark-400' : 'bg-green-500/15 text-green-400'
                  }`}>
                    {c.status === 'finished' ? 'Завершено' : 'Live'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="card text-center py-12 text-dark-500">
        <p className="mb-2">Змагання не знайдено</p>
        <Link to="/results" className="text-primary-400 hover:text-primary-300 text-sm">← Назад</Link>
      </div>
    );
  }

  const config = COMPETITION_CONFIGS[competition.format as keyof typeof COMPETITION_CONFIGS];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/results/${competition.format}`} className="text-dark-500 text-sm hover:text-dark-300 transition-colors">
            ← {config?.name || competition.format}
          </Link>
          <h1 className="text-xl font-bold text-white">{competition.name}</h1>
          <p className="text-dark-400 text-sm">{competition.sessions.length} заїздів</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
            competition.status === 'finished' ? 'bg-dark-800 text-dark-400' : 'bg-green-500/15 text-green-400'
          }`}>
            {competition.status === 'finished' ? 'Завершено' : 'Live'}
          </span>
          {canManage && (
            <button onClick={toggleStatus}
              className="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-dark-400 hover:text-white transition-colors">
              {competition.status === 'finished' ? 'Відкрити' : 'Завершити'}
            </button>
          )}
        </div>
      </div>

      <div className="flex bg-dark-800 rounded-md p-0.5 w-fit">
        <button onClick={() => setTab('live')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'live' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
          Live результати
        </button>
        <button onClick={() => setTab('final')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'final' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
          Фінальні результати
        </button>
      </div>

      {tab === 'final' ? (
        <FinalResults competition={competition} />
      ) : (
        <LiveResults competition={competition} />
      )}
    </div>
  );
}

function FinalResults({ competition }: { competition: Competition }) {
  if (!competition.uploaded_results) {
    return <div className="card text-center py-12 text-dark-500">Фінальні результати ще не завантажені</div>;
  }

  const results = competition.uploaded_results;
  if (Array.isArray(results)) {
    return (
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="table-header">
              {Object.keys(results[0] || {}).map(key => (
                <th key={key} className="table-cell text-center">{key}</th>
              ))}
            </tr></thead>
            <tbody>
              {results.map((row: any, i: number) => (
                <tr key={i} className="table-row">
                  {Object.values(row).map((val: any, j: number) => (
                    <td key={j} className="table-cell text-center font-mono text-dark-300">{String(val ?? '—')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return <div className="card p-4"><pre className="text-dark-300 text-xs overflow-auto">{JSON.stringify(results, null, 2)}</pre></div>;
}

function LiveResults({ competition }: { competition: Competition }) {
  const [sessionLaps, setSessionLaps] = useState<Map<string, SessionLap[]>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (competition.sessions.length === 0) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const map = new Map<string, SessionLap[]>();
      for (const s of competition.sessions) {
        try {
          const res = await fetch(`${COLLECTOR_URL}/db/laps?session=${s.sessionId}`);
          if (res.ok) map.set(s.sessionId, await res.json());
        } catch {}
      }
      if (!cancelled) { setSessionLaps(map); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [competition.sessions]);

  if (loading) return <div className="card text-center py-6 text-dark-500">Завантаження даних...</div>;
  if (competition.sessions.length === 0) return <div className="card text-center py-12 text-dark-500">Немає прив'язаних заїздів</div>;

  const phases = PHASE_CONFIGS[competition.format]?.phases || [];

  return (
    <div className="space-y-4">
      {competition.sessions.map(s => {
        const laps = sessionLaps.get(s.sessionId) || [];
        const phaseLabel = s.phase ? getPhaseLabel(competition.format, s.phase) : 'Невизначений етап';
        const pilotBest = new Map<string, { pilot: string; kart: number; bestTime: number; bestTimeStr: string }>();
        for (const l of laps) {
          if (!l.lap_time) continue;
          const sec = parseFloat(l.lap_time.includes(':')
            ? String(parseInt(l.lap_time) * 60 + parseFloat(l.lap_time.split(':')[1]))
            : l.lap_time);
          if (isNaN(sec) || sec < 38) continue;
          const cur = pilotBest.get(l.pilot);
          if (!cur || sec < cur.bestTime) pilotBest.set(l.pilot, { pilot: l.pilot, kart: l.kart, bestTime: sec, bestTimeStr: l.lap_time });
        }
        const sorted = [...pilotBest.values()].sort((a, b) => a.bestTime - b.bestTime);

        return (
          <div key={s.sessionId} className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800 flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">{phaseLabel}</h3>
              <span className="text-dark-500 text-[10px]">{laps.length} кіл · {pilotBest.size} пілотів</span>
            </div>
            {sorted.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="table-header">
                    <th className="table-cell text-center w-8">#</th>
                    <th className="table-cell text-left">Пілот</th>
                    <th className="table-cell text-center">Карт</th>
                    <th className="table-cell text-right">Найкращий час</th>
                  </tr></thead>
                  <tbody>
                    {sorted.map((p, i) => (
                      <tr key={p.pilot} className="table-row">
                        <td className="table-cell text-center font-mono text-white font-bold">{i + 1}</td>
                        <td className="table-cell text-left text-white">{p.pilot}</td>
                        <td className="table-cell text-center font-mono text-dark-300">{p.kart}</td>
                        <td className={`table-cell text-right font-mono font-semibold ${i === 0 ? 'text-purple-400' : 'text-green-400'}`}>
                          {toSeconds(p.bestTimeStr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-4 py-4 text-dark-600 text-sm">Немає даних</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
