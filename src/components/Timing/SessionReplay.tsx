import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { TimingEntry } from '../../types';
import { parseTime, toSeconds, toHundredths, getTimeColor, COLOR_CLASSES, shortName, type TimeColor } from '../../utils/timing';

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

    if (ev.event_type === 'lap' || ev.event_type === 'update') {
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

const ALL_COL_IDS = ['change', 'pilot', 'points', 'kart', 'last', 's1', 's2', 'best', 'bestS1', 'bestS2', 'tb', 'laps'] as const;
type ColId = typeof ALL_COL_IDS[number];
const DEFAULT_ORDER: ColId[] = [...ALL_COL_IDS];
const COL_LABELS: Record<ColId, string> = {
  change: '+/-', pilot: 'Pilot', points: 'P',
  kart: 'Kart', last: 'Last', s1: 'S1', s2: 'S2',
  best: 'Best', bestS1: 'B.S1', bestS2: 'B.S2', tb: 'TB', laps: 'L',
};
const COL_WIDTHS: Record<ColId, string> = {
  change: 'w-8', pilot: 'w-[200px] max-w-[280px]', points: 'w-8',
  kart: 'w-12', last: 'w-16', s1: 'w-14', s2: 'w-14',
  best: 'w-16', bestS1: 'w-14', bestS2: 'w-14', tb: 'w-16', laps: 'w-8',
};
const ALL_COLS_SET = new Set<ColId>(ALL_COL_IDS);
const MAIN_VISIBLE = new Set<ColId>(['change', 'pilot', 'points', 'kart', 'last', 'best', 'laps']);

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
}

