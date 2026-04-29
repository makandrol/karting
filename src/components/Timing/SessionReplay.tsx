import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { TimingEntry } from '../../types';
import { parseTime } from '../../utils/timing';
import TimingTable from './TimingTable';

// ============================================================
// SessionReplay component
// ============================================================

export interface S1Event {
  pilot: string;
  s1: string;
  ts: number;
}

export interface SnapshotPosition {
  ts: number;
  positions: Map<string, number>;
}

export function parseSessionEvents(rawEvents: any[]): {
  s1Events: S1Event[];
  snapshots: SnapshotPosition[];
  firstSnapshotPos: Map<string, number> | null;
} {
  const s1Events: S1Event[] = [];
  const snapshots: SnapshotPosition[] = [];
  let firstSnapshotPos: Map<string, number> | null = null;
  const currentPositions = new Map<string, number>();

  for (const ev of rawEvents) {
    const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
    if (!d) continue;

    if (ev.event_type === 's1') {
      if (d.pilot && d.s1) s1Events.push({ pilot: d.pilot, s1: d.s1, ts: ev.ts });
      const pos = d.team?.position ?? d.position;
      if (d.pilot && pos) currentPositions.set(d.pilot, Number(pos));
    }

    if (ev.event_type === 'snapshot') {
      const positions = new Map<string, number>();
      for (const en of (d.entries || [])) {
        if (en.pilot && en.position) {
          positions.set(en.pilot, Number(en.position));
          currentPositions.set(en.pilot, Number(en.position));
        }
      }
      if (positions.size > 0) {
        snapshots.push({ ts: ev.ts, positions });
        if (!firstSnapshotPos) firstSnapshotPos = positions;
      }
    }

    if (ev.event_type === 'positions') {
      const arr = Array.isArray(d) ? d : [];
      const positions = new Map<string, number>();
      for (const p of arr) {
        if (p.pilot && p.position) {
          positions.set(p.pilot, Number(p.position));
          currentPositions.set(p.pilot, Number(p.position));
        }
      }
      if (positions.size > 0) snapshots.push({ ts: ev.ts, positions });
    }

    if (ev.event_type === 'lap') {
      const pos = d.team?.position ?? d.position;
      if (d.pilot && pos) {
        const newPos = Number(pos);
        if (currentPositions.get(d.pilot) !== newPos) {
          currentPositions.set(d.pilot, newPos);
          snapshots.push({ ts: ev.ts, positions: new Map(currentPositions) });
        }
      }
    }
  }

  snapshots.sort((a, b) => a.ts - b.ts);
  return { s1Events, snapshots, firstSnapshotPos };
}

export type ReplaySortMode = 'qualifying' | 'race';

interface SessionReplayProps {
  laps: { pilot: string; kart: number; lapNumber: number; lapTime: string; s1: string; s2: string; position: number; ts?: number }[];
  durationSec: number;
  sessionStartTime?: number;
  isLive?: boolean;
  raceNumber?: number | null;
  autoPlay?: boolean;
  liveEntries?: TimingEntry[];
  s1Events?: S1Event[];
  snapshots?: SnapshotPosition[];
  startPositions?: Map<string, number>;
  raceGroup?: number;
  totalQualifiedPilots?: number;
  competitionFormat?: string;
  hidePoints?: boolean;
  defaultSortMode?: ReplaySortMode;
  sortMode?: ReplaySortMode;
  onSortModeChange?: (mode: ReplaySortMode) => void;
  columnFilter?: 'all' | 'main' | 'custom';
  onColumnFilterChange?: (filter: 'all' | 'main' | 'custom') => void;
  onTimeUpdate?: (timeSec: number) => void;
  onEntriesUpdate?: (entries: TimingEntry[]) => void;
  renderScrubber?: (scrubber: React.ReactNode) => React.ReactNode;
  showScrubber?: boolean;
  showTable?: boolean;
  renderContent?: (parts: { scrubber: React.ReactNode; table: React.ReactNode }) => React.ReactNode;
  pilotSuffix?: Map<string, string>;
}

