import { useMemo, useState } from 'react';
import { parseMarathon, type MarathonTeam, type MarathonStint } from '../../utils/marathon';
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

/** seconds → "Xхв" driven time */
function minutesStr(sec: number): string {
  return `${Math.round(sec / 60)} хв`;
}

interface MarathonResultsProps {
  /** Raw events for the (merged) session. */
  events: any[];
  sessionStartTime: number;
  /** Current replay time (seconds from start) — used for the live pit field. */
  currentTimeSec?: number;
  /** Sub-section ids to render (for layout control). Defaults to all. */
  sections?: ('marathonPit' | 'marathonTeams' | 'marathonKarts')[];
}

export default function MarathonResults({ events, sessionStartTime, currentTimeSec, sections }: MarathonResultsProps) {
  const [trimBest, setTrimBest] = useLocalStorage('karting_marathon_trim_best', 0);
  const [trimWorst, setTrimWorst] = useLocalStorage('karting_marathon_trim_worst', 0);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const model = useMemo(
    () => parseMarathon(events, { trimBest, trimWorst }),
    [events, trimBest, trimWorst]
  );

  const show = (id: 'marathonPit' | 'marathonTeams' | 'marathonKarts') => !sections || sections.includes(id);

  const currentMs = currentTimeSec != null ? sessionStartTime + currentTimeSec * 1000 : null;
  const onPitNow = useMemo(() => {
    if (currentMs == null) return [];
    return model.pitIntervals.filter(p => currentMs >= p.startTs && currentMs <= p.endTs);
  }, [model.pitIntervals, currentMs]);

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

  return (
    <div className="space-y-6">
      {show('marathonPit') && currentTimeSec != null && (
        <PitField onPitNow={onPitNow} />
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

function PitField({ onPitNow }: { onPitNow: { startKart: number; teamName: string; pilotName: string }[] }) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-dark-400 text-xs font-semibold uppercase tracking-wider">На піт-стопі зараз</span>
        <span className="text-dark-600 text-xs">({onPitNow.length})</span>
      </div>
      {onPitNow.length === 0 ? (
        <div className="text-dark-500 text-sm">Зараз нікого на піту</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {onPitNow.map(p => (
            <div key={p.startKart} className="flex items-center gap-1.5 bg-yellow-600/15 border border-yellow-600/30 rounded-lg px-2.5 py-1">
              <span className={`font-mono text-xs ${KART_COLOR}`}>#{p.startKart}</span>
              <span className="text-white text-xs">{p.teamName}</span>
              {p.pilotName && !p.pilotName.startsWith('Карт') && (
                <span className="text-dark-400 text-xs">· {shortPilot(p.pilotName)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamRow({ team, open, onToggle }: { team: MarathonTeam; open: boolean; onToggle: () => void }) {
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
        <span className="text-green-400 text-xs font-mono font-semibold w-16 text-right">{lapStr(team.bestLapSec)}</span>
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
                <StintRow key={i} stint={stint} pit={team.pitStops[i]} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StintRow({ stint, pit }: { stint: MarathonStint; pit?: { lapNumber: number; durationSec: number | null } }) {
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
            {pitDurStr(pit.durationSec)}
          </span>
        ) : '—'}
      </td>
    </tr>
  );
}

function KartStatsTable({ kartStats }: { kartStats: ReturnType<typeof parseMarathon>['kartStats'] }) {
  if (kartStats.length === 0) return null;
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Статистика по картах</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-12">Карт</th>
              <th className="table-cell text-left">Хто їхав</th>
              <th className="table-cell text-center">Кіл</th>
              <th className="table-cell text-right">Найкраще</th>
              <th className="table-cell text-right">Час</th>
            </tr>
          </thead>
          <tbody>
            {kartStats.map(ks => (
              <tr key={ks.kart} className="table-row">
                <td className={`table-cell text-center font-mono font-bold ${KART_COLOR}`}>{ks.kart}</td>
                <td className="table-cell text-left text-dark-200">
                  {ks.usages.map((u, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-dark-600">, </span>}
                      <span title={u.teamName}>
                        {u.pilotName.startsWith('Карт') ? u.pilotName : shortPilot(u.pilotName)}
                        <span className="text-dark-500"> ({u.lapCount})</span>
                      </span>
                    </span>
                  ))}
                </td>
                <td className="table-cell text-center font-mono text-dark-300">{ks.totalLaps}</td>
                <td className="table-cell text-right font-mono text-green-400 font-semibold">{lapStr(ks.bestLapSec)}</td>
                <td className="table-cell text-right font-mono text-dark-300">{minutesStr(ks.drivenSec)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
