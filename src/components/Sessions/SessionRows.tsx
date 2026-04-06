import { Link } from 'react-router-dom';
import { shortName as shortPilotName } from '../../utils/timing';
import { trackDisplayId } from '../../data/tracks';

interface CompetitionEvent {
  id: string;
  format: string;
  name: string;
  date: string;
  trackConfigId: number;
  phases: any[];
}

const FORMAT_MAP: Record<string, string> = {
  gonzales: 'gonzales', light_league: 'light-league', champions_league: 'champions-league',
};

function shortName(format: string): string {
  if (format === 'light_league') return 'ЛЛ';
  if (format === 'champions_league') return 'ЛЧ';
  if (format === 'gonzales') return 'Гонзалес';
  return 'Прокат';
}

/** Pseudo-random time from id string (deterministic) with seconds */
function fmtTime(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  const hour = 10 + (h % 13);
  const min = (h >> 4) % 60;
  const sec = (h >> 8) % 60;
  return `${hour}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Renders a list of session rows with track headers and best pilot info.
 * Used by both Sessions page and Karts page.
 */
export function SessionRows({ events, showDate = false }: { events: CompetitionEvent[]; showDate?: boolean }) {
  const rows: React.ReactNode[] = [];
  let currentTrack = -1;

  events.forEach((ev) => {
    // Track header/change
    if (ev.trackConfigId !== currentTrack) {
      currentTrack = ev.trackConfigId;
      rows.push(
        <div key={`track-${ev.id}-${currentTrack}`} className="text-dark-400 text-xs font-semibold pt-2 pb-1 px-1">
          Траса {trackDisplayId(currentTrack)}
        </div>
      );
    }

    const urlType = FORMAT_MAP[ev.format] || ev.format;
    const isCompetition = ['gonzales', 'light_league', 'champions_league'].includes(ev.format);
    const compName = shortName(ev.format);
    const datePrefix = showDate ? `${ev.date.slice(8)}.${ev.date.slice(5,7)}, ` : '';

    if (!isCompetition) {
      const bestPilot = ev.phases[0]?.results?.[0];
      rows.push(
        <Link key={ev.id} to={`/sessions/${ev.id}`}
          className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-dark-700/50 transition-colors group"
        >
          <span className="text-dark-400 text-sm group-hover:text-white transition-colors">
            <span className="text-white font-mono text-xs">{datePrefix}{fmtTime(ev.id)}</span>, Прокат
          </span>
          {bestPilot && (
            <span className="text-dark-500 text-xs font-mono shrink-0 ml-4">
              {shortPilotName(bestPilot.pilot)} — <span className="text-green-400">{bestPilot.bestLap}</span>
            </span>
          )}
        </Link>
      );
    } else {
      ev.phases.forEach((phase) => {
        const bestPilot = phase.results?.[0];
        const href = `/results/${urlType}/${ev.id}/${phase.id}`;
        rows.push(
          <Link key={`${ev.id}-${phase.id}`} to={href}
            className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-dark-700/50 transition-colors group"
          >
            <span className="text-dark-300 text-sm group-hover:text-white transition-colors">
              <span className="text-white font-mono text-xs">{datePrefix}{fmtTime(ev.id + phase.id)}</span>, {compName}, {phase.name}
            </span>
            {bestPilot && (
              <span className="text-dark-500 text-xs font-mono shrink-0 ml-4">
                {shortPilotName(bestPilot.pilot)} — <span className="text-green-400">{bestPilot.bestLap}</span>
              </span>
            )}
          </Link>
        );
      });
    }
  });

  return <>{rows}</>;
}

/**
 * Renders session rows with checkboxes for selection.
 */
export function SessionCheckboxRows({ events, selected, onToggle, showDate = false }: {
  events: CompetitionEvent[];
  selected: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  showDate?: boolean;
}) {
  const compName = (format: string) => shortName(format);
  let currentTrack = -1;

  return (
    <>
      {events.map((ev) => {
        const trackChanged = ev.trackConfigId !== currentTrack;
        if (trackChanged) currentTrack = ev.trackConfigId;
        const isComp = ['gonzales', 'light_league', 'champions_league'].includes(ev.format);
        const best = ev.phases[0]?.results?.[0];
        const datePrefix = showDate ? `${ev.date.slice(8)}.${ev.date.slice(5,7)}, ` : '';

        return (
          <div key={ev.id}>
            {trackChanged && (
              <div className="text-dark-400 text-xs font-semibold pt-2 pb-1 px-1">Траса {trackDisplayId(currentTrack)}</div>
            )}
            <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-dark-800/50 cursor-pointer text-xs text-dark-300">
              <input type="checkbox" checked={selected.has(ev.id)}
                onChange={e => onToggle(ev.id, e.target.checked)}
                className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0 shrink-0" />
              <span className="flex-1 flex items-center justify-between">
                <span>
                  <span className="text-white font-mono">{datePrefix}{fmtTime(ev.id)}</span>, {isComp ? compName(ev.format) : 'Прокат'}
                </span>
                {best && (
                  <span className="text-dark-500 font-mono shrink-0 ml-4">
                    {shortPilotName(best.pilot)} — <span className="text-green-400">{best.bestLap}</span>
                  </span>
                )}
              </span>
            </label>
          </div>
        );
      })}
    </>
  );
}
