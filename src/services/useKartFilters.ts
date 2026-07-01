import { useMemo, useCallback, useState, useEffect } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { fmtDateISO } from '../utils/datetime';
import { isValidSession } from '../utils/timing';
import { api, type DbSession } from './api';
import { ALL_TRACK_IDS } from '../components/Sessions/TrackFilter';

/**
 * Спільні фільтри для сторінок "Карти" та конкретного карта:
 *  - вибрані дати (multi-select, expiry в кінці дня, default = сьогодні)
 *  - вибрані траси (persist назавжди, default = всі)
 *  - виключені вручну заїзди (expiry в кінці дня)
 *
 * Усі сторінки використовують ті самі localStorage-ключі → фільтри спільні.
 */
export function useKartFilters() {
  const todayStr = fmtDateISO(new Date());

  // ── Dates ──
  const [selectedDatesArr, setSelectedDatesArr] = useLocalStorage<string[]>(
    'karting_karts_selected_dates',
    [todayStr],
    { endOfDayExpiry: true },
  );
  const selectedDates = useMemo(() => new Set(selectedDatesArr), [selectedDatesArr]);

  const toggleDate = useCallback((date: string) => {
    setSelectedDatesArr(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return [...next];
    });
  }, [setSelectedDatesArr]);

  const selectDates = useCallback((dates: string[]) => {
    setSelectedDatesArr(prev => {
      const next = new Set(prev);
      for (const d of dates) next.add(d);
      return [...next];
    });
  }, [setSelectedDatesArr]);

  const clearDates = useCallback(() => setSelectedDatesArr([]), [setSelectedDatesArr]);

  // ── Tracks ──
  const [selectedTracksArr, setSelectedTracksArr] = useLocalStorage<number[]>(
    'karting_karts_selected_tracks',
    [...ALL_TRACK_IDS],
  );
  const selectedTracks = useMemo(() => new Set(selectedTracksArr), [selectedTracksArr]);
  const allTracksSelected = selectedTracks.size === ALL_TRACK_IDS.length;
  const trackFilter = allTracksSelected ? null : selectedTracks;

  const toggleTrack = useCallback((id: number) => {
    setSelectedTracksArr(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return [...next];
    });
  }, [setSelectedTracksArr]);
  const selectAllTracks = useCallback(() => setSelectedTracksArr([...ALL_TRACK_IDS]), [setSelectedTracksArr]);
  const clearAllTracks = useCallback(() => setSelectedTracksArr([]), [setSelectedTracksArr]);

  // ── Excluded sessions ──
  const [excludedSessionsArr, setExcludedSessionsArr] = useLocalStorage<string[]>(
    'karting_karts_excluded_sessions',
    [],
    { endOfDayExpiry: true },
  );
  const excludedSessions = useMemo(() => new Set(excludedSessionsArr), [excludedSessionsArr]);
  const toggleExcludeSession = useCallback((id: string) => {
    setExcludedSessionsArr(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return [...next];
    });
  }, [setExcludedSessionsArr]);

  return {
    todayStr,
    selectedDates, toggleDate, selectDates, clearDates,
    selectedTracks, trackFilter, toggleTrack, selectAllTracks, clearAllTracks,
    excludedSessions, toggleExcludeSession,
  };
}

/**
 * Завантажує валідні сесії для набору дат (паралельно).
 * Включає й незавершені (live / "завислі" без end_time) — щоб їх можна було
 * вибрати у фільтрах Карт. Дуже короткі завершені (<60с) відсіює isValidSession.
 * Спільне для сторінки всіх картів і конкретного карта.
 *
 * @param selectedDates set дат "YYYY-MM-DD"
 * @param trackFilter якщо передано — фільтрує сесії по track_id
 */
export function useSelectedDateSessions(
  selectedDates: Set<string>,
  trackFilter?: Set<number> | null,
): { sessions: DbSession[]; loading: boolean } {
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading, setLoading] = useState(false);

  // Стабільний ключ дат для deps (Set пересоздається щорендеру).
  const datesKey = useMemo(() => [...selectedDates].sort().join(','), [selectedDates]);

  useEffect(() => {
    const dates = datesKey ? datesKey.split(',') : [];
    if (dates.length === 0) { setSessions([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const results = await Promise.all(
        dates.map(date =>
          api.sessions.byDate(date)
            .then(data => (data as unknown as DbSession[]).filter(s => isValidSession(s)))
            .catch(() => [] as DbSession[]),
        ),
      );
      if (cancelled) return;
      setSessions(results.flat());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [datesKey]);

  const filtered = useMemo(
    () => (trackFilter ? sessions.filter(s => trackFilter.has((s as any).track_id || 1)) : sessions),
    [sessions, trackFilter],
  );

  return { sessions: filtered, loading };
}
