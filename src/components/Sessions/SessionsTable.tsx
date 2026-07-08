import { useNavigate } from 'react-router-dom';
import { toSeconds, shortName } from '../../utils/timing';
import { fmtTime, fmtDuration, fmtDateTime } from '../../utils/datetime';
import { COMPETITION_CONFIGS, getPhaseShortLabel } from '../../data/competitions';
import { trackDisplayId } from '../../data/tracks';

export interface SessionTableRow {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  real_pilot_count: number | null;
  race_number: number | null;
  day_order?: number | null;
  track_id?: number;
  best_lap_time: string | null;
  best_lap_pilot: string | null;
  best_lap_kart?: number | null;
  competition_id?: string | null;
  competition_name?: string | null;
  competition_format?: string | null;
  competition_phase?: string | null;
  is_race?: number;
}

interface SessionsTableProps {
  sessions: SessionTableRow[];
  maxHeight?: string;
  showDate?: boolean;
  /** Якщо задано — показує кнопку виключення заїзду зі статистики. */
  excludedIds?: Set<string>;
  onToggleExclude?: (id: string) => void;
  /** Сортувати найновіший заїзд першим (за start_time спадаюче). */
  newestFirst?: boolean;
}

export default function SessionsTable({ sessions, maxHeight, showDate, excludedIds, onToggleExclude, newestFirst }: SessionsTableProps) {
  const navigate = useNavigate();
  const showExclude = !!onToggleExclude;

  const orderedSessions = newestFirst ? [...sessions].sort((a, b) => b.start_time - a.start_time) : sessions;

  return (
    <div className={`overflow-x-auto ${maxHeight ? `max-h-[${maxHeight}] overflow-y-auto` : ''}`}>
      <table className="w-full text-xs">
        <tbody>
          {orderedSessions.map((s) => {
            const isActive = !s.end_time;
            const pilots = s.real_pilot_count ?? s.pilot_count;
            const sessionType = s.competition_format && s.competition_phase
              ? `${COMPETITION_CONFIGS[s.competition_format as keyof typeof COMPETITION_CONFIGS]?.shortName || s.competition_format} · ${getPhaseShortLabel(s.competition_format, s.competition_phase)}`
              : s.competition_format
              ? COMPETITION_CONFIGS[s.competition_format as keyof typeof COMPETITION_CONFIGS]?.shortName || s.competition_format
              : `Прокат${s.race_number != null ? ` ${s.race_number}` : ''}`;
            const isCompetition = !!s.competition_id;
            const isExcluded = !!excludedIds?.has(s.id);
            return (
              <tr key={s.id}
                onClick={() => navigate(isActive ? '/' : `/sessions/${s.id}`)}
                className={`border-b border-dark-800/50 last:border-0 hover:bg-dark-700/50 transition-colors cursor-pointer ${isExcluded ? 'opacity-40' : ''}`}>
                <td className="py-1.5 pl-3 pr-1 text-dark-500 font-mono whitespace-nowrap">{s.day_order ?? '—'}</td>
                <td className={`py-1.5 font-mono whitespace-nowrap ${isExcluded ? 'text-dark-500 line-through' : 'text-white'}`}>{showDate ? fmtDateTime(s.start_time) : fmtTime(s.start_time)}</td>
                <td className="py-1.5 font-mono whitespace-nowrap">
                  {isActive
                    ? <span className="text-green-400">LIVE</span>
                    : <span className="text-dark-400">{s.end_time ? fmtDuration(s.start_time, s.end_time) : '—'}</span>}
                </td>
                <td className="py-1.5 text-dark-500 whitespace-nowrap">{pilots} пілот{pilots === 1 ? '' : pilots < 5 ? 'и' : 'ів'}</td>
                <td className={`py-1.5 whitespace-nowrap ${isCompetition ? 'text-purple-400' : 'text-dark-500'}`}>{sessionType}</td>
                <td className="py-1.5 text-dark-500 whitespace-nowrap">Траса {trackDisplayId(s.track_id || 1)}</td>
                <td className="py-1.5 pr-3 text-right font-mono whitespace-nowrap">
                  {s.best_lap_time && s.best_lap_pilot ? (
                    <>
                      <span className="text-dark-500">
                        {shortName(s.best_lap_pilot)}
                        {s.best_lap_kart && !s.best_lap_pilot?.startsWith('Карт ') ? <span className="text-dark-600"> (карт {s.best_lap_kart})</span> : ''}
                      </span>
                      <span className="text-dark-600 mx-1">—</span>
                      <span className="text-green-400">{toSeconds(s.best_lap_time)}</span>
                    </>
                  ) : ''}
                </td>
                {showExclude && (
                  <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleExclude!(s.id); }}
                      title={isExcluded ? 'Повернути в статистику' : 'Прибрати зі статистики'}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${isExcluded ? 'text-green-400/50 hover:text-green-400' : 'text-dark-700 hover:text-red-400'}`}
                    >{isExcluded ? '✓' : '✕'}</button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
