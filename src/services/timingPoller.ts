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
  const bestS1Ref = useRef<Map<string, number>>(new Map());
  const bestS2Ref = useRef<Map<string, number>>(new Map());
  const lastSessionRef = useRef<string | null>(null);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const parseTime = (str: string | null | undefined): number | null => {
    if (!str) return null;
    if (str.includes(':')) {
      const [m, s] = str.split(':');
      return parseFloat(m) * 60 + parseFloat(s);
    }
    const v = parseFloat(str);
    return isNaN(v) ? null : v;
  };

  const pollCollector = useCallback(async () => {
    try {
      const statusRes = await fetch(`${COLLECTOR_URL}/status`, { signal: AbortSignal.timeout(5000) });
      if (!statusRes.ok) throw new Error('Collector unavailable');
      const status: CollectorInfo = await statusRes.json();
      setCollectorStatus(status);

      if (status.online) {
        if (lastSessionRef.current && status.sessionId !== lastSessionRef.current) {
          bestS1Ref.current.clear();
          bestS2Ref.current.clear();
        }
        lastSessionRef.current = status.sessionId;

        const timingRes = await fetch(`${COLLECTOR_URL}/timing`, { signal: AbortSignal.timeout(5000) });
        if (!timingRes.ok) throw new Error('Failed to fetch timing');
        const data = await timingRes.json();

        if (data.entries && data.entries.length > 0) {
          const mapped: TimingEntry[] = data.entries.map((e: any, i: number) => {
            const pilot = e.pilot;
            const s1v = parseTime(e.s1);
            const s2v = parseTime(e.s2);

            if (s1v !== null && s1v >= 10) {
              const prev = bestS1Ref.current.get(pilot);
              if (prev === undefined || s1v < prev) bestS1Ref.current.set(pilot, s1v);
            }
            if (s2v !== null && s2v >= 10) {
              const prev = bestS2Ref.current.get(pilot);
              if (prev === undefined || s2v < prev) bestS2Ref.current.set(pilot, s2v);
            }

            const bS1 = bestS1Ref.current.get(pilot);
            const bS2 = bestS2Ref.current.get(pilot);

            return {
              position: e.position || i + 1,
              pilot,
              kart: e.kart,
              lastLap: e.lastLap || null,
              s1: e.s1 || null,
              s2: e.s2 || null,
              bestLap: e.bestLap || null,
              lapNumber: e.lapNumber || 0,
              bestS1: bS1 !== undefined ? String(bS1.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')) : null,
              bestS2: bS2 !== undefined ? String(bS2.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')) : null,
              progress: null,
              currentLapSec: null,
              previousLapSec: null,
            };
          });

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
