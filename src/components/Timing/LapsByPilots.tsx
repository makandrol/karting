import { Link } from 'react-router-dom';
import { toSeconds, toHundredths, shortName, parseTime, getTimeColor, COLOR_CLASSES } from '../../utils/timing';
import type { TimingEntry } from '../../types';

function parseLapTime(t: string): number | null {
  const lapMatch = t.match(/^(\d+):(\d+\.\d+)$/);
  if (lapMatch) return parseInt(lapMatch[1]) * 60 + parseFloat(lapMatch[2]);
  const secMatch = t.match(/^\d+\.\d+$/);
  if (secMatch) return parseFloat(t);
  return null;
}

export interface LapData {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1?: string | null;
  s2?: string | null;
  ts?: number;
}

interface PilotLaps {
  name: string;
  laps: LapData[];
  bestLap: number;
  bestS1: number;
  bestS2: number;
}

interface LapsByPilotsProps {
  pilots: PilotLaps[];
  currentEntries?: TimingEntry[];
  isLive?: boolean;
  onRenamePilot?: (oldName: string, newName: string) => void;
  excludedLaps?: Set<string>;
  onToggleLap?: (key: string) => void;
  sessionId?: string;
}

export function buildPilotLaps(laps: LapData[], excludedLaps?: Set<string>, sessionId?: string): PilotLaps[] {
  const map = new Map<string, { kart: number; laps: LapData[]; bestLap: number; bestS1: number; bestS2: number }>();
  for (const lap of laps) {
    if (!map.has(lap.pilot)) map.set(lap.pilot, { kart: lap.kart, laps: [], bestLap: Infinity, bestS1: Infinity, bestS2: Infinity });
    const p = map.get(lap.pilot)!;
    p.laps.push(lap);
    const isExcluded = sessionId && lap.ts && excludedLaps?.has(`${sessionId}|${lap.ts}`);
    if (isExcluded) continue;
    if (lap.lap_time) {
      const sec = parseLapTime(lap.lap_time);
      if (sec !== null && sec < p.bestLap) p.bestLap = sec;
    }
    if (lap.s1) {
      const v = parseLapTime(lap.s1);
      if (v !== null && v >= 10 && v < p.bestS1) p.bestS1 = v;
    }
    if (lap.s2) {
      const v = parseLapTime(lap.s2);
      if (v !== null && v >= 10 && v < p.bestS2) p.bestS2 = v;
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].bestLap - b[1].bestLap)
    .map(([name, data]) => ({ name, ...data }));
}

