import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './auth';

interface ViewPrefs {
  showTrack: boolean;
  showLapsByPilots: boolean;
  showLeaguePoints: boolean;
  showLeagueSessions: boolean;
  [key: string]: boolean;
}

const DEFAULTS: ViewPrefs = { showTrack: true, showLapsByPilots: true, showLeaguePoints: true, showLeagueSessions: true };

function getStorageKey(email: string | null): string {
  return email ? `karting_view_prefs_${email}` : 'karting_view_prefs_anon';
}

function loadPrefs(email: string | null): ViewPrefs {
  try {
    const raw = localStorage.getItem(getStorageKey(email));
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function useViewPrefs() {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const [prefs, setPrefs] = useState<ViewPrefs>(() => loadPrefs(email));

  useEffect(() => {
    setPrefs(loadPrefs(email));
  }, [email]);

  useEffect(() => {
    localStorage.setItem(getStorageKey(email), JSON.stringify(prefs));
  }, [prefs, email]);

  const toggle = useCallback((key: keyof ViewPrefs) => {
    setPrefs(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { prefs, toggle };
}