export default function SessionReplay({ laps, durationSec, sessionStartTime, isLive, raceNumber, autoPlay, liveEntries, s1Events, snapshots, startPositions, raceGroup, totalQualifiedPilots, competitionFormat, hidePoints, defaultSortMode, sortMode: controlledSortMode, onSortModeChange, columnFilter: controlledColumnFilter, onColumnFilterChange, onTimeUpdate, onEntriesUpdate, renderScrubber, showScrubber = true, showTable = true, renderContent, pilotSuffix }: SessionReplayProps) {
  const [playing, setPlaying] = useState(!!autoPlay);
  const [currentTime, setCurrentTime] = useState(durationSec);
  const [speed, setSpeed] = useState(() => {
    try { const s = localStorage.getItem('karting_replay_speed'); if (s) { const v = parseFloat(s); if (v > 0) return v; } } catch {} return 1;
  });
  const [atLive, setAtLive] = useState(!!isLive && !!autoPlay);
  const [internalSortMode, setInternalSortMode] = useState<ReplaySortMode>(() => {
    if (defaultSortMode) return defaultSortMode;
    try { const s = localStorage.getItem('karting_replay_sort'); if (s === 'race' || s === 'qualifying') return s; } catch {} return 'qualifying';
  });
  const [internalColumnFilter, setInternalColumnFilter] = useState<'all' | 'main' | 'custom'>(() => {
    try { const s = localStorage.getItem('karting_replay_col_filter'); if (s === 'all' || s === 'main' || s === 'custom') return s; } catch {} return 'all';
  });

  const sortMode = controlledSortMode ?? internalSortMode;
  const setSortMode = onSortModeChange ?? ((m: ReplaySortMode) => { setInternalSortMode(m); localStorage.setItem('karting_replay_sort', m); });
  const columnFilter = controlledColumnFilter ?? internalColumnFilter;
  const setColumnFilter = onColumnFilterChange ?? ((f: 'all' | 'main' | 'custom') => { setInternalColumnFilter(f); localStorage.setItem('karting_replay_col_filter', f); });

  const updateSpeed = (s: number) => { setSpeed(s); localStorage.setItem('karting_replay_speed', String(s)); };

  useEffect(() => { if (defaultSortMode && !controlledSortMode) setInternalSortMode(defaultSortMode); }, [defaultSortMode, controlledSortMode]);

  const startGrid = useMemo(() => {
    if (!startPositions) return undefined;
    const grid = new Map<number, string>();
    for (const [pilot, pos] of startPositions) grid.set(pos, pilot);
    return grid;
  }, [startPositions]);

  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const durationRef = useRef(durationSec);
  durationRef.current = durationSec;

  useEffect(() => {
    if (atLive) setCurrentTime(durationSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationSec]);

  const pilots = useMemo(() => {
    const set = new Set(laps.map(l => l.pilot));
    if (liveEntries) for (const e of liveEntries) set.add(e.pilot);
    return [...set];
  }, [laps, liveEntries]);

  // Per-pilot S1 events sorted by timestamp for quick lookup during replay
  const pilotS1Events = useMemo(() => {
    const map = new Map<string, S1Event[]>();
    if (!s1Events) return map;
    for (const ev of s1Events) {
      if (!map.has(ev.pilot)) map.set(ev.pilot, []);
      map.get(ev.pilot)!.push(ev);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.ts - b.ts);
    return map;
  }, [s1Events]);

  // Build per-pilot completion timelines using actual lap durations
  // ts from DB is poll time (same for all pilots), so we reconstruct individual timelines
  const pilotTimelines = useMemo(() => {
    const timelines = new Map<string, number[]>();
    if (!sessionStartTime) return timelines;
    
    for (const pilot of pilots) {
      const pLaps = laps.filter(l => l.pilot === pilot);
      if (pLaps.length === 0) continue;
      
      const firstTs = pLaps[0].ts;
      const firstLapSec = parseTime(pLaps[0].lapTime) || 42;
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

    const pilotLastPos = new Map<string, number>();

    for (let idx = 0; idx < pilots.length; idx++) {
      const pilot = pilots[idx];
      const pilotLaps = laps.filter(l => l.pilot === pilot);

      // Pilot has no recorded laps — show from live data if available
      if (pilotLaps.length === 0) {
        const liveEntry = liveEntries?.find(le => le.pilot === pilot);
        if (liveEntry) {
          result.push({
            position: idx + 1, pilot,
            kart: liveEntry.kart,
            lastLap: liveEntry.lastLap || null,
            s1: liveEntry.s1 || null,
            s2: liveEntry.s2 || null,
            bestLap: liveEntry.bestLap || null,
            lapNumber: liveEntry.lapNumber || 0,
            bestS1: liveEntry.bestS1 || null,
            bestS2: liveEntry.bestS2 || null,
            progress: liveEntry.progress ?? null,
            currentLapSec: null,
            previousLapSec: null,
          });
        }
        continue;
      }

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

      const prevLapData = completedLaps > 0 ? pilotLaps[completedLaps - 1] : null;

      let displayS1: string | null;
      let displayS2: string | null;
      let displayLap: string | null;

      const liveEntry = liveEntries?.find(le => le.pilot === pilot);
      const onCurrentUnrecordedLap = completedLaps >= pilotLaps.length;

      if (onCurrentUnrecordedLap && liveEntry) {
        displayS1 = liveEntry.s1 || null;
        displayS2 = liveEntry.s2 || null;
        displayLap = liveEntry.lastLap || prevLapData?.lapTime || null;
      } else {
        displayS1 = prevLapData?.s1 || null;
        displayS2 = prevLapData?.s2 || null;
        displayLap = prevLapData?.lapTime || null;

        if (sessionStartTime && pilotS1Events.size > 0 && !onCurrentUnrecordedLap) {
          const currentMs = sessionStartTime + timeSec * 1000;
          const timeline = pilotTimelines.get(pilot) || [];
          const lastLapMs = completedLaps > 0 ? timeline[completedLaps - 1] : 0;
          const events = pilotS1Events.get(pilot);
          if (events) {
            for (let i = events.length - 1; i >= 0; i--) {
              if (events[i].ts <= currentMs && events[i].ts > lastLapMs) {
                displayS1 = events[i].s1;
                break;
              }
            }
          }
        }
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
        if (s1v >= 10 && s1v < bestS1Sec) { bestS1Sec = s1v; bestS1 = l?.s1 || ''; }
        const s2v = parseTime(l?.s2 || '') ?? 999;
        if (s2v >= 10 && s2v < bestS2Sec) { bestS2Sec = s2v; bestS2 = l?.s2 || ''; }
      }

      // Include displayed S1 in best calculation (from s1Events, may be mid-lap)
      if (displayS1) {
        const ds1v = parseTime(displayS1) ?? 999;
        if (ds1v >= 10 && ds1v < bestS1Sec) { bestS1Sec = ds1v; bestS1 = displayS1; }
      }

      if (onCurrentUnrecordedLap && liveEntry?.s1) {
        const liveS1v = parseTime(liveEntry.s1) ?? 999;
        if (liveS1v >= 10 && liveS1v < bestS1Sec) { bestS1Sec = liveS1v; bestS1 = liveEntry.s1; }
      }
      if (onCurrentUnrecordedLap && liveEntry?.s2) {
        const liveS2v = parseTime(liveEntry.s2) ?? 999;
        if (liveS2v >= 10 && liveS2v < bestS2Sec) { bestS2Sec = liveS2v; bestS2 = liveEntry.s2; }
      }
      if (onCurrentUnrecordedLap && liveEntry?.bestS1) {
        const v = parseTime(liveEntry.bestS1) ?? 999;
        if (v >= 10 && v < bestS1Sec) { bestS1Sec = v; bestS1 = liveEntry.bestS1; }
      }
      if (onCurrentUnrecordedLap && liveEntry?.bestS2) {
        const v = parseTime(liveEntry.bestS2) ?? 999;
        if (v >= 10 && v < bestS2Sec) { bestS2Sec = v; bestS2 = liveEntry.bestS2; }
      }

      const liveLapNumber = (onCurrentUnrecordedLap && liveEntry) ? liveEntry.lapNumber : completedLaps;
      const liveKart = (onCurrentUnrecordedLap && liveEntry) ? liveEntry.kart : (pilotLaps[0]?.kart || 0);

      // Position from last recorded lap — used for sorting after all laps done
      const lastRecordedPos = prevLapData?.position ?? 99;
      pilotLastPos.set(pilot, lastRecordedPos);

      if (onCurrentUnrecordedLap && liveEntry?.bestLap) {
        const v = parseTime(liveEntry.bestLap) ?? 999;
        if (v < bestLapSec) { bestLapSec = v; bestLap = liveEntry.bestLap; }
      }

      // Start position from first snapshot event (if available) or first lap
      const startPosition = startPositions?.get(pilot) ?? (pilotLaps.length > 0 ? (pilotLaps[0].position ?? null) : null);

      result.push({
        position: idx + 1, pilot,
        kart: liveKart,
        lastLap: displayLap,
        s1: displayS1,
        s2: displayS2,
        bestLap: bestLap || null,
        lapNumber: liveLapNumber,
        bestS1: bestS1 || null,
        bestS2: bestS2 || null,
        progress,
        currentLapSec: startPosition,
        previousLapSec: null,
      });
    }

    // For race sort: find positions from latest snapshot before current time
    let snapshotPositions: Map<string, number> | null = null;
    if (sessionStartTime && snapshots && snapshots.length > 0) {
      const currentMs = sessionStartTime + timeSec * 1000;
      for (let i = snapshots.length - 1; i >= 0; i--) {
        if (snapshots[i].ts <= currentMs) { snapshotPositions = snapshots[i].positions; break; }
      }
    }

    const sorted = result
      .sort((a, b) => {
        if (a.lapNumber < 0 && b.lapNumber < 0) return 0;
        if (a.lapNumber < 0) return 1;
        if (b.lapNumber < 0) return -1;
        if (sortMode === 'race') {
          if (a.lapNumber !== b.lapNumber) return b.lapNumber - a.lapNumber;
          // Snapshot positions are ground truth from the timing system
          if (snapshotPositions) {
            const aSnap = snapshotPositions.get(a.pilot) ?? 99;
            const bSnap = snapshotPositions.get(b.pilot) ?? 99;
            if (aSnap !== 99 && bSnap !== 99 && aSnap !== bSnap) return aSnap - bSnap;
          }
          const aLastPos = pilotLastPos.get(a.pilot) ?? 99;
          const bLastPos = pilotLastPos.get(b.pilot) ?? 99;
          if (aLastPos !== 99 && bLastPos !== 99 && aLastPos !== bLastPos) return aLastPos - bLastPos;
          const aP = a.progress ?? 0;
          const bP = b.progress ?? 0;
          if (Math.abs(aP - bP) > 0.01) return bP - aP;
          return (startPositions?.get(a.pilot) ?? 99) - (startPositions?.get(b.pilot) ?? 99);
        }
        if (a.lapNumber === 0 && b.lapNumber === 0) return 0;
        if (a.lapNumber === 0) return 1;
        if (b.lapNumber === 0) return -1;
        const aT = parseTime(a.bestLap || '') ?? 999;
        const bT = parseTime(b.bestLap || '') ?? 999;
        return aT - bT;
      })
      .map((e, i) => ({ ...e, position: i + 1 }));

    // Compute precise gap for race mode using cumulative lap times
    if (sortMode === 'race') {
      // Build cumulative lap time sums per pilot (ms) — independent of poll timestamps
      const pilotCumLapMs = new Map<string, number[]>();
      for (const pilot of pilots) {
        const pLaps = laps.filter(l => l.pilot === pilot);
        const cumTimes: number[] = [];
        let accum = 0;
        for (const lap of pLaps) {
          const lapSec = parseTime(lap.lapTime) || 42;
          accum += lapSec * 1000;
          cumTimes.push(accum);
        }
        pilotCumLapMs.set(pilot, cumTimes);
      }

      const currentMs = sessionStartTime ? sessionStartTime + timeSec * 1000 : 0;

      for (let i = 0; i < sorted.length; i++) {
        if (i === 0 || sorted[i].lapNumber < 0) { sorted[i].gap = null; continue; }
        const ahead = sorted[i - 1];
        const behind = sorted[i];
        if (ahead.lapNumber < 0) { behind.gap = null; continue; }

        const lapDiff = ahead.lapNumber - behind.lapNumber;
        if (lapDiff > 0) {
          behind.gap = `+${lapDiff}L`;
          continue;
        }

        const cumA = pilotCumLapMs.get(ahead.pilot) || [];
        const cumB = pilotCumLapMs.get(behind.pilot) || [];
        const commonLap = Math.min(ahead.lapNumber, behind.lapNumber);

        // Try S1 gap on current lap (if both passed S1 in this lap)
        if (sessionStartTime && pilotS1Events.size > 0) {
          const evtsA = pilotS1Events.get(ahead.pilot);
          const evtsB = pilotS1Events.get(behind.pilot);
          if (evtsA && evtsB) {
            const tlA = pilotTimelines.get(ahead.pilot) || [];
            const tlB = pilotTimelines.get(behind.pilot) || [];
            const lastFinishA = commonLap > 0 ? tlA[commonLap - 1] : sessionStartTime;
            const lastFinishB = commonLap > 0 ? tlB[commonLap - 1] : sessionStartTime;
            if (lastFinishA && lastFinishB) {
              let s1A: number | null = null;
              let s1B: number | null = null;
              for (let j = evtsA.length - 1; j >= 0; j--) {
                if (evtsA[j].ts <= currentMs && evtsA[j].ts > lastFinishA) { s1A = evtsA[j].ts; break; }
              }
              for (let j = evtsB.length - 1; j >= 0; j--) {
                if (evtsB[j].ts <= currentMs && evtsB[j].ts > lastFinishB) { s1B = evtsB[j].ts; break; }
              }
              if (s1A != null && s1B != null) {
                const gapSec = (s1B - s1A) / 1000;
                behind.gap = `+${Math.abs(gapSec).toFixed(2)}`;
                continue;
              }
            }
          }
        }

        // Fall back to cumulative lap time difference
        if (commonLap > 0 && cumA.length >= commonLap && cumB.length >= commonLap) {
          const gapMs = cumB[commonLap - 1] - cumA[commonLap - 1];
          behind.gap = `+${Math.abs(gapMs / 1000).toFixed(2)}`;
        } else {
          behind.gap = null;
        }
      }
    }

    return sorted;
  }, [laps, pilots, sessionStartTime, pilotTimelines, pilotS1Events, snapshots, startPositions, liveEntries, sortMode]);

  const [entries, setEntries] = useState<TimingEntry[]>(() => getEntriesAtTime(0));

  // Animation loop
  useEffect(() => {
    if (!playing) return;
    lastTickRef.current = performance.now();
    function tick(now: number) {
      const dt = (now - lastTickRef.current) / 1000 * speed;
      lastTickRef.current = now;
      setCurrentTime(prev => {
        const dur = durationRef.current;
        const next = prev + dt;
        if (!isLive && next >= dur) { setPlaying(false); return dur; }
        return Math.min(next, dur);
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed, isLive]);

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
    setAtLive(false);
    setCurrentTime(val);
    const ent = getEntriesAtTime(val);
    setEntries(ent);
    onTimeUpdate?.(val);
    onEntriesUpdate?.(ent);
  };

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
        value={isLive && atLive ? durationSec : currentTime}
        onChange={(e) => handleScrub(parseFloat(e.target.value))}
        className="flex-1 h-2 bg-dark-700 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-grab"
      />

      {isLive && (
        <button
          onClick={() => {
            setAtLive(true);
            setCurrentTime(durationSec);
            setPlaying(true);
            const ent = getEntriesAtTime(durationSec);
            setEntries(ent);
            onTimeUpdate?.(durationSec);
            onEntriesUpdate?.(ent);
          }}
          className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors shrink-0 ${
            atLive
              ? 'bg-green-500/20 text-green-400'
              : 'bg-dark-800 text-dark-400 hover:text-green-400 hover:bg-green-500/10'
          }`}
        >
          LIVE
        </button>
      )}

      <select
        value={speed}
        onChange={(e) => updateSpeed(parseFloat(e.target.value))}
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

  const wrappedScrubberEl = renderScrubber ? renderScrubber(scrubberEl) : (
    <div className="bg-dark-900/95 border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
      {scrubberEl}
    </div>
  );

  const tableEl = (
    <TimingTable
      entries={entries}
      sortMode={sortMode}
      onSortModeChange={setSortMode}
      columnFilter={columnFilter}
      onColumnFilterChange={setColumnFilter}
      startPositions={startPositions}
      startGrid={startGrid}
      raceGroup={raceGroup}
      totalQualifiedPilots={totalQualifiedPilots}
      isCompetitionRace={raceGroup != null && raceGroup > 0}
      competitionFormat={competitionFormat}
      hidePoints={hidePoints}
      pilotSuffix={pilotSuffix}
    />
  );

  if (renderContent) {
    return <>{renderContent({ scrubber: wrappedScrubberEl, table: tableEl })}</>;
  }

  return (
    <>
      {showScrubber && wrappedScrubberEl}
      {showTable && tableEl}
    </>
  );
}
