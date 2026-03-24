import { useNavigate } from 'react-router-dom';
import { toSeconds, shortName } from '../../utils/timing';

export interface SessionTableRow {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  real_pilot_count: number | null;
  race_number: number | null;
  track_id?: number;
  best_lap_time: string | null;
  best_lap_pilot: string | null;
  best_lap_kart?: number | null;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(startMs: number, endMs: number): string {
  const sec = Math.round((endMs - startMs) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}с`;
  return `${m}хв ${s}с`;
}

interface SessionsTableProps {
  sessions: SessionTableRow[];
  maxHeight?: string;
  showDate?: boolean;
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}, ${fmtTime(ms)}`;
}

export default function SessionsTable({ sessions, maxHeight, showDate }: SessionsTableProps) {
  const navigate = useNavigate();

  return (
    <div className={`overflow-x-auto ${maxHeight ? `max-h-[${maxHeight}] overflow-y-auto` : ''}`}>
      <table className="w-full text-xs">
        <tbody>
          {sessions.map((s) => {
            const isActive = !s.end_time;
            const pilots = s.real_pilot_count ?? s.pilot_count;
            return (
              <tr key={s.id}
                onClick={() => navigate(isActive ? '/' : `/sessions/${s.id}`)}
                className="border-b border-dark-800/50 last:border-0 hover:bg-dark-700/50 transition-colors cursor-pointer">
                <td className="py-1.5 pl-3 pr-1 text-dark-500 font-mono whitespace-nowrap">№{s.race_number ?? '—'}</td>
                <td className="py-1.5 font-mono text-white whitespace-nowrap">{showDate ? fmtDateTime(s.start_time) : fmtTime(s.start_time)}</td>
                <td className="py-1.5 font-mono whitespace-nowrap">
                  {isActive
                    ? <span className="text-green-400">LIVE</span>
                    : <span className="text-dark-400">{s.end_time ? fmtDuration(s.start_time, s.end_time) : '—'}</span>}
                </td>
                <td className="py-1.5 text-dark-500 whitespace-nowrap">{pilots} пілот{pilots === 1 ? '' : pilots < 5 ? 'и' : 'ів'}</td>
                <td className="py-1.5 text-dark-500 whitespace-nowrap">Прокат</td>
                <td className="py-1.5 text-dark-500 whitespace-nowrap">Траса {s.track_id || 1}</td>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
