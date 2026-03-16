import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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
  /** Базова дата/час заїзду для відображення "Симуляція: DD.MM.YYYY, HH:MM:SS" */
  baseDate?: string;
  onTimeUpdate?: (timeSec: number) => void;
  /** Entries callback — passes current entries to parent (for track map sync) */
  onEntriesUpdate?: (entries: TimingEntry[]) => void;
}

export default function SessionReplay({ laps, durationSec, title, baseDate, onTimeUpdate, onEntriesUpdate }: SessionReplayProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // seconds
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  // Build timeline entries from laps
  const pilots = [...new Set(laps.map(l => l.pilot))];

  // Get entries at a given time point
  // Logic: pilot crosses start/finish → appears with 0 laps, no times
  // After completing a full lap → lap 1 with time, etc.
  const getEntriesAtTime = useCallback((timeSec: number): TimingEntry[] => {
    if (timeSec <= 0) return []; // Board is empty at start

    const result: TimingEntry[] = [];

    for (let idx = 0; idx < pilots.length; idx++) {
      const pilot = pilots[idx];
      const pilotLaps = laps.filter(l => l.pilot === pilot);
      if (pilotLaps.length === 0) continue;

      // Each pilot crosses start/finish with a small stagger (2s apart)
      const enterTime = idx * 2;
      if (timeSec < enterTime) continue; // Not on track yet

      const elapsed = timeSec - enterTime;
      const avgLapTime = (durationSec - 15) / Math.max(pilotLaps.length, 1);

      // completedLaps = how many full laps finished
      const completedLaps = Math.min(Math.floor(elapsed / avgLapTime), pilotLaps.length);
      const progress = (elapsed % avgLapTime) / avgLapTime;

      // Last completed lap data (the one that just finished)
      const lastCompletedLap = completedLaps > 0 ? pilotLaps[completedLaps - 1] : null;

      // Find best lap among completed laps
      let bestLap = '';
      let bestLapSec = Infinity;
      for (let i = 0; i < completedLaps; i++) {
        const lt = parseFloat(pilotLaps[i]?.lapTime || '999');
        if (lt < bestLapSec) { bestLapSec = lt; bestLap = pilotLaps[i]?.lapTime || ''; }
      }

      result.push({
        position: idx + 1,
        pilot,
        kart: pilotLaps[0]?.kart || 0,
        lastLap: lastCompletedLap?.lapTime || null,
        s1: lastCompletedLap?.s1 || null,
        s2: lastCompletedLap?.s2 || null,
        bestLap: bestLap || null,
        lapNumber: completedLaps,
        bestS1: null,
        bestS2: null,
        progress,
        currentLapSec: null,
        previousLapSec: null,
      });
    }

    return result
      .sort((a, b) => {
        // Pilots with completed laps first, then by best time
        if (a.lapNumber === 0 && b.lapNumber === 0) return 0;
        if (a.lapNumber === 0) return 1;
        if (b.lapNumber === 0) return -1;
        const aT = parseFloat(a.bestLap || '999');
        const bT = parseFloat(b.bestLap || '999');
        return aT - bT;
      })
      .map((e, i) => ({ ...e, position: i + 1 }));
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
    const e = getEntriesAtTime(currentTime);
    setEntries(e);
    onTimeUpdate?.(currentTime);
    onEntriesUpdate?.(e);
  }, [Math.floor(currentTime), getEntriesAtTime, onTimeUpdate, onEntriesUpdate]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Simulation datetime display
  const simDateTime = useMemo(() => {
    if (!baseDate) return null;
    // Parse date string (YYYY-MM-DD or full ISO)
    const base = new Date(baseDate);
    // If date-only (no time component), add default start time 19:00
    if (baseDate.length <= 10) base.setHours(19, 0, 0, 0);
    const sim = new Date(base.getTime() + currentTime * 1000);
    const dd = String(sim.getDate()).padStart(2, '0');
    const mm = String(sim.getMonth() + 1).padStart(2, '0');
    const yyyy = sim.getFullYear();
    const hh = String(sim.getHours()).padStart(2, '0');
    const min = String(sim.getMinutes()).padStart(2, '0');
    const ss = String(sim.getSeconds()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy}, ${hh}:${min}:${ss}`;
  }, [baseDate, Math.floor(currentTime)]);

  return (
    <div className="card p-0 overflow-hidden">
      {/* Player header */}
      <div className="px-4 py-3 border-b border-dark-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-white font-semibold text-sm">
            {simDateTime ? `Симуляція: ${simDateTime}` : `▶ Симуляція: ${title}`}
          </h3>
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
                const ent = getEntriesAtTime(t);
                setEntries(ent);
                onTimeUpdate?.(t);
                onEntriesUpdate?.(ent);
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
                <td className="table-cell text-left py-2">
                  <div className="font-medium text-sm leading-tight text-white">{e.pilot}</div>
                  {e.progress !== null && (
                    <div className="mt-1 h-[3px] w-full bg-dark-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-linear ${
                          e.position === 1 ? 'bg-yellow-500/70' :
                          e.position <= 3 ? 'bg-primary-500/50' : 'bg-dark-500/50'
                        }`}
                        style={{ width: `${Math.round(e.progress * 100)}%` }}
                      />
                    </div>
                  )}
                </td>
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
