import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getEventsByFormat, getEventById, type CompetitionEvent, type CompetitionPhase } from '../../mock/competitionEvents';
import type { CompetitionFormat } from '../../data/competitions';
import { COMPETITION_CONFIGS } from '../../data/competitions';
import SessionReplay from '../../components/Timing/SessionReplay';

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
  const mainCols = hasGroups ? 3 : 2; // група+старт+фініш or старт+фініш
  const pointsCols = 5; // сума, позиція, обгони, час, штрафи
  const totalSubCols = mainCols + pointsCols;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Результати ({sorted.length} пілотів)</h3>
      </div>
      <div className="overflow-x-auto">
        <style>{`.rh { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; min-height: 60px; display: inline-block; font-size: 10px; }`}</style>
        <table className="w-full text-[11px]">
          <thead>
            {/* Row 1: race names */}
            <tr className="table-header">
              <th className="table-cell text-center" rowSpan={3}>#</th>
              <th className="table-cell text-left" rowSpan={3}>Пілот</th>
              <th className="table-cell text-center border-l border-dark-700" rowSpan={3}>
                <span className="rh">Квала</span>
              </th>
              {raceRounds.map((round, ri) => (
                <th key={ri} className="table-cell text-center border-l border-dark-700 py-1" colSpan={totalSubCols}>
                  {round.name}
                </th>
              ))}
              <th className="table-cell text-center border-l border-dark-700" rowSpan={3}>
                <span className="rh">Всього</span>
              </th>
            </tr>
            {/* Row 2: main + Бали */}
            <tr className="table-header">
              {raceRounds.map((_, ri) => (
                <>
                  {hasGroups && <th key={`g${ri}`} className="table-cell text-center border-l border-dark-700 px-0" rowSpan={2}><span className="rh">група</span></th>}
                  <th key={`s${ri}`} className={`table-cell text-center px-0 ${!hasGroups ? 'border-l border-dark-700' : ''}`} rowSpan={2}><span className="rh">старт</span></th>
                  <th key={`f${ri}`} className="table-cell text-center px-0" rowSpan={2}><span className="rh">фініш</span></th>
                  <th key={`b${ri}`} className="table-cell text-center border-l border-dark-700 text-primary-400 font-bold text-[10px] py-0.5" colSpan={pointsCols}>Бали</th>
                </>
              ))}
            </tr>
            {/* Row 3: points sub-columns */}
            <tr className="table-header">
              {raceRounds.map((_, ri) => (
                <>
                  <th key={`ts${ri}`} className="table-cell text-center px-0 border-l border-dark-700"><span className="rh">сума</span></th>
                  <th key={`p${ri}`} className="table-cell text-center px-0"><span className="rh">позиція</span></th>
                  <th key={`o${ri}`} className="table-cell text-center px-0"><span className="rh">обгони</span></th>
                  <th key={`c${ri}`} className="table-cell text-center px-0"><span className="rh">час</span></th>
                  <th key={`x${ri}`} className="table-cell text-center px-0"><span className="rh">штрафи</span></th>
                </>
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
                <td className="table-cell text-center font-mono border-l border-dark-800/50">
                  {row.qualiPts > 0 ? <span className="text-primary-400 font-bold">{pts(row.qualiPts)}</span> : <span className="text-dark-700">—</span>}
                </td>
                {row.raceData.map((rd, ri) => {
                  if (!rd) {
                    const emptyCols = totalSubCols;
                    return Array.from({ length: emptyCols }, (_, ci) => (
                      <td key={`e${ri}_${ci}`} className={`table-cell text-center text-dark-700 ${ci === 0 ? 'border-l border-dark-800/50' : ''}`}>—</td>
                    ));
                  }
                  return (
                    <>{hasGroups && <td key={`g${ri}`} className="table-cell text-center font-mono text-dark-500 border-l border-dark-800/50">{rd.group}</td>}
                    <td key={`s${ri}`} className={`table-cell text-center font-mono text-dark-400 ${!hasGroups ? 'border-l border-dark-800/50' : ''}`}>{rd.start}</td>
                    <td key={`f${ri}`} className="table-cell text-center font-mono text-dark-200 font-semibold">{rd.finish}</td>
                    <td key={`ts${ri}`} className="table-cell text-center font-mono text-primary-400 font-bold border-l border-dark-800/50">{pts(rd.totalPts)}</td>
                    <td key={`p${ri}`} className="table-cell text-center font-mono text-dark-300">{rd.posPts > 0 ? pts(rd.posPts) : '—'}</td>
                    <td key={`o${ri}`} className="table-cell text-center font-mono text-dark-400">{rd.overtakePts > 0 ? pts(rd.overtakePts) : '—'}</td>
                    <td key={`c${ri}`} className="table-cell text-center font-mono text-dark-400">{rd.speedPts > 0 ? pts(rd.speedPts) : '—'}</td>
                    <td key={`x${ri}`} className={`table-cell text-center font-mono ${rd.penalty ? 'text-red-400' : 'text-dark-700'}`}>{rd.penalty ? pts(rd.penalty) : '—'}</td></>
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

/** Деталі фази — з сортуванням + реплей */
function PhaseDetail({ phase }: { phase: CompetitionPhase }) {
  const [sortBy, setSortBy] = useState<'position' | 'points'>(phase.type === 'race' ? 'position' : 'points');
  const [showReplay, setShowReplay] = useState(false);

  const sorted = [...phase.results].sort((a, b) => {
    if (sortBy === 'position') return a.position - b.position;
    return (b.points || 0) - (a.points || 0);
  });

  const isRace = phase.type === 'race';

  // Build replay data
  const replayLaps = phase.results.flatMap(r =>
    r.laps.map(l => ({ pilot: r.pilot, kart: r.kart, lapNumber: l.lapNumber, lapTime: l.lapTime, s1: l.s1, s2: l.s2, position: r.position }))
  );
  const maxLaps = Math.max(...phase.results.map(r => r.laps.length), 1);
  const avgLapSec = phase.results[0]?.laps[0]?.lapTimeSec || 42;
  const durationSec = maxLaps * avgLapSec + 30;

  return (
    <div className="space-y-4">
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800 flex items-center justify-between">
          <h3 className="text-white font-semibold">{phase.name}</h3>
          <div className="flex items-center gap-3">
            {/* Replay button */}
            <button
              onClick={() => setShowReplay(!showReplay)}
              className={`text-[10px] px-3 py-1 rounded-md font-semibold transition-colors flex items-center gap-1 ${
                showReplay ? 'bg-primary-600 text-white' : 'bg-primary-600/20 text-primary-400 hover:bg-primary-600/30'
              }`}
            >
              ▶ Реплей
            </button>

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

    {/* Inline replay */}
    {showReplay && replayLaps.length > 0 && (
      <SessionReplay laps={replayLaps} durationSec={durationSec} title={phase.name} />
    )}
    </div>
  );
}
