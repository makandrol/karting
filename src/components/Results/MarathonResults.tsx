import { useMemo, useState } from 'react';
import { parseMarathon, type MarathonTeam, type MarathonStint } from '../../utils/marathon';
import { computePitLane, pitKey, type PitRow, type PitRowOverrides, type PitLaneCar } from '../../utils/marathonPitLane';
import { KART_COLOR, shortPilot } from '../../utils/timing';
import { useLocalStorage } from '../../services/useLocalStorage';
import { EmptyState } from '../States';

/** seconds → "12.345" (lap) */
function lapStr(sec: number | null): string {
  return sec == null ? '—' : sec.toFixed(3);
}

/** seconds → "1:30.5" (pit duration) */
function pitDurStr(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}с`;
}

/** race elapsed seconds → "M:SS" or "H:MM:SS" */
function raceTimeStr(sec: number): string {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** duration seconds → "Mхв" / "Mхв Sс" / "Sс" */
function durationStr(sec: number): string {
  if (sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m === 0) return `${s}с`;
  return s === 0 ? `${m}хв` : `${m}хв ${s}с`;
}

interface MarathonResultsProps {
  /** Raw events for the (merged) session. */
  events: any[];
  sessionStartTime: number;
  /** Current replay time (seconds from start) — used for the live pit field. */
  currentTimeSec?: number;
  /** Sub-section ids to render (for layout control). Defaults to all. */
  sections?: ('marathonPit' | 'marathonTeams' | 'marathonKarts')[];
  /** Manual pit-row assignments (key `${startKart}|${startTs}` → 'L'|'R'). */
  pitRowOverrides?: PitRowOverrides;
  /** Persist a changed pit-row override map. If absent, editing is disabled. */
  onPitRowOverridesChange?: (next: PitRowOverrides) => void;
}

export default function MarathonResults({ events, sessionStartTime, currentTimeSec, sections, pitRowOverrides, onPitRowOverridesChange }: MarathonResultsProps) {
  const [trimBest, setTrimBest] = useLocalStorage('karting_marathon_trim_best', 0);
  const [trimWorst, setTrimWorst] = useLocalStorage('karting_marathon_trim_worst', 0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const model = useMemo(
    () => parseMarathon(events, { trimBest, trimWorst }),
    [events, trimBest, trimWorst]
  );

  const show = (id: 'marathonPit' | 'marathonTeams' | 'marathonKarts') => !sections || sections.includes(id);

  const currentMs = currentTimeSec != null ? sessionStartTime + currentTimeSec * 1000 : null;
  const pitLane = useMemo(() => {
    if (currentMs == null) return null;
    return computePitLane(model.pitIntervals, pitRowOverrides ?? {}, currentMs);
  }, [model.pitIntervals, pitRowOverrides, currentMs]);

  if (model.teams.length === 0) {
    return <EmptyState title="Немає даних марафону" />;
  }

  const toggle = (k: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const setPitRow = (car: PitLaneCar, row: PitRow | null) => {
    if (!onPitRowOverridesChange) return;
    const key = pitKey(car);
    const next = { ...(pitRowOverrides ?? {}) };
    if (row == null) delete next[key];
    else next[key] = row;
    onPitRowOverridesChange(next);
  };

  return (
    <div className="space-y-6">
      {show('marathonPit') && pitLane != null && (
        <PitField lane={pitLane} canEdit={!!onPitRowOverridesChange} onSetRow={setPitRow} />
      )}

      {show('marathonTeams') && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-dark-800 flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-white font-semibold">Команди</h3>
            <TrimControls
              trimBest={trimBest} trimWorst={trimWorst}
              onBest={setTrimBest} onWorst={setTrimWorst}
            />
          </div>
          <div className="divide-y divide-dark-800">
            {model.teams.map(team => (
              <TeamRow
                key={team.startKart}
                team={team}
                sessionStartTime={sessionStartTime}
                open={expanded.has(team.startKart)}
                onToggle={() => toggle(team.startKart)}
              />
            ))}
          </div>
        </div>
      )}

      {show('marathonKarts') && (
        <KartStatsTable kartStats={model.kartStats} />
      )}
    </div>
  );
}

function TrimControls({ trimBest, trimWorst, onBest, onWorst }: {
  trimBest: number; trimWorst: number;
  onBest: (n: number) => void; onWorst: (n: number) => void;
}) {
  const Stepper = ({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) => (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-dark-400">{label}</span>
      <button onClick={() => onChange(Math.max(0, value - 1))}
        className="w-5 h-5 rounded bg-dark-800 text-dark-300 hover:bg-dark-700 hover:text-white leading-none">−</button>
      <span className="w-5 text-center font-mono text-white">{value}</span>
      <button onClick={() => onChange(value + 1)}
        className="w-5 h-5 rounded bg-dark-800 text-dark-300 hover:bg-dark-700 hover:text-white leading-none">+</button>
    </div>
  );
  return (
    <div className="flex items-center gap-3" title="Середнє коло без X найкращих і Y найгірших кіл">
      <Stepper label="− найкращих" value={trimBest} onChange={onBest} />
      <Stepper label="− найгірших" value={trimWorst} onChange={onWorst} />
    </div>
  );
}

function PitField({ lane, canEdit, onSetRow }: {
  lane: import('../../utils/marathonPitLane').PitLaneState;
  canEdit: boolean;
  onSetRow: (car: PitLaneCar, row: PitRow | null) => void;
}) {
  const labelKart = (k: number | null) => (k && k > 0 ? `Карт ${k}` : 'Карт ?');
  const total = lane.waiting.length + lane.left.length + lane.right.length;

  const CarCard = ({ car }: { car: PitLaneCar }) => (
    <div className="rounded-lg border bg-yellow-600/15 border-yellow-600/30 px-2.5 py-2">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-white text-xs font-medium truncate max-w-[130px]">{car.teamName}</span>
        <span className="text-yellow-400 text-[11px] font-mono font-bold">{pitDurStr(car.pitElapsedSec)}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
        {car.pilotName && !car.pilotName.startsWith('Карт') && (
          <span className="text-dark-300">{shortPilot(car.pilotName)}</span>
        )}
        <span className={`font-mono ${KART_COLOR}`}>заїхав на {labelKart(car.kartIn)}</span>
        {car.segBestLapSec != null && <span className="text-green-400 font-mono">{lapStr(car.segBestLapSec)}</span>}
        {car.segDurationSec != null && <span className="text-dark-400 font-mono">{durationStr(car.segDurationSec)}</span>}
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 mt-1">
          <button onClick={() => onSetRow(car, 'L')}
            className={`px-1.5 py-0.5 rounded text-[9px] ${car.row === 'L' ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'}`}>Лівий</button>
          <button onClick={() => onSetRow(car, 'R')}
            className={`px-1.5 py-0.5 rounded text-[9px] ${car.row === 'R' ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'}`}>Правий</button>
          {car.row && (
            <button onClick={() => onSetRow(car, null)}
              className="px-1.5 py-0.5 rounded text-[9px] bg-dark-800 text-dark-500 hover:text-yellow-400">скинути</button>
          )}
        </div>
      )}
    </div>
  );

  const RowColumn = ({ title, cars, parked }: { title: string; cars: PitLaneCar[]; parked: number[] }) => (
    <div className="rounded-lg border border-dark-700 bg-dark-800/30 p-2">
      <div className="text-dark-400 text-[10px] uppercase tracking-wider font-semibold mb-1.5">{title} ряд</div>
      <div className="space-y-1.5">
        {cars.length === 0 && parked.length === 0 && (
          <div className="text-dark-600 text-xs px-1 py-2">порожньо</div>
        )}
        {/* Driver(s) at the front (taking a head kart). */}
        {cars.map(car => <CarCard key={pitKey(car)} car={car} />)}
        {/* Karts parked at the back of this row. */}
        {parked.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {parked.map((k, i) => (
              <span key={i} className={`font-mono text-[10px] px-1.5 py-0.5 rounded bg-dark-800 ${KART_COLOR}`} title="Карт припаркований у цьому ряду">{labelKart(k)}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-dark-400 text-xs font-semibold uppercase tracking-wider">На піт-стопі зараз</span>
        <span className="text-dark-600 text-xs">({total})</span>
      </div>

      {/* Waiting list — full width, arrival order, no row yet. */}
      {lane.waiting.length > 0 && (
        <div className="mb-3">
          <div className="text-dark-500 text-[10px] uppercase tracking-wider mb-1">Очікують (ряд невідомий)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {lane.waiting.map(car => <CarCard key={pitKey(car)} car={car} />)}
          </div>
        </div>
      )}

      {/* Two rows: Left | Right. */}
      <div className="grid grid-cols-2 gap-2">
        <RowColumn title="Лівий" cars={lane.left} parked={lane.leftParked} />
        <RowColumn title="Правий" cars={lane.right} parked={lane.rightParked} />
      </div>

      {total === 0 && lane.leftParked.length === 0 && lane.rightParked.length === 0 && (
        <div className="text-dark-500 text-sm mt-2">Зараз нікого на піту</div>
      )}
    </div>
  );
}

function TeamRow({ team, sessionStartTime, open, onToggle }: { team: MarathonTeam; sessionStartTime: number; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-dark-800/50 transition-colors text-left">
        <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''} text-dark-500`}>&#9654;</span>
        {team.lastPosition != null && (
          <span className="font-mono font-bold text-white w-6 text-center">{team.lastPosition}</span>
        )}
        <span className={`font-mono text-xs ${KART_COLOR} w-8`}>#{team.startKart}</span>
        <span className="text-white font-medium flex-1 min-w-0 truncate">{team.teamName}</span>
        <span className="text-dark-400 text-xs hidden sm:inline">{team.pilots.map(shortPilot).join(', ')}</span>
        <span className="text-dark-300 text-xs font-mono">{team.totalLaps} кіл</span>
        <span className="text-dark-300 text-xs">{team.pitStops.length} піт</span>
        <span className="text-dark-400 text-xs font-mono w-20 text-right">{team.gapLabel || (team.lastPosition === 1 ? 'лідер' : '')}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dark-500">
                <th className="text-left font-medium py-1 pr-3">Пілот</th>
                <th className="text-center font-medium py-1 px-2">Карт</th>
                <th className="text-center font-medium py-1 px-2">Кіл</th>
                <th className="text-right font-medium py-1 px-2">Найкраще</th>
                <th className="text-right font-medium py-1 px-2">Середнє</th>
                <th className="text-right font-medium py-1 pl-2">Піт-стоп</th>
              </tr>
            </thead>
            <tbody>
              {team.stints.map((stint, i) => (
                <StintRow key={i} stint={stint} pit={team.pitStops[i]} sessionStartTime={sessionStartTime} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StintRow({ stint, pit, sessionStartTime }: { stint: MarathonStint; pit?: { lapNumber: number; durationSec: number | null; ts: number }; sessionStartTime: number }) {
  return (
    <tr className="border-t border-dark-800/60">
      <td className="text-left py-1.5 pr-3 text-white">
        {stint.pilotName.startsWith('Карт') ? stint.pilotName : shortPilot(stint.pilotName)}
      </td>
      <td className={`text-center py-1.5 px-2 font-mono ${KART_COLOR}`}>{stint.kart}</td>
      <td className="text-center py-1.5 px-2 font-mono text-dark-300">{stint.lapCount}</td>
      <td className="text-right py-1.5 px-2 font-mono text-green-400">{lapStr(stint.bestLapSec)}</td>
      <td className="text-right py-1.5 px-2 font-mono text-dark-200">{lapStr(stint.avgLapSec)}</td>
      <td className="text-right py-1.5 pl-2 font-mono text-dark-300">
        {pit ? (
          <span title={`Піт-стоп після кола ${pit.lapNumber}`}>
            <span className="text-dark-500">К{pit.lapNumber} · </span>
            <span className="text-primary-400">{raceTimeStr((pit.ts - sessionStartTime) / 1000)}</span>
            <span className="text-dark-500"> · </span>
            {pitDurStr(pit.durationSec)}
          </span>
        ) : '—'}
      </td>
    </tr>
  );
}

function KartStatsTable({ kartStats }: { kartStats: ReturnType<typeof parseMarathon>['kartStats'] }) {
  if (kartStats.length === 0) return null;

  type FlatRow = {
    kart: number;
    pilotName: string;
    teamName: string;
    bestLapSec: number | null;
    avgLapSec: number | null;
    durationSec: number;
  };
  const flatRows: FlatRow[] = [];
  for (const ks of kartStats) {
    for (const u of ks.usages) {
      flatRows.push({
        kart: ks.kart,
        pilotName: u.pilotName,
        teamName: u.teamName,
        bestLapSec: u.bestLapSec,
        avgLapSec: u.avgLapSec,
        durationSec: u.drivenSec,
      });
    }
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Статистика по картах</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="table-header">
              <th className="text-center w-12 px-1 py-1.5">Карт</th>
              <th className="text-left pl-3 pr-1 py-1.5">Пілот</th>
              <th className="text-right px-2 py-1.5">Найкраще</th>
              <th className="text-right px-2 py-1.5">Середнє</th>
              <th className="text-right px-2 py-1.5">Тривалість</th>
            </tr>
          </thead>
          <tbody>
            {flatRows.map((r, i) => {
              const isFirstOfKart = i === 0 || flatRows[i - 1].kart !== r.kart;
              const groupSize = flatRows.filter(x => x.kart === r.kart).length;
              return (
                <tr key={`${r.kart}-${i}`}
                  className={`${isFirstOfKart && i > 0 ? 'border-t-[6px] border-t-dark-950' : 'border-t border-dark-800/40'} hover:bg-dark-800/30`}>
                  {isFirstOfKart ? (
                    <td rowSpan={groupSize} className={`text-center align-middle border-r-2 border-dark-700 bg-dark-900/60 font-mono font-extrabold text-2xl ${KART_COLOR}`}>
                      {r.kart}
                    </td>
                  ) : null}
                  <td className="text-left pl-3 pr-1 py-1 text-white whitespace-nowrap">
                    {r.pilotName.startsWith('Карт') ? r.pilotName : shortPilot(r.pilotName)}
                    <span className="text-dark-500 text-[10px] ml-1.5">{r.teamName}</span>
                  </td>
                  <td className="text-right px-2 py-1 font-mono text-green-400 font-semibold">{lapStr(r.bestLapSec)}</td>
                  <td className="text-right px-2 py-1 font-mono text-dark-200">{lapStr(r.avgLapSec)}</td>
                  <td className="text-right px-2 py-1 font-mono text-dark-300 whitespace-nowrap">{durationStr(r.durationSec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
