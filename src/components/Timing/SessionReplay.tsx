import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { TimingEntry } from '../../types';
import { parseTime, getTimeColor, COLOR_CLASSES, shortName, type TimeColor } from '../../utils/timing';

// ============================================================
// SessionReplay component
// ============================================================

interface SessionReplayProps {
  laps: { pilot: string; kart: number; lapNumber: number; lapTime: string; s1: string; s2: string; position: number; ts?: number }[];
  durationSec: number;
  sessionStartTime?: number;
  s1Ratio?: number;
  isLive?: boolean;
  raceNumber?: number | null;
  autoPlay?: boolean;
  liveEntries?: TimingEntry[];
  onTimeUpdate?: (timeSec: number) => void;
  onEntriesUpdate?: (entries: TimingEntry[]) => void;
  renderScrubber?: (scrubber: React.ReactNode) => React.ReactNode;
}

export default function SessionReplay({ laps, durationSec, sessionStartTime, s1Ratio, isLive, raceNumber, autoPlay, liveEntries, onTimeUpdate, onEntriesUpdate, renderScrubber }: SessionReplayProps) {
  const [playing, setPlaying] = useState(!!autoPlay);
  const [currentTime, setCurrentTime] = useState(autoPlay && isLive ? durationSec : 0);
  const [speed, setSpeed] = useState(1);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const pilots = useMemo(() => [...new Set(laps.map(l => l.pilot))], [laps]);

  const effectiveS1Ratio = useMemo(() => {
    if (s1Ratio) return s1Ratio;
    const firstLap = laps[0];
    if (firstLap?.s1 && firstLap?.lapTime) {
      const s1Sec = parseTime(firstLap.s1) || 0;
      const lapSec = parseTime(firstLap.lapTime) || 0;
      if (s1Sec > 0 && lapSec > 0) return s1Sec / lapSec;
    }
    return 0.43;
  }, [s1Ratio, laps]);

  // Build per-pilot completion timelines using actual lap durations
  // ts from DB is poll time (same for all pilots), so we reconstruct individual timelines
  const pilotTimelines = useMemo(() => {
    const timelines = new Map<string, number[]>();
    if (!sessionStartTime) return timelines;
    
    for (const pilot of pilots) {
      const pLaps = laps.filter(l => l.pilot === pilot);
      if (pLaps.length === 0) continue;
      
      // First lap: find earliest ts for this pilot as anchor, then work backwards
      const firstTs = pLaps[0].ts;
      const firstLapSec = parseTime(pLaps[0].lapTime) || 42;
      // The pilot started their first lap ~firstLapSec before it was completed
      const pilotStartMs = firstTs ? (firstTs - firstLapSec * 1000) : sessionStartTime;
      
      const completionTimes: number[] = [];
      let accum = pilotStartMs;
      for (const lap of pLaps) {
        const lapSec = parseTime(lap.lapTime) || 42;
        accum += lapSec * 1000;
        completionTimes.push(accum);
      }
      timelines.set(pilot, completionTimes);
    }
    return timelines;
  }, [laps, pilots, sessionStartTime]);

  // Get entries at a given time point with best S1/S2 tracking
  const getEntriesAtTime = useCallback((timeSec: number): TimingEntry[] => {
    const result: TimingEntry[] = [];
    const useTimelines = sessionStartTime != null && pilotTimelines.size > 0;

    for (let idx = 0; idx < pilots.length; idx++) {
      const pilot = pilots[idx];
      const pilotLaps = laps.filter(l => l.pilot === pilot);
      if (pilotLaps.length === 0) continue;

      let completedLaps = 0;
      let progress: number;

      if (useTimelines) {
        const currentMs = sessionStartTime! + timeSec * 1000;
        const timeline = pilotTimelines.get(pilot) || [];
        
        for (let i = 0; i < timeline.length; i++) {
          if (currentMs >= timeline[i]) completedLaps++;
          else break;
        }

        if (completedLaps >= pilotLaps.length) {
          // All recorded laps done — estimate position on current unfinished lap
          if (pilotLaps.length > 0) {
            const lastCompletionMs = timeline[timeline.length - 1] || currentMs;
            const avgLapMs = pilotLaps.length >= 2
              ? (timeline[timeline.length - 1] - timeline[0]) / (pilotLaps.length - 1)
              : (parseTime(pilotLaps[0].lapTime) || 42) * 1000;
            const elapsed = currentMs - lastCompletionMs;
            progress = avgLapMs > 0 ? Math.max(0, Math.min(elapsed / avgLapMs, 0.999)) : 0;
          } else {
            progress = 0;
          }
        } else {
          const lapStartMs = completedLaps > 0 ? timeline[completedLaps - 1] : (timeline[0] ? timeline[0] - (parseTime(pilotLaps[0].lapTime) || 42) * 1000 : sessionStartTime!);
          const lapEndMs = timeline[completedLaps] || (lapStartMs + 42000);
          const lapDuration = lapEndMs - lapStartMs;
          const lapElapsed = currentMs - lapStartMs;
          progress = lapDuration > 0 ? Math.max(0, Math.min(lapElapsed / lapDuration, 0.999)) : 0;
        }
      } else {
        const enterTime = idx * 2;
        if (timeSec < enterTime || timeSec <= 0) {
          result.push({
            position: idx + 1, pilot,
            kart: 0, lastLap: null, s1: null, s2: null, bestLap: null,
            lapNumber: -1, bestS1: null, bestS2: null, progress: null,
            currentLapSec: null, previousLapSec: null,
          });
          continue;
        }
        const elapsed = timeSec - enterTime;
        let timeAccum = 0;
        for (let i = 0; i < pilotLaps.length; i++) {
          const lapSec = parseTime(pilotLaps[i].lapTime) || 42;
          if (elapsed >= timeAccum + lapSec) { timeAccum += lapSec; completedLaps++; } else break;
        }
        if (completedLaps >= pilotLaps.length) {
          progress = 1;
        } else {
          const currentLapSec = parseTime(pilotLaps[completedLaps]?.lapTime) || 42;
          progress = Math.min((elapsed - timeAccum) / currentLapSec, 0.999);
        }
      }

      const currentLapData = completedLaps < pilotLaps.length ? pilotLaps[completedLaps] : null;
      const prevLapData = completedLaps > 0 ? pilotLaps[completedLaps - 1] : null;

      // S1/S2/Lap display logic
      let displayS1: string | null;
      let displayS2: string | null;
      let displayLap: string | null;

      const liveEntry = liveEntries?.find(le => le.pilot === pilot);
      const onCurrentUnrecordedLap = completedLaps >= pilotLaps.length;

      if (onCurrentUnrecordedLap && liveEntry?.s1) {
        displayS1 = liveEntry.s1;
        displayS2 = prevLapData?.s2 || null;
        displayLap = prevLapData?.lapTime || null;
      } else if (onCurrentUnrecordedLap) {
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

      // Best lap, S1, S2 among completed laps
      let bestLap = '', bestLapSec = Infinity;
      let bestS1 = '', bestS1Sec = Infinity;
      let bestS2 = '', bestS2Sec = Infinity;

      for (let i = 0; i < completedLaps; i++) {
        const l = pilotLaps[i];
        const lt = parseTime(l?.lapTime || '') ?? 999;
        if (lt < bestLapSec) { bestLapSec = lt; bestLap = l?.lapTime || ''; }
        const s1v = parseTime(l?.s1 || '') ?? 999;
        if (s1v < bestS1Sec) { bestS1Sec = s1v; bestS1 = l?.s1 || ''; }
        const s2v = parseTime(l?.s2 || '') ?? 999;
        if (s2v < bestS2Sec) { bestS2Sec = s2v; bestS2 = l?.s2 || ''; }
      }

      if (onCurrentUnrecordedLap && liveEntry?.s1) {
        const liveS1v = parseTime(liveEntry.s1) ?? 999;
        if (liveS1v < bestS1Sec) { bestS1Sec = liveS1v; bestS1 = liveEntry.s1; }
      }

      result.push({
        position: idx + 1, pilot,
        kart: pilotLaps[0]?.kart || 0,
        lastLap: displayLap,
        s1: displayS1,
        s2: displayS2,
        bestLap: bestLap || null,
        lapNumber: completedLaps,
        bestS1: bestS1 || null,
        bestS2: bestS2 || null,
        progress,
        currentLapSec: null,
        previousLapSec: null,
      });
    }

    return result
      .sort((a, b) => {
        if (a.lapNumber < 0 && b.lapNumber < 0) return 0;
        if (a.lapNumber < 0) return 1;
        if (b.lapNumber < 0) return -1;
        if (a.lapNumber === 0 && b.lapNumber === 0) return 0;
        if (a.lapNumber === 0) return 1;
        if (b.lapNumber === 0) return -1;
        const aT = parseTime(a.bestLap || '') ?? 999;
        const bT = parseTime(b.bestLap || '') ?? 999;
        return aT - bT;
      })
      .map((e, i) => ({ ...e, position: i + 1 }));
  }, [laps, pilots, effectiveS1Ratio, sessionStartTime, pilotTimelines, liveEntries]);

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
        if (!isLive && next >= durationSec) { setPlaying(false); return durationSec; }
        return Math.min(next, durationSec);
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
  }, [Math.floor(currentTime * 5), getEntriesAtTime, onTimeUpdate, onEntriesUpdate]);

  const formatTimeSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  };

  const handleScrub = (val: number) => {
    setCurrentTime(val);
    const ent = getEntriesAtTime(val);
    setEntries(ent);
    onTimeUpdate?.(val);
    onEntriesUpdate?.(ent);
  };

  // Overall bests for color coding
  const { overallBestLap, overallBestS1, overallBestS2 } = useMemo(() => {
    let bLap: number | null = null, bS1: number | null = null, bS2: number | null = null;
    for (const e of entries) {
      const lap = parseTime(e.bestLap); if (lap !== null && (bLap === null || lap < bLap)) bLap = lap;
      const s1 = parseTime(e.bestS1); if (s1 !== null && (bS1 === null || s1 < bS1)) bS1 = s1;
      const s2 = parseTime(e.bestS2); if (s2 !== null && (bS2 === null || s2 < bS2)) bS2 = s2;
    }
    return { overallBestLap: bLap, overallBestS1: bS1, overallBestS2: bS2 };
  }, [entries]);

  const scrubberEl = (
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

      <input
        type="range"
        min={0}
        max={durationSec}
        step={0.1}
        value={currentTime}
        onChange={(e) => handleScrub(parseFloat(e.target.value))}
        className="flex-1 h-2 bg-dark-800 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-grab"
      />

      {isLive && (
        <button
          onClick={() => { handleScrub(durationSec); setPlaying(true); }}
          className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors shrink-0 ${
            currentTime >= durationSec - 5
              ? 'bg-green-500/20 text-green-400'
              : 'bg-dark-800 text-dark-400 hover:text-green-400 hover:bg-green-500/10'
          }`}
        >
          LIVE
        </button>
      )}

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

      <span className="text-dark-400 text-xs font-mono whitespace-nowrap shrink-0">
        {isLive ? formatTimeSec(currentTime) : `${formatTimeSec(currentTime)} / ${formatTimeSec(durationSec)}`}
      </span>

      {isLive && raceNumber != null && (
        <span className="text-green-400 text-xs font-semibold whitespace-nowrap shrink-0">
          Заїзд №{raceNumber}
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* Scrubber — parent can wrap for sticky positioning */}
      {renderScrubber ? renderScrubber(scrubberEl) : (
        <div className="bg-dark-900/95 border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
          {scrubberEl}
        </div>
      )}

      {/* Timing board */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-8">#</th>
              <th className="table-cell text-left min-w-[170px]">Pilot</th>
              <th className="table-cell text-center">Kart</th>
              <th className="table-cell text-right">Last</th>
              <th className="table-cell text-right">S1</th>
              <th className="table-cell text-right">S2</th>
              <th className="table-cell text-right">Best</th>
              <th className="table-cell text-right">B.S1</th>
              <th className="table-cell text-right">B.S2</th>
              <th className="table-cell text-center">L</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const notStarted = e.lapNumber < 0;
              const lapColor = notStarted ? 'none' as TimeColor : getTimeColor(e.lastLap, e.bestLap, overallBestLap);
              const s1Color = notStarted ? 'none' as TimeColor : getTimeColor(e.s1, e.bestS1, overallBestS1);
              const s2Color = notStarted ? 'none' as TimeColor : getTimeColor(e.s2, e.bestS2, overallBestS2);
              const bestLapColor = notStarted ? 'none' as TimeColor : getTimeColor(e.bestLap, e.bestLap, overallBestLap);
              const bestS1Color = notStarted ? 'none' as TimeColor : getTimeColor(e.bestS1, e.bestS1, overallBestS1);
              const bestS2Color = notStarted ? 'none' as TimeColor : getTimeColor(e.bestS2, e.bestS2, overallBestS2);

              return (
                <tr key={e.pilot} className="table-row">
                  <td className="table-cell text-center font-mono font-bold text-dark-400">
                    {notStarted ? '—' : e.position}
                  </td>
                  <td className="table-cell text-left py-2">
                    <div className={`font-medium text-sm leading-tight ${notStarted ? 'text-dark-500' : ''}`}>
                      <Link to={`/pilots/${encodeURIComponent(e.pilot)}`} className={`${notStarted ? 'text-dark-500' : 'text-white hover:text-primary-400'} transition-colors`}>
                        {shortName(e.pilot)}
                      </Link>
                    </div>
                    <div className="mt-1 h-[3px] w-full bg-dark-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-[50ms] ease-linear bg-yellow-500/60"
                        style={{ width: `${!notStarted && e.progress !== null ? Math.round(e.progress * 100) : 0}%` }}
                      />
                    </div>
                  </td>
                  <td className="table-cell text-center font-mono text-dark-300">{notStarted ? '' : (e.kart || '—')}</td>
                  <td className={`table-cell text-right font-mono font-semibold ${notStarted ? '' : COLOR_CLASSES[lapColor]}`}>
                    {notStarted ? '' : (e.lastLap || '—')}
                  </td>
                  <td className={`table-cell text-right font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[s1Color]}`}>
                    {notStarted ? '' : (e.s1 || '—')}
                  </td>
                  <td className={`table-cell text-right font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[s2Color]}`}>
                    {notStarted ? '' : (e.s2 || '—')}
                  </td>
                  <td className={`table-cell text-right font-mono font-semibold ${notStarted ? '' : COLOR_CLASSES[bestLapColor]}`}>
                    {notStarted ? '' : (e.bestLap || '—')}
                  </td>
                  <td className={`table-cell text-right font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[bestS1Color]}`}>
                    {notStarted ? '' : (e.bestS1 || '—')}
                  </td>
                  <td className={`table-cell text-right font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[bestS2Color]}`}>
                    {notStarted ? '' : (e.bestS2 || '—')}
                  </td>
                  <td className="table-cell text-center font-mono text-dark-500">
                    {notStarted ? '' : e.lapNumber}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

      </div>
    </>
  );
}
