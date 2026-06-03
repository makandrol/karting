/**
 * Persistent state hook backed by localStorage with safe (de)serialization.
 *
 * Replaces the boilerplate
 *   try { localStorage.setItem(...) } catch {}
 *   try { const s = localStorage.getItem(...); if (s) return JSON.parse(s); } catch {}
 * which was duplicated across 14 files.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface Options<T> {
  /** End-of-day expiry. After midnight `loadWithExpiry` will return null and reset to default. */
  endOfDayExpiry?: boolean;
  /** Custom JSON revival (e.g. arrays → Set). */
  reviver?: (raw: unknown) => T;
  /** Custom JSON serializer (e.g. Set → array). */
  serializer?: (value: T) => unknown;
}

interface StoredEntry<T> {
  value: T;
  expiresAt?: number;
}

function load<T>(key: string, defaultValue: T, opts: Options<T>): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw) as StoredEntry<unknown> | T;
    if (opts.endOfDayExpiry && parsed && typeof parsed === 'object' && 'value' in (parsed as object)) {
      const entry = parsed as StoredEntry<unknown>;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        localStorage.removeItem(key);
        return defaultValue;
      }
      return opts.reviver ? opts.reviver(entry.value) : (entry.value as T);
    }
    return opts.reviver ? opts.reviver(parsed) : (parsed as T);
  } catch {
    return defaultValue;
  }
}

function save<T>(key: string, value: T, opts: Options<T>): void {
  try {
    const serialized = opts.serializer ? opts.serializer(value) : value;
    if (opts.endOfDayExpiry) {
      const eod = new Date();
      eod.setHours(23, 59, 59, 999);
      localStorage.setItem(key, JSON.stringify({ value: serialized, expiresAt: eod.getTime() }));
    } else {
      localStorage.setItem(key, JSON.stringify(serialized));
    }
  } catch { /* quota / private mode — ignore */ }
}

/**
 * State synchronized with `localStorage[key]`.
 *
 * @example
 *   const [filter, setFilter] = useLocalStorage('karting_filter', { mode: 'today' });
 *
 * @example with end-of-day expiry (default selections reset at midnight):
 *   const [dates, setDates] = useLocalStorage<Set<string>>('karting_dates', new Set(), {
 *     endOfDayExpiry: true,
 *     reviver: (raw) => new Set(raw as string[]),
 *     serializer: (s) => [...s],
 *   });
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  opts: Options<T> = {},
): [T, (value: T | ((prev: T) => T)) => void] {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [state, setState] = useState<T>(() => load(key, defaultValue, opts));

  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    setState(prev => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      save(key, value, optsRef.current);
      return value;
    });
  }, [key]);

  // Re-load if key changes (rare, but possible).
  useEffect(() => {
    setState(load(key, defaultValue, optsRef.current));
    // defaultValue intentionally not in deps — the initial value is captured once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [state, setAndPersist];
}
