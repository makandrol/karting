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

function pts(v: number): string {
  if (!v) return '—';
  return (Math.round(v * 10) / 10).toString();
}

export default function CompetitionPage() {
  const { type, eventId, phaseId } = useParams<{ type: string; eventId?: string; phaseId?: string }>();
  const format = FORMAT_MAP[type || ''];
  const config = format ? COMPETITION_CONFIGS[format] : null;
  const events = format ? getEventsByFormat(format) : [];
  const selectedEvent = eventId ? getEventById(eventId) : events[events.length - 1];
  const selectedPhase = phaseId && selectedEvent ? selectedEvent.phases.find(p => p.id === phaseId) ?? null : null;

  if (!config) return <div className="text-center py-20 text-dark-500">Невідомий тип змагань</div>;

  return (
    <div className="flex gap-6 min-h-[60vh]">
      <div className="w-56 shrink-0 hidden lg:block">
        <h3 className="text-dark-400 text-xs font-semibold uppercase tracking-wider mb-3">{config.name}</h3>
        <div className="space-y-1">
          {events.map((ev) => (
            <Link key={ev.id} to={`/results/${type}/${ev.id}`}
              className={`block px-3 py-2 rounded-lg text-sm transition-colors ${selectedEvent?.id === ev.id ? 'bg-primary-600/20 text-primary-400' : 'text-dark-400 hover:text-white hover:bg-dark-800'}`}>
              <div className="font-medium">{new Date(ev.date).toLocaleDateString('uk-UA')}</div>
              <div className="text-xs text-dark-500">Траса {ev.trackConfigId} • {ev.phases[0]?.results?.length || 0} піл.</div>
            </Link>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-6">
        <div className="lg:hidden">
          <select value={selectedEvent?.id || ''} onChange={(e) => { if (e.target.value) window.location.href = `/results/${type}/${e.target.value}`; }}
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-3 py-2 text-sm">
            {events.map((ev) => <option key={ev.id} value={ev.id}>{new Date(ev.date).toLocaleDateString('uk-UA')}</option>)}
          </select>
        </div>
        {selectedEvent ? <EventDetail event={selectedEvent} type={type || ''} selectedPhase={selectedPhase} /> : <div className="card text-center py-12 text-dark-500">Виберіть змагання</div>}
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
        <h1 className="text-xl font-bold text-white mb-1">{event.name}</h1>
        <p className="text-dark-400 text-sm">
          {new Date(event.date).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' })} • Траса {event.trackConfigId} • {event.phases[0]?.results?.length || 0} пілотів
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setActivePhaseId(null)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!activePhaseId ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'}`}>
          📊 Результати
        </button>
        {event.phases.map((phase) => (
          <button key={phase.id} onClick={() => setActivePhaseId(phase.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activePhaseId === phase.id ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'}`}>
            {phase.type === 'qualifying' ? '⏱️' : phase.type === 'gonzales_round' ? '🔄' : '🏁'} {phase.name}
          </button>
        ))}
      </div>
      {activePhase ? <PhaseDetail phase={activePhase} /> : <OverallResults event={event} />}
    </>
  );
}

/** Загальні результати */
function OverallResults({ event }: { event: CompetitionEvent }) {
  const races = event.phases.filter(p => p.type === 'race');
  const qualiPhase = event.phases.find(p => p.type === 'qualifying');

  // Group races into rounds
  const raceRounds: { name: string; phases: CompetitionPhase[] }[] = [];
  for (const phase of races) {
    const m = phase.name.match(/Гонка (\d+)/);
    const rName = m ? `Гонка ${m[1]}` : phase.name;
    let round = raceRounds.find(r => r.name === rName);
    if (!round) { round = { name: rName, phases: [] }; raceRounds.push(round); }
    round.phases.push(phase);
  }

  interface RaceData {
    group: number; start: number; finish: number;
    totalPts: number; posPts: number; overtakePts: number; speedPts: number; penalty: number;
  }
  interface PilotRow {
    pos: number; pilot: string; qualiPts: number;
    raceData: (RaceData | null)[];
    grandTotal: number;
  }

  const pilotMap = new Map<string, PilotRow>();
  const emptyRaces = () => raceRounds.map(() => null as RaceData | null);

  if (qualiPhase) {
    for (const r of qualiPhase.results) {
      pilotMap.set(r.pilot, { pos: 0, pilot: r.pilot, qualiPts: Math.round((r.points || 0) * 10) / 10, raceData: emptyRaces(), grandTotal: 0 });
    }
  }

  raceRounds.forEach((round, ri) => {
    for (const phase of round.phases) {
      const gMatch = phase.name.match(/Група (\d+)/);
      const groupNum = gMatch ? parseInt(gMatch[1]) : 1;
      for (const r of phase.results) {
        if (!pilotMap.has(r.pilot)) pilotMap.set(r.pilot, { pos: 0, pilot: r.pilot, qualiPts: 0, raceData: emptyRaces(), grandTotal: 0 });
        const row = pilotMap.get(r.pilot)!;
        row.raceData[ri] = {
          group: groupNum,
          start: r.startPosition || 0,
          finish: r.position,
          totalPts: Math.round((r.points || 0) * 10) / 10,
          posPts: Math.round((r.positionPoints || 0) * 10) / 10,
          overtakePts: Math.round((r.overtakePoints || 0) * 10) / 10,
          speedPts: Math.round((r.speedPoints || 0) * 10) / 10,
          penalty: Math.round((r.penalty || 0) * 10) / 10,
        };
      }
    }
  });

  for (const [, row] of pilotMap) {
    row.grandTotal = Math.round((row.qualiPts + row.raceData.reduce((s, r) => s + (r?.totalPts || 0), 0)) * 10) / 10;
  }
  const sorted = [...pilotMap.values()].sort((a, b) => b.grandTotal - a.grandTotal);
  sorted.forEach((r, i) => r.pos = i + 1);

  const hasGroups = sorted.some(r => r.raceData.some(rd => rd && rd.group > 1));

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Результати ({sorted.length} пілотів)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center" rowSpan={2}>#</th>
              <th className="table-cell text-left" rowSpan={2}>Пілот</th>
              <th className="table-cell text-center border-l border-dark-700" rowSpan={2}>Квала</th>
              {raceRounds.map((round, ri) => (
                <th key={ri} className="table-cell text-center border-l border-dark-700"
                    colSpan={hasGroups ? 7 : 6}>{round.name}</th>
              ))}
              <th className="table-cell text-center border-l border-dark-700 font-bold" rowSpan={2}>∑</th>
            </tr>
            <tr className="table-header text-[9px]">
              {raceRounds.map((_, ri) => (
                <>{hasGroups && <th key={`g${ri}`} className="table-cell text-center border-l border-dark-700">гр</th>}
                <th key={`s${ri}`} className={`table-cell text-center ${!hasGroups ? 'border-l border-dark-700' : ''}`}>ст</th>
                <th key={`f${ri}`} className="table-cell text-center">фін</th>
                <th key={`t${ri}`} className="table-cell text-center font-bold">бал</th>
                <th key={`p${ri}`} className="table-cell text-center">поз</th>
                <th key={`o${ri}`} className="table-cell text-center">обг</th>
                <th key={`c${ri}`} className="table-cell text-center">час</th></>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.pilot} className="table-row">
                <td className={`table-cell text-center font-mono font-bold ${row.pos <= 3 ? `position-${row.pos}` : 'text-dark-400'}`}>{row.pos}</td>
                <td className="table-cell text-left whitespace-nowrap">
                  <Link to={`/pilots/${encodeURIComponent(row.pilot)}`} className="text-white hover:text-primary-400 font-medium transition-colors">
                    {row.pilot}
                  </Link>
                </td>
                <td className="table-cell text-center font-mono text-dark-300 border-l border-dark-800/50">
                  {row.qualiPts > 0 ? pts(row.qualiPts) : '—'}
                </td>
                {row.raceData.map((rd, ri) => {
                  if (!rd) return (
                    <>{hasGroups && <td key={`g${ri}`} className="table-cell text-center text-dark-700 border-l border-dark-800/50">—</td>}
                    <td key={`s${ri}`} className={`table-cell text-center text-dark-700 ${!hasGroups ? 'border-l border-dark-800/50' : ''}`}>—</td>
                    <td key={`f${ri}`} className="table-cell text-center text-dark-700">—</td>
                    <td key={`t${ri}`} className="table-cell text-center text-dark-700">—</td>
                    <td key={`p${ri}`} className="table-cell text-center text-dark-700">—</td>
                    <td key={`o${ri}`} className="table-cell text-center text-dark-700">—</td>
                    <td key={`c${ri}`} className="table-cell text-center text-dark-700">—</td></>
                  );
                  return (
                    <>{hasGroups && <td key={`g${ri}`} className="table-cell text-center font-mono text-dark-500 border-l border-dark-800/50">{rd.group}</td>}
                    <td key={`s${ri}`} className={`table-cell text-center font-mono text-dark-400 ${!hasGroups ? 'border-l border-dark-800/50' : ''}`}>{rd.start}</td>
                    <td key={`f${ri}`} className="table-cell text-center font-mono text-dark-200 font-semibold">{rd.finish}</td>
                    <td key={`t${ri}`} className="table-cell text-center font-mono text-primary-400 font-bold">{pts(rd.totalPts)}</td>
                    <td key={`p${ri}`} className="table-cell text-center font-mono text-dark-300">{rd.posPts > 0 ? pts(rd.posPts) : '—'}</td>
                    <td key={`o${ri}`} className="table-cell text-center font-mono text-dark-400">{rd.overtakePts > 0 ? pts(rd.overtakePts) : '—'}</td>
                    <td key={`c${ri}`} className="table-cell text-center font-mono text-dark-400">{rd.speedPts > 0 ? pts(rd.speedPts) : '—'}{rd.penalty ? ` ${pts(rd.penalty)}` : ''}</td></>
                  );
                })}
                <td className="table-cell text-center font-mono text-primary-400 font-bold border-l border-dark-800/50">{pts(row.grandTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Деталі фази — з сортуванням */
function PhaseDetail({ phase }: { phase: CompetitionPhase }) {
  const [sortBy, setSortBy] = useState<'position' | 'points'>(phase.type === 'race' ? 'position' : 'points');

  const sorted = [...phase.results].sort((a, b) => {
    if (sortBy === 'position') return a.position - b.position;
    return (b.points || 0) - (a.points || 0);
  });

  const isRace = phase.type === 'race';

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800 flex items-center justify-between">
        <h3 className="text-white font-semibold">{phase.name}</h3>
        <div className="flex items-center gap-3">
          {/* TODO: link to demo replay */}
          {isRace && (
            <div className="flex bg-dark-800 rounded-md p-0.5">
              <button onClick={() => setSortBy('position')}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded ${sortBy === 'position' ? 'bg-primary-600 text-white' : 'text-dark-400'}`}>
                Позиція
              </button>
              <button onClick={() => setSortBy('points')}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded ${sortBy === 'points' ? 'bg-primary-600 text-white' : 'text-dark-400'}`}>
                Бали
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              {!isRace && <th className="table-cell text-center w-10">#</th>}
              <th className="table-cell text-left">Пілот</th>
              {isRace && <th className="table-cell text-center">Старт</th>}
              {isRace && <th className="table-cell text-center">Фініш</th>}
              {isRace && <th className="table-cell text-center">Обгони</th>}
              <th className="table-cell text-right">Бали</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const overtakes = (r.startPosition || 0) - r.position;
              // For points breakdown: total = posPts + overtakePts (we only have total, but show the format)
              const total = Math.round((r.points || 0) * 10) / 10;

              return (
                <tr key={r.pilot} className="table-row">
                  {!isRace && (
                    <td className={`table-cell text-center font-mono font-bold ${r.position <= 3 ? `position-${r.position}` : 'text-dark-400'}`}>{r.position}</td>
                  )}
                  <td className="table-cell text-left">
                    <Link to={`/pilots/${encodeURIComponent(r.pilot)}`} className="text-white hover:text-primary-400 font-medium transition-colors text-sm">{r.pilot}</Link>
                  </td>
                  {isRace && <td className="table-cell text-center font-mono text-dark-400 text-sm">{r.startPosition || '—'}</td>}
                  {isRace && (
                    <td className={`table-cell text-center font-mono font-semibold text-sm ${r.position <= 3 ? `position-${r.position}` : 'text-dark-200'}`}>{r.position}</td>
                  )}
                  {isRace && (
                    <td className={`table-cell text-center font-mono text-sm ${overtakes > 0 ? 'text-green-400' : overtakes < 0 ? 'text-red-400' : 'text-dark-500'}`}>
                      {overtakes > 0 ? `+${overtakes}` : overtakes < 0 ? overtakes : '—'}
                    </td>
                  )}
                  <td className="table-cell text-right font-mono text-primary-400 font-semibold text-sm">
                    {total > 0 ? pts(total) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
