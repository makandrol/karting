/**
 * Клієнт для Collector API
 *
 * Фронтенд підключається до collector'а для отримання live даних.
 * Якщо collector недоступний — показує офлайн стан.
 */

import { COLLECTOR_URL } from './config';

export interface CollectorStatus {
  online: boolean;
  pollCount: number;
  errorCount: number;
  entriesCount: number;
  eventsCount: number;
  sessionId: string | null;
  sessionsCount: number;
  lastUpdate: number | null;
  pollInterval: number;
}

export interface CollectorTimingData {
  isOnline: boolean;
  entries: any[];
  lastUpdate: number | null;
  sessionId: string | null;
}

export async function fetchCollectorStatus(): Promise<CollectorStatus | null> {
  try {
    const res = await fetch(`${COLLECTOR_URL}/status`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchCollectorTiming(): Promise<CollectorTimingData | null> {
  try {
    const res = await fetch(`${COLLECTOR_URL}/timing`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchCollectorEvents(sessionId?: string | null, since?: number): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    if (sessionId) params.set('session', sessionId);
    if (since) params.set('since', String(since));
    const res = await fetch(`${COLLECTOR_URL}/events?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export function getCollectorUrl(): string {
  return COLLECTOR_URL;
}
