import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimingEntry, TimingSnapshot } from '../types';
import { fetchTimingFromSite, updateBestSectors } from './timingParser';
import { generateMockTimingEntries } from '../mock/timingData';

const DEFAULT_POLL_INTERVAL = 1000; // 1 second

export type TimingMode = 'idle' | 'live' | 'demo';

interface UseTimingPollerOptions {
  interval?: number;
}

interface UseTimingPollerResult {
  entries: TimingEntry[];
  snapshots: TimingSnapshot[];
  mode: TimingMode;
  lastUpdate: number | null;
  error: string | null;
  /** Спробувати підключитись до live таймінгу */
  connectLive: () => void;
  /** Увімкнути демо-режим */
  startDemo: () => void;
  /** Зупинити все */
  stop: () => void;
}

/**
 * React hook для polling таймінгу.
 *
 * Починає в режимі 'idle' — нічого не робить.
 * Користувач може:
 * - connectLive() — спробувати підключитись до timing.karting.ua
 * - startDemo() — увімкнути демо-дані
 * - stop() — зупинити
 */
export function useTimingPoller(options: UseTimingPollerOptions = {}): UseTimingPollerResult {
  const { interval = DEFAULT_POLL_INTERVAL } = options;

  const [entries, setEntries] = useState<TimingEntry[]>([]);
  const [snapshots, setSnapshots] = useState<TimingSnapshot[]>([]);
  const [mode, setMode] = useState<TimingMode>('idle');
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bestSectorsRef = useRef(new Map<string, { bestS1: string | null; bestS2: string | null }>());
  const modeRef = useRef<TimingMode>('idle');

  // Keep modeRef in sync
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    const currentMode = modeRef.current;
    if (currentMode === 'idle') return;

    try {
      let newEntries: TimingEntry[] | null = null;

      if (currentMode === 'live') {
        newEntries = await fetchTimingFromSite();
        if (!newEntries) {
          setError('Таймінг недоступний. Картодром не працює або сайт offline.');
          return;
        }
        newEntries = updateBestSectors(newEntries, bestSectorsRef.current);
      } else if (currentMode === 'demo') {
        newEntries = generateMockTimingEntries(10);
      }

      if (!newEntries) return;

      const now = Date.now();
      setEntries(newEntries);
      setLastUpdate(now);
      setError(null);

      // Save snapshot (limit to last 1000 in memory)
      setSnapshots((prev) => {
        const snapshot: TimingSnapshot = {
          timestamp: now,
          sessionId: currentMode === 'demo' ? 'demo' : 'live',
          entries: newEntries!,
        };
        const updated = [...prev, snapshot];
        return updated.length > 1000 ? updated.slice(-1000) : updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка отримання даних');
    }
  }, []);

  const startPolling = useCallback(() => {
    clearPolling();
    poll();
    intervalRef.current = setInterval(poll, interval);
  }, [clearPolling, poll, interval]);

  const connectLive = useCallback(() => {
    setMode('live');
    setError(null);
    setEntries([]);
    setSnapshots([]);
    bestSectorsRef.current.clear();
  }, []);

  const startDemo = useCallback(() => {
    setMode('demo');
    setError(null);
    setEntries([]);
    setSnapshots([]);
    bestSectorsRef.current.clear();
  }, []);

  const stop = useCallback(() => {
    setMode('idle');
    clearPolling();
    setEntries([]);
    setSnapshots([]);
    setError(null);
    setLastUpdate(null);
  }, [clearPolling]);

  // Start/stop polling when mode changes
  useEffect(() => {
    if (mode === 'idle') {
      clearPolling();
      return;
    }

    startPolling();

    return () => clearPolling();
  }, [mode, startPolling, clearPolling]);

  return {
    entries,
    snapshots,
    mode,
    lastUpdate,
    error,
    connectLive,
    startDemo,
    stop,
  };
}
