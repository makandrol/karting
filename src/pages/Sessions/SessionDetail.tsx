import { useParams, Link } from 'react-router-dom';
import { getEventById, type CompetitionEvent, type CompetitionPhase } from '../../mock/competitionEvents';
import SessionReplay from '../../components/Timing/SessionReplay';
import { useState } from 'react';

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  // Try to find as competition event
  const event = getEventById(sessionId || '');
  const [activePhaseId, setActivePhaseId] = useState<string | null>(() => {
    // Auto-select first phase if only one (prokat)
    if (event && event.phases.length === 1) return event.phases[0].id;
    return null;
  });

  if (!event) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-white mb-2">Заїзд не знайдено</h1>
        <Link to="/sessions" className="text-primary-400 hover:underline text-sm">← Всі заїзди</Link>
      </div>
    );
  }

  const activePhase = activePhaseId ? event.phases.find(p => p.id === activePhaseId) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/sessions" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">{event.name}</h1>
          <p className="text-dark-400 text-sm">
            {new Date(event.date).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' })} •
            Траса {event.trackConfigId} • {event.phases.length} фаз
          </p>
        </div>
      </div>

      {/* Phase tabs */}
      <div className="flex flex-wrap gap-1.5">
        {event.phases.map((phase) => (
          <button
            key={phase.id}
            onClick={() => setActivePhaseId(activePhaseId === phase.id ? null : phase.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activePhaseId === phase.id ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
            }`}
          >
            {phase.type === 'qualifying' ? '⏱️' : '🏁'} {phase.name}
          </button>
        ))}
      </div>

      {/* Phase detail with replay */}
      {activePhase ? (
        <PhaseWithReplay phase={activePhase} />
      ) : (
        <div className="card text-center py-8 text-dark-500 text-sm">
          Виберіть фазу зверху для перегляду деталей та симуляції
        </div>
      )}

      {/* Overall laps grid */}
      <OverallLapsGrid event={event} />
    </div>
  );
}

function PhaseWithReplay({ phase }: { phase: CompetitionPhase }) {
  // Build laps for replay from phase results
  const replayLaps = phase.results.flatMap(r =>
    r.laps.map(l => ({
      pilot: r.pilot,
      kart: r.kart,
      lapNumber: l.lapNumber,
      lapTime: l.lapTime,
      s1: l.s1,
      s2: l.s2,
      position: r.position,
    }))
  );

  // Estimate session duration: max laps × avg lap time
  const maxLaps = Math.max(...phase.results.map(r => r.laps.length), 1);
  const avgLapSec = phase.results[0]?.laps[0]?.lapTimeSec || 42;
  const durationSec = maxLaps * avgLapSec + 30; // +30 for warmup

  return (
    <div className="space-y-4">
      {/* Results table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800">
          <h3 className="text-white font-semibold">{phase.name} — Результати</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-center w-8">Фін</th>
                <th className="table-cell text-left">Пілот</th>
                {phase.type === 'race' && <th className="table-cell text-center">Старт</th>}
                <th className="table-cell text-right">Найкращий</th>
                <th className="table-cell text-right">Бали</th>
              </tr>
            </thead>
            <tbody>
              {phase.results.map(r => (
                <tr key={r.pilot} className="table-row">
                  <td className={`table-cell text-center font-mono font-bold ${r.position <= 3 ? `position-${r.position}` : 'text-dark-400'}`}>{r.position}</td>
                  <td className="table-cell text-left">
                    <Link to={`/pilots/${encodeURIComponent(r.pilot)}`} className="text-white hover:text-primary-400 transition-colors">{r.pilot}</Link>
                  </td>
                  {phase.type === 'race' && <td className="table-cell text-center font-mono text-dark-400">{r.startPosition || '—'}</td>}
                  <td className="table-cell text-right font-mono text-green-400">{r.bestLap || '—'}</td>
                  <td className="table-cell text-right font-mono text-primary-400">{r.points ? Math.round(r.points * 10) / 10 : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Replay player */}
      {replayLaps.length > 0 && (
        <SessionReplay
          laps={replayLaps}
          durationSec={durationSec}
          title={phase.name}
        />
      )}
    </div>
  );
}

function OverallLapsGrid({ event }: { event: CompetitionEvent }) {
  // Build grid: columns = pilots sorted by best, rows = lap numbers
  const pilotBests = new Map<string, number>();

  for (const phase of event.phases) {
    for (const r of phase.results) {
      for (const l of r.laps) {
        const prev = pilotBests.get(r.pilot) || Infinity;
        if (l.lapTimeSec < prev) pilotBests.set(r.pilot, l.lapTimeSec);
      }
    }
  }

  const sortedPilots = [...pilotBests.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
  if (sortedPilots.length === 0) return null;

  // Build all laps per pilot
  const pilotLaps = new Map<string, { lapTime: string; lapTimeSec: number }[]>();
  for (const phase of event.phases) {
    for (const r of phase.results) {
      const existing = pilotLaps.get(r.pilot) || [];
      existing.push(...r.laps.map(l => ({ lapTime: l.lapTime, lapTimeSec: l.lapTimeSec })));
      pilotLaps.set(r.pilot, existing);
    }
  }

  const maxLaps = Math.max(...[...pilotLaps.values()].map(l => l.length), 0);
  const overallBest = Math.min(...[...pilotBests.values()]);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Всі кола по пілотах</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-8">Коло</th>
              {sortedPilots.map(p => (
                <th key={p} className="table-cell text-center min-w-[80px]">
                  <Link to={`/pilots/${encodeURIComponent(p)}`} className="text-white hover:text-primary-400 transition-colors">
                    {p.split(' ')[0]}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxLaps }, (_, lapIdx) => (
              <tr key={lapIdx} className="table-row">
                <td className="table-cell text-center font-mono text-dark-500">{lapIdx + 1}</td>
                {sortedPilots.map(pilot => {
                  const lap = pilotLaps.get(pilot)?.[lapIdx];
                  if (!lap) return <td key={pilot} className="table-cell text-center text-dark-700">—</td>;
                  const isBest = pilotBests.get(pilot) === lap.lapTimeSec;
                  const isOverall = Math.abs(lap.lapTimeSec - overallBest) < 0.002;
                  return (
                    <td key={pilot} className={`table-cell text-center font-mono ${
                      isOverall ? 'text-purple-400 font-bold' : isBest ? 'text-green-400 font-bold' : 'text-dark-300'
                    }`}>{lap.lapTime}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