export default function LapsByPilots({ pilots, currentEntries = [], isLive, onRenamePilot, excludedLaps, onToggleLap, sessionId }: LapsByPilotsProps) {
  const overallBest = Math.min(...pilots.map(p => p.bestLap).filter(v => v < Infinity));
  const overallBestS1 = Math.min(...pilots.map(p => p.bestS1).filter(v => v < Infinity));
  const overallBestS2 = Math.min(...pilots.map(p => p.bestS2).filter(v => v < Infinity));
  const maxLaps = Math.max(...pilots.map(p => p.laps.length), 0);

  const completedLapsMap = new Map<string, number>();
  for (const e of currentEntries) {
    if (e.lapNumber >= 0) completedLapsMap.set(e.pilot, e.lapNumber);
  }
  const hasReplayState = !isLive && currentEntries.length > 0 && currentEntries.some(e => e.lapNumber >= 0);

  if (maxLaps === 0) return null;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Кола по пілотах</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-8">Коло</th>
              {pilots.map(p => (
                <th key={p.name} className="table-cell text-center min-w-[80px]">
                  <Link to={`/pilots/${encodeURIComponent(p.name)}`} className="text-white hover:text-primary-400 transition-colors">
                    {shortName(p.name)}
                  </Link>
                  {onRenamePilot && (
                    <button onClick={(e) => {
                      e.stopPropagation();
                      const newName = prompt(`Перейменувати "${p.name}" на:`, p.name);
                      if (newName && newName !== p.name) onRenamePilot(p.name, newName);
                    }} className="ml-0.5 text-dark-500 hover:text-primary-400 text-[9px]">✎</button>
                  )}
                  <div className="text-dark-600 text-[9px] font-normal">К{p.laps[0]?.kart}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxLaps }, (_, lapIdx) => (
              <tr key={lapIdx} className="table-row">
                <td className="table-cell text-center font-mono text-dark-500">{lapIdx + 1}</td>
                {pilots.map(p => {
                  const lap = p.laps[lapIdx];
                  const completed = completedLapsMap.get(p.name) ?? 0;
                  const isCurrent = hasReplayState && lapIdx === completed;
                  if (!lap?.lap_time) return (
                    <td key={p.name} className={`table-cell text-center text-dark-700 ${isCurrent ? 'ring-1 ring-primary-500/60 bg-primary-500/10 rounded' : ''}`}>—</td>
                  );
                  const lapKey = sessionId && lap.ts ? `${sessionId}|${lap.ts}` : '';
                  const isExcluded = lapKey ? excludedLaps?.has(lapKey) : false;
                  const sec = parseLapTime(lap.lap_time);
                  const isPB = !isExcluded && sec !== null && Math.abs(sec - p.bestLap) < 0.002;
                  const isOverall = !isExcluded && sec !== null && Math.abs(sec - overallBest) < 0.002;

                  const s1Val = lap.s1 ? parseLapTime(lap.s1) : null;
                  const s2Val = lap.s2 ? parseLapTime(lap.s2) : null;
                  const s1Str = s1Val !== null && s1Val >= 10 ? (p.bestS1 < Infinity ? String(p.bestS1) : null) : null;
                  const s2Str = s2Val !== null && s2Val >= 10 ? (p.bestS2 < Infinity ? String(p.bestS2) : null) : null;
                  const s1Color = s1Val !== null && s1Val >= 10 ? getTimeColor(lap.s1!, s1Str, overallBestS1 < Infinity ? overallBestS1 : null) : 'none';
                  const s2Color = s2Val !== null && s2Val >= 10 ? getTimeColor(lap.s2!, s2Str, overallBestS2 < Infinity ? overallBestS2 : null) : 'none';

                  return (
                    <td key={p.name} className={`table-cell text-center font-mono ${
                      isExcluded ? 'opacity-40' :
                      isOverall ? 'text-purple-400 font-bold' : isPB ? 'text-green-400 font-bold' : 'text-dark-300'
                    } ${isCurrent ? 'ring-1 ring-primary-500/60 bg-primary-500/10 rounded' : ''}`}>
                      <div className={`relative group ${isExcluded ? 'line-through decoration-red-400' : ''}`}>
                        {toSeconds(lap.lap_time)}
                        {onToggleLap && lapKey && (
                          <button onClick={(e) => { e.stopPropagation(); onToggleLap(lapKey); }}
                            className={`absolute -right-1 -top-1 w-3.5 h-3.5 flex items-center justify-center rounded-full text-[9px] font-bold leading-none opacity-0 group-hover:opacity-100 transition-all ${isExcluded ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30 !opacity-100' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'}`}>
                            {isExcluded ? '↩' : '✕'}
                          </button>
                        )}
                      </div>
                      {!isExcluded && ((s1Val !== null && s1Val >= 10) || (s2Val !== null && s2Val >= 10)) ? (
                        <div className="text-[8px] leading-tight mt-0.5">
                          <span className={s1Color === 'purple' ? 'text-purple-400' : s1Color === 'green' ? 'text-green-400' : 'text-dark-500'}>{s1Val !== null && s1Val >= 10 ? toHundredths(lap.s1!) : '—'}</span>
                          <span className="text-dark-700"> </span>
                          <span className={s2Color === 'purple' ? 'text-purple-400' : s2Color === 'green' ? 'text-green-400' : 'text-dark-500'}>{s2Val !== null && s2Val >= 10 ? toHundredths(lap.s2!) : '—'}</span>
                        </div>
                      ) : null}
                    </td>
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
