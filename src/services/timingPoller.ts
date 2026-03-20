import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimingEntry, TimingSnapshot } from '../types';
import { COLLECTOR_URL } from './config';

const DEFAULT_POLL_INTERVAL = 1000;

export type TimingMode = 'idle' | 'live' | 'connecting';

interface UseTimingPollerOptions {
  interval?: number;
}

interface UseTimingPollerResult {
  entries: TimingEntry[];
  snapshots: TimingSnapshot[];
  mode: TimingMode;
  lastUpdate: number | null;
  error: string | null;
  collectorStatus: CollectorInfo | null;
}

interface CollectorInfo {
  online: boolean;
  siteReachable: boolean;
  siteReachableSince: number | null;
  pollCount: number;
  errorCount: number;
  pollInterval: number;
  sessionId: string | null;
}

/**
 * Поллер таймінгу — автоматично підключається до collector'а.
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

  const clearPolling = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const pollCollector = useCallback(async () => {
    try {
      const statusRes = await fetch(`${COLLECTOR_URL}/status`, { signal: AbortSignal.timeout(5000) });
      if (!statusRes.ok) throw new Error('Collector unavailable');
      const status: CollectorInfo = await statusRes.json();
      setCollectorStatus(status);

      if (status.online) {
        const timingRes = await fetch(`${COLLECTOR_URL}/timing`, { signal: AbortSignal.timeout(5000) });
        if (!timingRes.ok) throw new Error('Failed to fetch timing');
        const data = await timingRes.json();

        if (data.entries && data.entries.length > 0) {
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
            progress: null,
            currentLapSec: null,
            previousLapSec: null,
          }));

          setEntries(mapped);
          setLastUpdate(data.lastUpdate || Date.now());
          setMode('live');
          setError(null);

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
        setMode('idle');
        setEntries([]);
        setError(null);
      }
    } catch {
      setMode('idle');
      setError('Сервер недоступний');
    }
  }, []);

  useEffect(() => {
    clearPolling();
    pollCollector();
    const pollInterval = mode === 'live' ? interval : 5000;
    intervalRef.current = setInterval(pollCollector, pollInterval);
    return () => clearPolling();
    // Only re-run when mode or interval changes, not pollCollector
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, interval]);

  return { entries, snapshots, mode, lastUpdate, error, collectorStatus };
}