export default function SessionReplay({ laps, durationSec, sessionStartTime, isLive, raceNumber, autoPlay, liveEntries, s1Events, snapshots, startPositions, raceGroup, totalQualifiedPilots, defaultSortMode, sortMode: controlledSortMode, onSortModeChange, columnFilter: controlledColumnFilter, onColumnFilterChange, onTimeUpdate, onEntriesUpdate, renderScrubber, showScrubber = true, showTable = true, renderContent }: SessionReplayProps) {
  const [playing, setPlaying] = useState(!!autoPlay);
  const [currentTime, setCurrentTime] = useState(durationSec);
  const [speed, setSpeed] = useState(1);
  const [atLive, setAtLive] = useState(!!isLive && !!autoPlay);
  const [internalSortMode, setInternalSortMode] = useState<ReplaySortMode>(defaultSortMode || 'qualifying');
  const [internalColumnFilter, setInternalColumnFilter] = useState<'all' | 'main' | 'custom'>('all');

  const sortMode = controlledSortMode ?? internalSortMode;
  const setSortMode = onSortModeChange ?? setInternalSortMode;
  const columnFilter = controlledColumnFilter ?? internalColumnFilter;
  const setColumnFilter = onColumnFilterChange ?? setInternalColumnFilter;

  const [customCols, setCustomCols] = useState<Record<ReplaySortMode, { visible: Set<ColId>; order: ColId[] }>>(() => {
    const load = (mode: ReplaySortMode) => {
      try {
        const raw = localStorage.getItem(`karting_timing_cols_${mode}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.order && parsed.hidden) {
            const order = (parsed.order as string[]).filter(c => ALL_COLS_SET.has(c as ColId)) as ColId[];
            const missing = DEFAULT_ORDER.filter(c => !order.includes(c));
            const fullOrder = [...order, ...missing];
            const hidden = new Set(parsed.hidden as string[]);
            return { visible: new Set<ColId>(fullOrder.filter(c => !hidden.has(c))), order: fullOrder };
          }
          const visible = new Set((parsed as string[]).filter(c => ALL_COLS_SET.has(c as ColId)) as ColId[]);
          for (const c of ALL_COLS_SET) visible.add(c);
          return { visible, order: [...DEFAULT_ORDER] };
        }
      } catch {}
      return { visible: new Set<ColId>(ALL_COLS_SET), order: [...DEFAULT_ORDER] };
    };
    return { qualifying: load('qualifying'), race: load('race') };
  });

  const saveCustom = useCallback((mode: ReplaySortMode, state: { visible: Set<ColId>; order: ColId[] }) => {
    const hidden = state.order.filter(c => !state.visible.has(c));
    localStorage.setItem(`karting_timing_cols_${mode}`, JSON.stringify({ order: state.order, hidden }));
  }, []);

  const toggleCustomCol = useCallback((col: ColId) => {
    setCustomCols(prev => {
      const current = prev[sortMode];
      const nextVisible = new Set(current.visible);
      nextVisible.has(col) ? nextVisible.delete(col) : nextVisible.add(col);
      const next = { visible: nextVisible, order: current.order };
      saveCustom(sortMode, next);
      return { ...prev, [sortMode]: next };
    });
  }, [sortMode, saveCustom]);

  const [dragCol, setDragCol] = useState<ColId | null>(null);

  const handleDragStart = useCallback((col: ColId) => { setDragCol(col); }, []);
  const handleDragOver = useCallback((e: React.DragEvent, targetCol: ColId) => {
    e.preventDefault();
    if (!dragCol || dragCol === targetCol) return;
    setCustomCols(prev => {
      const current = prev[sortMode];
      const order = [...current.order];
      const fromIdx = order.indexOf(dragCol);
      const toIdx = order.indexOf(targetCol);
      if (fromIdx === -1 || toIdx === -1) return prev;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragCol);
      const next = { visible: current.visible, order };
      saveCustom(sortMode, next);
      return { ...prev, [sortMode]: next };
    });
  }, [dragCol, sortMode, saveCustom]);
  const handleDragEnd = useCallback(() => { setDragCol(null); }, []);

  const customState = customCols[sortMode];
  const visibleCols: Set<ColId> = columnFilter === 'all' ? ALL_COLS_SET : columnFilter === 'main' ? MAIN_VISIBLE : customState.visible;
  const colOrder: ColId[] = columnFilter === 'custom' ? customState.order : DEFAULT_ORDER;
  const isCol = (id: ColId) => visibleCols.has(id);

  useEffect(() => { if (defaultSortMode && !controlledSortMode) setInternalSortMode(defaultSortMode); }, [defaultSortMode, controlledSortMode]);

  // Scoring data for race points
  const [scoringData, setScoringData] = useState<any>(null);
  useEffect(() => { fetch('/data/scoring.json').then(r => r.json()).then(setScoringData).catch(() => {}); }, []);

  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const durationRef = useRef(durationSec);
  durationRef.current = durationSec;

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

    return result
      .sort((a, b) => {
        if (a.lapNumber < 0 && b.lapNumber < 0) return 0;
        if (a.lapNumber < 0) return 1;
        if (b.lapNumber < 0) return -1;
        if (sortMode === 'race') {
          if (a.lapNumber !== b.lapNumber) return b.lapNumber - a.lapNumber;
          const aP = a.progress ?? 0;
          const bP = b.progress ?? 0;
          if (Math.abs(aP - bP) > 0.01) return bP - aP;
          const aLastPos = pilotLastPos.get(a.pilot) ?? 99;
          const bLastPos = pilotLastPos.get(b.pilot) ?? 99;
          if (aLastPos !== 99 || bLastPos !== 99) return aLastPos - bLastPos;
          // Use snapshot positions (ground truth from timing system)
          if (snapshotPositions) {
            const aSnap = snapshotPositions.get(a.pilot) ?? 99;
            const bSnap = snapshotPositions.get(b.pilot) ?? 99;
            if (aSnap !== 99 || bSnap !== 99) return aSnap - bSnap;
          }
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

  // Overall bests for color coding
  const { overallBestLap, overallBestS1, overallBestS2 } = useMemo(() => {
    let bLap: number | null = null, bS1: number | null = null, bS2: number | null = null;
    for (const e of entries) {
      const lap = parseTime(e.bestLap); if (lap !== null && (bLap === null || lap < bLap)) bLap = lap;
      const s1 = parseTime(e.bestS1); if (s1 !== null && s1 >= 10 && (bS1 === null || s1 < bS1)) bS1 = s1;
      const s2 = parseTime(e.bestS2); if (s2 !== null && s2 >= 10 && (bS2 === null || s2 < bS2)) bS2 = s2;
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

  const wrappedScrubberEl = renderScrubber ? renderScrubber(scrubberEl) : (
    <div className="bg-dark-900/95 border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
      {scrubberEl}
    </div>
  );

  const tableEl = (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800 flex items-center gap-3 flex-wrap">
        <div className="flex bg-dark-800 rounded-md p-0.5">
          <button
            onClick={() => setSortMode('qualifying')}
            className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
              sortMode === 'qualifying' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
            }`}
          >
            Квала
          </button>
          <button
            onClick={() => setSortMode('race')}
            className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
              sortMode === 'race' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
            }`}
          >
            Гонка
          </button>
        </div>
        <div className="flex items-center gap-1.5 border border-dark-700 rounded-lg px-2.5 py-1 flex-wrap">
          <span className="text-dark-500 text-[9px]">Вид:</span>
          <span className="flex rounded overflow-hidden">
            <button onClick={() => setColumnFilter('all')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${columnFilter === 'all' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Все</button>
            <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
            <button onClick={() => setColumnFilter('main')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${columnFilter === 'main' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Осн</button>
            <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
            <button onClick={() => setColumnFilter('custom')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${columnFilter === 'custom' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Своє</button>
          </span>
          {columnFilter === 'custom' && (
            <>
              <span className="text-dark-700 text-[9px]">|</span>
              {customState.order.map(col => (
                <button
                  key={col}
                  draggable
                  onDragStart={() => handleDragStart(col)}
                  onDragOver={(e) => handleDragOver(e, col)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggleCustomCol(col)}
                  className={`px-1.5 py-0.5 rounded text-[9px] transition-colors cursor-grab active:cursor-grabbing ${
                    dragCol === col ? 'ring-1 ring-primary-400 opacity-60' : ''
                  } ${
                    visibleCols.has(col) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
                  }`}
                >
                  {COL_LABELS[col]}
                </button>
              ))}
            </>
          )}
        </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-fixed text-xs [&_th]:px-2.5 [&_th]:py-1 [&_td]:px-2.5 [&_td]:py-1">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-6">#</th>
              {colOrder.filter(c => isCol(c)).map(col => {
                if (col === 'change' && sortMode !== 'race') return null;
                if (col === 'points' && !(sortMode === 'race' && raceGroup)) return null;
                const align = col === 'pilot' ? 'text-left' : 'text-center';
                const extra = (col === 'change' || col === 'points') ? ' text-dark-500' : '';
                return <th key={col} className={`table-cell ${align}${extra} ${COL_WIDTHS[col]}`}>{COL_LABELS[col]}</th>;
              })}
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

              const cellMap: Record<ColId, React.ReactNode> = {
                change: sortMode === 'race' ? (
                  <td key="change" className="table-cell text-center font-mono text-[10px]">{(() => {
                    if (notStarted) return '';
                    const st = e.currentLapSec;
                    if (st == null) return '—';
                    const diff = st - e.position;
                    if (diff > 0) return <span className="text-green-400">↑{diff}</span>;
                    if (diff < 0) return <span className="text-red-400">↓{Math.abs(diff)}</span>;
                    return <span className="text-dark-600">0</span>;
                  })()}</td>
                ) : null,
                pilot: (
                  <td key="pilot" className="table-cell text-left py-1.5">
                    <div className={`font-medium text-[13px] leading-tight ${notStarted ? 'text-dark-500' : ''}`}>
                      <Link to={`/pilots/${encodeURIComponent(e.pilot)}`} className={`${notStarted ? 'text-dark-500' : 'text-white hover:text-primary-400'} transition-colors`}>
                        {shortName(e.pilot)}
                      </Link>
                    </div>
                    <div className="mt-0.5 h-[1.5px] w-1/2 bg-dark-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-[50ms] ease-linear bg-yellow-500/60"
                        style={{ width: `${!notStarted && e.progress !== null ? Math.round(e.progress * 100) : 0}%` }}
                      />
                    </div>
                  </td>
                ),
                points: (sortMode === 'race' && raceGroup && scoringData) ? (
                  <td key="points" className="table-cell text-center font-mono text-[10px] text-green-400/70">{(() => {
                    if (notStarted) return '';
                    const st = e.currentLapSec;
                    if (st == null) return '—';
                    const finishPos = e.position;
                    const groupLabel = raceGroup === 1 ? 'I' : raceGroup === 2 ? 'II' : 'III';
                    const total = totalQualifiedPilots || 0;
                    const cat = scoringData.positionPoints?.find((c: any) => total >= c.minPilots && total <= c.maxPilots);
                    const posArr = cat?.groups?.[groupLabel];
                    const posPoints = posArr && finishPos >= 1 && finishPos <= posArr.length ? posArr[finishPos - 1] : 0;
                    let overtakePoints = 0;
                    for (let pos = st; pos > finishPos; pos--) {
                      if (raceGroup === 3) overtakePoints += scoringData.overtakePoints?.groupIII ?? 0;
                      else if (raceGroup === 2) overtakePoints += scoringData.overtakePoints?.groupII ?? 0;
                      else {
                        const rule = scoringData.overtakePoints?.groupI?.find((r: any) => pos >= r.startPosMin && pos <= r.startPosMax);
                        overtakePoints += rule?.perOvertake ?? 0;
                      }
                    }
                    const total_pts = Math.round((posPoints + overtakePoints) * 10) / 10;
                    return total_pts || '—';
                  })()}</td>
                ) : null,
                kart: <td key="kart" className="table-cell text-center font-mono text-dark-300">{notStarted ? '' : (e.kart || '—')}</td>,
                last: <td key="last" className={`table-cell text-center font-mono font-semibold ${notStarted ? '' : COLOR_CLASSES[lapColor]}`}>{notStarted ? '' : (e.lastLap ? toSeconds(e.lastLap) : '—')}</td>,
                s1: <td key="s1" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[s1Color]}`}>{notStarted ? '' : (e.s1 && (parseTime(e.s1) ?? 0) >= 10 ? toHundredths(e.s1) : '—')}</td>,
                s2: <td key="s2" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[s2Color]}`}>{notStarted ? '' : (e.s2 && (parseTime(e.s2) ?? 0) >= 10 ? toHundredths(e.s2) : '—')}</td>,
                best: <td key="best" className={`table-cell text-center font-mono font-semibold ${notStarted ? '' : COLOR_CLASSES[bestLapColor]}`}>{notStarted ? '' : (e.bestLap ? toSeconds(e.bestLap) : '—')}</td>,
                bestS1: <td key="bestS1" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[bestS1Color]}`}>{notStarted ? '' : (e.bestS1 && (parseTime(e.bestS1) ?? 0) >= 10 ? toHundredths(e.bestS1) : '—')}</td>,
                bestS2: <td key="bestS2" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[bestS2Color]}`}>{notStarted ? '' : (e.bestS2 && (parseTime(e.bestS2) ?? 0) >= 10 ? toHundredths(e.bestS2) : '—')}</td>,
                tb: <td key="tb" className="table-cell text-center font-mono text-[11px] text-dark-400">{(() => {
                  if (notStarted) return '';
                  const s1v = parseTime(e.bestS1);
                  const s2v = parseTime(e.bestS2);
                  if (s1v === null || s1v < 10 || s2v === null || s2v < 10) return '—';
                  return (s1v + s2v).toFixed(3);
                })()}</td>,
                laps: <td key="laps" className="table-cell text-center font-mono text-dark-500">{notStarted ? '' : e.lapNumber}</td>,
              };

              return (
                <tr key={e.pilot} className="table-row">
                  <td className="table-cell text-center font-mono font-bold text-dark-400">
                    {notStarted ? '—' : e.position}
                  </td>
                  {colOrder.filter(c => isCol(c)).map(col => cellMap[col])}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

      </div>
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
