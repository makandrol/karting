import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getEventsByFormat, getEventById, type CompetitionEvent, type CompetitionPhase } from '../../mock/competitionEvents';
import type { CompetitionFormat } from '../../data/competitions';
import { COMPETITION_CONFIGS } from '../../data/competitions';

const FORMAT_MAP: Record<string, CompetitionFormat> = {
  gonzales: 'gonzales',
  'light-league': 'light_league',
  'champions-league': 'champions_league',
  sprints: 'sprint',
  marathons: 'marathon',
};

export default function CompetitionPage() {
  const { type, eventId, phaseId } = useParams<{ type: string; eventId?: string; phaseId?: string }>();
  const format = FORMAT_MAP[type || ''];
  const config = format ? COMPETITION_CONFIGS[format] : null;
  const events = format ? getEventsByFormat(format) : [];

  const selectedEvent = eventId ? getEventById(eventId) : events[events.length - 1];
  const selectedPhase = phaseId && selectedEvent
    ? selectedEvent.phases.find(p => p.id === phaseId) ?? null
    : null;

  if (!config) {
    return <div className="text-center py-20 text-dark-500">Невідомий тип змагань</div>;
  }

  return (
    <div className="flex gap-6 min-h-[60vh]">
      {/* Left sidebar — list of events */}
      <div className="w-56 shrink-0 hidden lg:block">
        <h3 className="text-dark-400 text-xs font-semibold uppercase tracking-wider mb-3">{config.name}</h3>
        <div className="space-y-1">
          {events.map((ev) => (
            <Link
              key={ev.id}
              to={`/results/${type}/${ev.id}`}
              className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedEvent?.id === ev.id
                  ? 'bg-primary-600/20 text-primary-400'
                  : 'text-dark-400 hover:text-white hover:bg-dark-800'
              }`}
            >
              <div className="font-medium">{new Date(ev.date).toLocaleDateString('uk-UA')}</div>
              <div className="text-xs text-dark-500">Траса {ev.trackConfigId}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 space-y-6">
        {/* Mobile event selector */}
        <div className="lg:hidden">
          <select
            value={selectedEvent?.id || ''}
            onChange={(e) => { if (e.target.value) window.location.href = `/results/${type}/${e.target.value}`; }}
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-3 py-2 text-sm"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {new Date(ev.date).toLocaleDateString('uk-UA')} — Траса {ev.trackConfigId}
              </option>
            ))}
          </select>
        </div>

        {selectedEvent ? (
          <EventDetail event={selectedEvent} type={type || ''} selectedPhase={selectedPhase} />
        ) : (
          <div className="card text-center py-12 text-dark-500">
            Виберіть змагання зліва
          </div>
        )}
      </div>
    </div>
  );
}

function EventDetail({ event, type, selectedPhase }: { event: CompetitionEvent; type: string; selectedPhase: CompetitionPhase | null }) {
  const [activePhaseId, setActivePhaseId] = useState<string | null>(selectedPhase?.id || null);
  const activePhase = activePhaseId ? event.phases.find(p => p.id === activePhaseId) : null;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">{event.name}</h1>
        <p className="text-dark-400 text-sm">
          {new Date(event.date).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' })} •
          Траса {event.trackConfigId}
        </p>
      </div>

      {/* Phase tabs */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActivePhaseId(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            !activePhaseId ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
          }`}
        >
          📊 Результати
        </button>
        {event.phases.map((phase) => (
          <button
            key={phase.id}
            onClick={() => setActivePhaseId(phase.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activePhaseId === phase.id ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
            }`}
          >
            {phase.type === 'qualifying' ? '⏱️' : phase.type === 'gonzales_round' ? '🔄' : '🏁'} {phase.name}
          </button>
        ))}
      </div>

      {/* Content */}
      {activePhase ? (
        <PhaseDetail phase={activePhase} />
      ) : (
        <OverallResults event={event} />
      )}
    </>
  );
}

function OverallResults({ event }: { event: CompetitionEvent }) {
  // Aggregate total points per pilot
  const pilotData = new Map<string, { totalPoints: number; qualiPts: number; racePts: number }>();

  for (const phase of event.phases) {
    for (const r of phase.results) {
      const prev = pilotData.get(r.pilot) || { totalPoints: 0, qualiPts: 0, racePts: 0 };
      const pts = r.points || 0;
      if (phase.type === 'qualifying') {
        prev.qualiPts += pts;
      } else {
        prev.racePts += pts;
      }
      prev.totalPoints += pts;
      pilotData.set(r.pilot, prev);
    }
  }

  const sorted = [...pilotData.entries()]
    .sort((a, b) => b[1].totalPoints - a[1].totalPoints)
    .map(([pilot, data], i) => ({ pilot, ...data, pos: i + 1 }));

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Загальні результати</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-10">#</th>
              <th className="table-cell text-left">Пілот</th>
              <th className="table-cell text-right">Квала</th>
              <th className="table-cell text-right">Гонки</th>
              <th className="table-cell text-right font-bold">Всього</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.pilot} className="table-row">
                <td className={`table-cell text-center font-mono font-bold ${
                  row.pos === 1 ? 'position-1' : row.pos === 2 ? 'position-2' : row.pos === 3 ? 'position-3' : 'text-dark-400'
                }`}>{row.pos}</td>
                <td className="table-cell text-left">
                  <Link to={`/pilots/${encodeURIComponent(row.pilot)}`} className="text-white hover:text-primary-400 font-medium transition-colors text-sm">
                    {row.pilot}
                  </Link>
                </td>
                <td className="table-cell text-right font-mono text-dark-300 text-sm">{row.qualiPts > 0 ? row.qualiPts.toFixed(1) : '—'}</td>
                <td className="table-cell text-right font-mono text-dark-300 text-sm">{row.racePts > 0 ? row.racePts.toFixed(1) : '—'}</td>
                <td className="table-cell text-right font-mono text-primary-400 font-bold text-sm">{row.totalPoints.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PhaseDetail({ phase }: { phase: CompetitionPhase }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">{phase.name}</h3>
      </div>
      <table className="w-full">
        <thead>
          <tr className="table-header">
            <th className="table-cell text-center w-10">#</th>
            <th className="table-cell text-left">Пілот</th>
            <th className="table-cell text-center">Карт</th>
            <th className="table-cell text-right">Найкращий</th>
            {phase.type === 'race' && <th className="table-cell text-center">Старт</th>}
            {phase.type === 'race' && <th className="table-cell text-center">Обгони</th>}
            <th className="table-cell text-right">Бали</th>
            <th className="table-cell text-center">Кіл</th>
          </tr>
        </thead>
        <tbody>
          {phase.results.map((r, idx) => (
            <tr key={r.pilot} className="table-row">
              <td className={`table-cell text-center font-mono font-bold ${
                idx === 0 ? 'position-1' : idx === 1 ? 'position-2' : idx === 2 ? 'position-3' : 'text-dark-400'
              }`}>{r.position}</td>
              <td className="table-cell text-left">
                <Link to={`/pilots/${encodeURIComponent(r.pilot)}`} className="text-white hover:text-primary-400 font-medium transition-colors">
                  {r.pilot}
                </Link>
              </td>
              <td className="table-cell text-center font-mono text-dark-300">
                <Link to={`/info/karts/${r.kart}`} className="hover:text-primary-400 transition-colors">{r.kart}</Link>
              </td>
              <td className={`table-cell text-right font-mono font-semibold ${idx === 0 ? 'text-purple-400' : 'text-green-400'}`}>
                {r.bestLap}
              </td>
              {phase.type === 'race' && (
                <td className="table-cell text-center font-mono text-dark-400 text-xs">{r.startPosition}</td>
              )}
              {phase.type === 'race' && (
                <td className="table-cell text-center font-mono text-dark-400 text-xs">
                  {r.overtakes ? `+${r.overtakes}` : '—'}
                </td>
              )}
              <td className="table-cell text-right font-mono text-primary-400 text-sm">{r.points || '—'}</td>
              <td className="table-cell text-center font-mono text-dark-500 text-xs">{r.laps.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
