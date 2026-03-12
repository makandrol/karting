import { useState, useEffect, useRef, useCallback } from 'react';
import type { TimingEntry, TimingSnapshot } from '../types';
import { fetchTimingFromSite, updateBestSectors } from './timingParser';
import { generateMockTimingEntries } from '../mock/timingData';

const DEFAULT_POLL_INTERVAL = 1000; // 1 second

interface UseTimingPollerOptions {
  interval?: number;
  useMock?: boolean;
  enabled?: boolean;
}

interface UseTimingPollerResult {
  entries: TimingEntry[];
  snapshots: TimingSnapshot[];
  isLive: boolean;
  isMock: boolean;
  lastUpdate: number | null;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * React hook для polling таймінгу.
 *
 * Спочатку намагається отримати дані з timing.karting.ua.
 * Якщо сайт недоступний — перемикається на mock-дані.
 *
 * Зберігає всі snapshots в пам'яті для подальшої обробки.
 */
export function useTimingPoller(options: UseTimingPollerOptions = {}): UseTimingPollerResult {
  const {
    interval = DEFAULT_POLL_INTERVAL,
    useMock = false,
    enabled = true,
  } = options;

  const [entries, setEntries] = useState<TimingEntry[]>([]);
  const [snapshots, setSnapshots] = useState<TimingSnapshot[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(enabled);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bestSectorsRef = useRef(new Map<string, { bestS1: string | null; bestS2: string | null }>());

  const poll = useCallback(async () => {
    try {
      let newEntries: TimingEntry[] | null = null;

      if (!useMock) {
        newEntries = await fetchTimingFromSite();
      }

      if (newEntries) {
        // Real data from timing site
        newEntries = updateBestSectors(newEntries, bestSectorsRef.current);
        setIsLive(true);
        setIsMock(false);
      } else {
        // Fallback to mock
        newEntries = generateMockTimingEntries(10);
        setIsLive(false);
        setIsMock(true);
      }

      const now = Date.now();
      setEntries(newEntries);
      setLastUpdate(now);
      setError(null);

      // Save snapshot (limit to last 1000 in memory)
      setSnapshots((prev) => {
        const snapshot: TimingSnapshot = {
          timestamp: now,
          sessionId: 'current',
          entries: newEntries!,
        };
        const updated = [...prev, snapshot];
        return updated.length > 1000 ? updated.slice(-1000) : updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка отримання даних');
    }
  }, [useMock]);

  const start = useCallback(() => setIsRunning(true), []);
  const stop = useCallback(() => setIsRunning(false), []);

  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial poll
    poll();

    // Set up interval
    intervalRef.current = setInterval(poll, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, interval, poll]);

  return {
    entries,
    snapshots,
    isLive,
    isMock,
    lastUpdate,
    error,
    start,
    stop,
  };
}
