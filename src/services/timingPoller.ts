import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimingEntry, TimingSnapshot } from '../types';
import { DemoSimulator } from '../mock/demoSimulator';

const DEFAULT_POLL_INTERVAL = 1000;
const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_URL || 'http://150.230.157.143:3001';

export type TimingMode = 'idle' | 'live' | 'demo' | 'connecting';

interface UseTimingPollerOptions {
  interval?: number;
}

interface UseTimingPollerResult {
  entries: TimingEntry[];
  snapshots: TimingSnapshot[];
  mode: TimingMode;
  lastUpdate: number | null;
  error: string | null;
  startDemo: () => void;
  stop: () => void;
  collectorStatus: CollectorInfo | null;
}

interface CollectorInfo {
  online: boolean;
  pollCount: number;
  errorCount: number;
  pollInterval: number;
  sessionId: string | null;
}

/**
 * Поллер таймінгу — автоматично підключається до collector'а.
 *
 * 1. При старті → запитує /status collector'а
 * 2. Якщо collector доступний і таймінг online → показує live дані
 * 3. Якщо collector доступний але таймінг offline → показує "Офлайн"
 * 4. Якщо collector недоступний → показує "Немає з'єднання з сервером"
 */
export function useTimingPoller(options: UseTimingPollerOptions = {}): UseTimingPollerResult {
  const { interval = DEFAULT_POLL_INTERVAL } = options;

  const [entries, setEntries] = useState<TimingEntry[]>([]);
  const [snapshots, setSnapshots] = useState<TimingSnapshot[]>([]);
  const [mode, setMode] = useState<TimingMode>('connecting');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<CollectorInfo | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simulatorRef = useRef<DemoSimulator | null>(null);
  const modeRef = useRef<TimingMode>('connecting');

  useEffect(() => { modeRef.current = mode; }, [mode]);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  // Fetch data from collector
  const pollCollector = useCallback(async () => {
    try {
      // First check status
      const statusRes = await fetch(`${COLLECTOR_URL}/status`, { signal: AbortSignal.timeout(5000) });
      if (!statusRes.ok) throw new Error('Collector unavailable');
      const status: CollectorInfo = await statusRes.json();
      setCollectorStatus(status);

      if (status.online) {
        // Timing is live — fetch entries
        const timingRes = await fetch(`${COLLECTOR_URL}/timing`, { signal: AbortSignal.timeout(5000) });
        if (!timingRes.ok) throw new Error('Failed to fetch timing');
        const data = await timingRes.json();

        if (data.entries && data.entries.length > 0) {
          // Map collector entries to our TimingEntry format
          const mapped: TimingEntry[] = data.entries.map((e: any, i: number) => ({
            position: e.position || i + 1,
            pilot: e.pilot,
            kart: e.kart,
            lastLap: e.lastLap || null,
            s1: e.s1 || null,
            s2: e.s2 || null,
            bestLap: e.bestLap || null,
            lapNumber: e.lapNumber || 0,
            bestS1: null,
            bestS2: null,
            progress: null, // collector doesn't track progress yet
            currentLapSec: null,
            previousLapSec: null,
          }));

          setEntries(mapped);
          setLastUpdate(data.lastUpdate || Date.now());
          setMode('live');
          setError(null);

          // Save snapshot
          setSnapshots(prev => {
            const snap: TimingSnapshot = { timestamp: Date.now(), sessionId: status.sessionId || 'live', entries: mapped };
            const updated = [...prev, snap];
            return updated.length > 500 ? updated.slice(-500) : updated;
          });
        } else {
          setMode('live');
          setError(null);
        }
      } else {
        // Collector connected but timing offline
        setMode('idle');
        setEntries([]);
        setError(null);
      }
    } catch {
      // Collector not reachable
      if (modeRef.current !== 'demo') {
        setMode('idle');
        setError('Сервер недоступний');
      }
    }
  }, []);

  // Demo mode
  const pollDemo = useCallback(() => {
    if (!simulatorRef.current) simulatorRef.current = new DemoSimulator(10);
    const newEntries = simulatorRef.current.tick();
    setEntries(newEntries);
    setLastUpdate(Date.now());
    setSnapshots(prev => {
      const snap: TimingSnapshot = { timestamp: Date.now(), sessionId: 'demo', entries: newEntries };
      const updated = [...prev, snap];
      return updated.length > 500 ? updated.slice(-500) : updated;
    });
  }, []);

  const startDemo = useCallback(() => {
    simulatorRef.current = new DemoSimulator(10);
    setMode('demo');
    setError(null);
  }, []);

  const stop = useCallback(() => {
    setMode('connecting');
    clearPolling();
    simulatorRef.current = null;
    setEntries([]);
    setSnapshots([]);
    setError(null);
    setLastUpdate(null);
  }, [clearPolling]);

  // Main polling loop
  useEffect(() => {
    clearPolling();

    if (mode === 'demo') {
      pollDemo();
      intervalRef.current = setInterval(pollDemo, interval);
    } else {
      // Poll collector
      pollCollector();
      // Poll at 2 sec for live detection, faster updates come from collector
      intervalRef.current = setInterval(pollCollector, mode === 'live' ? interval : 5000);
    }

    return () => clearPolling();
  }, [mode, interval, pollCollector, pollDemo, clearPolling]);

  // Initial: start by checking collector
  useEffect(() => {
    pollCollector();
  }, [pollCollector]);

  return {
    entries,
    snapshots,
    mode,
    lastUpdate,
    error,
    startDemo,
    stop,
    collectorStatus,
  };
}
