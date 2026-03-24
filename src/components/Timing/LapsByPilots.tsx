import { Link } from 'react-router-dom';
import { toSeconds, shortName } from '../../utils/timing';
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
}

interface PilotLaps {
  name: string;
  laps: LapData[];
  bestLap: number;
}

interface LapsByPilotsProps {
  pilots: PilotLaps[];
  currentEntries?: TimingEntry[];
  isLive?: boolean;
}

export function buildPilotLaps(laps: LapData[]): PilotLaps[] {
  const map = new Map<string, { kart: number; laps: LapData[]; bestLap: number }>();
  for (const lap of laps) {
    if (!map.has(lap.pilot)) map.set(lap.pilot, { kart: lap.kart, laps: [], bestLap: Infinity });
    const p = map.get(lap.pilot)!;
    p.laps.push(lap);
    if (lap.lap_time) {
      const sec = parseLapTime(lap.lap_time);
      if (sec !== null && sec < p.bestLap) p.bestLap = sec;
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].bestLap - b[1].bestLap)
    .map(([name, data]) => ({ name, ...data }));
}

export default function LapsByPilots({ pilots, currentEntries = [], isLive }: LapsByPilotsProps) {
  const overallBest = Math.min(...pilots.map(p => p.bestLap).filter(v => v < Infinity));
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
                  const sec = parseLapTime(lap.lap_time);
                  const isPB = sec !== null && Math.abs(sec - p.bestLap) < 0.002;
                  const isOverall = sec !== null && Math.abs(sec - overallBest) < 0.002;
                  return (
                    <td key={p.name} className={`table-cell text-center font-mono ${
                      isOverall ? 'text-purple-400 font-bold' : isPB ? 'text-green-400 font-bold' : 'text-dark-300'
                    } ${isCurrent ? 'ring-1 ring-primary-500/60 bg-primary-500/10 rounded' : ''}`}>
                      {toSeconds(lap.lap_time)}
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
