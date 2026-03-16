import { useState, useRef, useCallback, useEffect } from 'react';
import type { TimingEntry } from '../../types';

interface ReplayEvent {
  type: string;
  ts: number;
  data: any;
}

interface SessionReplayProps {
  laps: { pilot: string; kart: number; lapNumber: number; lapTime: string; s1: string; s2: string; position: number }[];
  durationSec: number;
  title: string;
  onTimeUpdate?: (timeSec: number) => void;
}

export default function SessionReplay({ laps, durationSec, title, onTimeUpdate }: SessionReplayProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // seconds
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  // Build timeline entries from laps
  const pilots = [...new Set(laps.map(l => l.pilot))];

  // Get entries at a given time point
  const getEntriesAtTime = useCallback((timeSec: number): TimingEntry[] => {
    return pilots.map((pilot, idx) => {
      const pilotLaps = laps.filter(l => l.pilot === pilot);
      // Simulate: each lap takes ~durationSec/totalLaps
      const avgLapTime = durationSec / Math.max(pilotLaps.length, 1);
      const currentLapIdx = Math.min(Math.floor(timeSec / avgLapTime), pilotLaps.length - 1);
      const currentLap = pilotLaps[currentLapIdx];
      const progress = currentLapIdx >= 0 ? (timeSec % avgLapTime) / avgLapTime : 0;

      // Find best lap so far
      let bestLap = '';
      let bestLapSec = Infinity;
      for (let i = 0; i <= currentLapIdx; i++) {
        const lt = parseFloat(pilotLaps[i]?.lapTime || '999');
        if (lt < bestLapSec) { bestLapSec = lt; bestLap = pilotLaps[i]?.lapTime || ''; }
      }

      return {
        position: idx + 1,
        pilot,
        kart: currentLap?.kart || 0,
        lastLap: currentLap?.lapTime || null,
        s1: currentLap?.s1 || null,
        s2: currentLap?.s2 || null,
        bestLap: bestLap || null,
        lapNumber: currentLapIdx + 1,
        bestS1: null,
        bestS2: null,
        progress,
        currentLapSec: null,
        previousLapSec: null,
      };
    }).sort((a, b) => {
      const aT = parseFloat(a.bestLap || '999');
      const bT = parseFloat(b.bestLap || '999');
      return aT - bT;
    }).map((e, i) => ({ ...e, position: i + 1 }));
  }, [laps, pilots, durationSec]);

  const [entries, setEntries] = useState<TimingEntry[]>(() => getEntriesAtTime(0));

  // Animation loop
  useEffect(() => {
    if (!playing) return;
    lastTickRef.current = performance.now();

    function tick(now: number) {
      const dt = (now - lastTickRef.current) / 1000 * speed;
      lastTickRef.current = now;

      setCurrentTime(prev => {
        const next = prev + dt;
        if (next >= durationSec) {
          setPlaying(false);
          return durationSec;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, durationSec]);

  // Update entries when time changes
  useEffect(() => {
    setEntries(getEntriesAtTime(currentTime));
    onTimeUpdate?.(currentTime);
  }, [Math.floor(currentTime), getEntriesAtTime, onTimeUpdate]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="card p-0 overflow-hidden">
      {/* Player header */}
      <div className="px-4 py-3 border-b border-dark-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold text-sm">▶ Симуляція: {title}</h3>
          <span className="text-dark-500 text-xs font-mono">{formatTime(currentTime)} / {formatTime(durationSec)}</span>
        </div>

        {/* Timeline scrubber */}
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={() => {
              if (currentTime >= durationSec) setCurrentTime(0);
              setPlaying(!playing);
            }}
            className="w-8 h-8 bg-dark-800 hover:bg-dark-700 rounded-lg flex items-center justify-center text-white transition-colors shrink-0"
          >
            {playing ? '⏸' : '▶'}
          </button>

          {/* Scrubber */}
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={durationSec}
              step={0.1}
              value={currentTime}
              onChange={(e) => {
                const t = parseFloat(e.target.value);
                setCurrentTime(t);
                setEntries(getEntriesAtTime(t));
                onTimeUpdate?.(t);
              }}
              className="w-full h-2 bg-dark-800 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-grab"
            />
            {/* Progress fill */}
            <div
              className="absolute top-0 left-0 h-2 bg-primary-500/30 rounded-full pointer-events-none"
              style={{ width: `${(currentTime / durationSec) * 100}%` }}
            />
          </div>

          {/* Speed control */}
          <select
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="bg-dark-800 border border-dark-700 text-white text-xs rounded-md px-2 py-1 outline-none shrink-0"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
          </select>
        </div>
      </div>

      {/* Timing board */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-8">#</th>
              <th className="table-cell text-left">Пілот</th>
              <th className="table-cell text-center">Карт</th>
              <th className="table-cell text-right">Коло</th>
              <th className="table-cell text-right">S1</th>
              <th className="table-cell text-right">S2</th>
              <th className="table-cell text-right">Найкраще</th>
              <th className="table-cell text-center">Л</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.pilot} className="table-row">
                <td className={`table-cell text-center font-mono font-bold ${e.position <= 3 ? `position-${e.position}` : 'text-dark-400'}`}>{e.position}</td>
                <td className="table-cell text-left text-white text-sm">{e.pilot}</td>
                <td className="table-cell text-center font-mono text-dark-300">{e.kart || '—'}</td>
                <td className="table-cell text-right font-mono text-dark-200">{e.lastLap || '—'}</td>
                <td className="table-cell text-right font-mono text-dark-400">{e.s1 || '—'}</td>
                <td className="table-cell text-right font-mono text-dark-400">{e.s2 || '—'}</td>
                <td className="table-cell text-right font-mono text-green-400 font-semibold">{e.bestLap || '—'}</td>
                <td className="table-cell text-center font-mono text-dark-500">{e.lapNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
