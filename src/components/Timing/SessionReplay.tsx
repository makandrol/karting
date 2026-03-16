import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { TimingEntry } from '../../types';

interface SessionReplayProps {
  laps: { pilot: string; kart: number; lapNumber: number; lapTime: string; s1: string; s2: string; position: number }[];
  durationSec: number;
  title: string;
  baseDate?: string;
  s1Ratio?: number;
  onTimeUpdate?: (timeSec: number) => void;
  onEntriesUpdate?: (entries: TimingEntry[]) => void;
}

export default function SessionReplay({ laps, durationSec, title, baseDate, s1Ratio, onTimeUpdate, onEntriesUpdate }: SessionReplayProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const pilots = [...new Set(laps.map(l => l.pilot))];

  // Compute s1Ratio from actual data if not provided
  const effectiveS1Ratio = useMemo(() => {
    if (s1Ratio) return s1Ratio;
    const firstLap = laps[0];
    if (firstLap?.s1 && firstLap?.lapTime) {
      const s1Sec = parseFloat(firstLap.s1);
      const lapSec = parseFloat(firstLap.lapTime);
      if (s1Sec > 0 && lapSec > 0) return s1Sec / lapSec;
    }
    return 0.33;
  }, [s1Ratio, laps]);

  // Get entries at a given time point using actual per-lap durations
  const getEntriesAtTime = useCallback((timeSec: number): TimingEntry[] => {
    if (timeSec <= 0) return [];

    const result: TimingEntry[] = [];

    for (let idx = 0; idx < pilots.length; idx++) {
      const pilot = pilots[idx];
      const pilotLaps = laps.filter(l => l.pilot === pilot);
      if (pilotLaps.length === 0) continue;

      // Stagger: each pilot crosses start/finish 2s apart
      const enterTime = idx * 2;
      if (timeSec < enterTime) continue;

      const elapsed = timeSec - enterTime;

      // Walk through actual lap durations
      let timeAccum = 0;
      let completedLaps = 0;
      for (let i = 0; i < pilotLaps.length; i++) {
        const lapSec = parseFloat(pilotLaps[i].lapTime) || 42;
        if (elapsed >= timeAccum + lapSec) {
          timeAccum += lapSec;
          completedLaps++;
        } else {
          break;
        }
      }

      // Progress within current lap
      let progress: number;
      if (completedLaps >= pilotLaps.length) {
        progress = 1;
      } else {
        const currentLapSec = parseFloat(pilotLaps[completedLaps]?.lapTime) || 42;
        const lapElapsed = elapsed - timeAccum;
        progress = Math.min(lapElapsed / currentLapSec, 0.999);
      }

      const currentLapData = completedLaps < pilotLaps.length ? pilotLaps[completedLaps] : null;
      const prevLapData = completedLaps > 0 ? pilotLaps[completedLaps - 1] : null;

      // S1: appears at s1Ratio of the lap; S2: appears with lap time on finish
      let displayS1: string | null;
      let displayS2: string | null;
      let displayLap: string | null;

      if (completedLaps >= pilotLaps.length) {
        displayLap = prevLapData?.lapTime || null;
        displayS1 = prevLapData?.s1 || null;
        displayS2 = prevLapData?.s2 || null;
      } else if (progress >= effectiveS1Ratio && currentLapData) {
        displayS1 = currentLapData.s1 || null;
        displayS2 = prevLapData?.s2 || null;
        displayLap = prevLapData?.lapTime || null;
      } else {
        displayS1 = prevLapData?.s1 || null;
        displayS2 = prevLapData?.s2 || null;
        displayLap = prevLapData?.lapTime || null;
      }

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
        lastLap: displayLap,
        s1: displayS1,
        s2: displayS2,
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
        if (a.lapNumber === 0 && b.lapNumber === 0) return 0;
        if (a.lapNumber === 0) return 1;
        if (b.lapNumber === 0) return -1;
        const aT = parseFloat(a.bestLap || '999');
        const bT = parseFloat(b.bestLap || '999');
        return aT - bT;
      })
      .map((e, i) => ({ ...e, position: i + 1 }));
  }, [laps, pilots, effectiveS1Ratio]);

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

  // Update entries when time changes (more granular: every 0.2s)
  useEffect(() => {
    const e = getEntriesAtTime(currentTime);
    setEntries(e);
    onTimeUpdate?.(currentTime);
    onEntriesUpdate?.(e);
  }, [Math.floor(currentTime * 5), getEntriesAtTime, onTimeUpdate, onEntriesUpdate]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const simDateTime = useMemo(() => {
    if (!baseDate) return null;
    const base = new Date(baseDate);
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

  const handleScrub = (val: number) => {
    setCurrentTime(val);
    const ent = getEntriesAtTime(val);
    setEntries(ent);
    onTimeUpdate?.(val);
    onEntriesUpdate?.(ent);
  };

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header with title */}
      <div className="px-4 py-3 border-b border-dark-800">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">
            {simDateTime ? `Симуляція: ${simDateTime}` : `Симуляція: ${title}`}
          </h3>
          <span className="text-dark-500 text-xs font-mono">{formatTime(currentTime)} / {formatTime(durationSec)}</span>
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

      {/* Scrubber — at the bottom, between timing and track */}
      <div className="px-4 py-3 border-t border-dark-800">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (currentTime >= durationSec) setCurrentTime(0);
              setPlaying(!playing);
            }}
            className="w-8 h-8 bg-dark-800 hover:bg-dark-700 rounded-lg flex items-center justify-center text-white transition-colors shrink-0"
          >
            {playing ? '⏸' : '▶'}
          </button>

          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={durationSec}
              step={0.1}
              value={currentTime}
              onChange={(e) => handleScrub(parseFloat(e.target.value))}
              className="w-full h-2 bg-dark-800 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-grab"
            />
            <div
              className="absolute top-0 left-0 h-2 bg-primary-500/30 rounded-full pointer-events-none"
              style={{ width: `${(currentTime / durationSec) * 100}%` }}
            />
          </div>

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
    </div>
  );
}
