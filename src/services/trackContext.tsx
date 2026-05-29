import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { TRACK_CONFIGS, type TrackConfig } from '../data/tracks';
import { api } from './api';

const LS_CURRENT_TRACK = 'karting_current_track';

interface TrackContextValue {
  currentTrack: TrackConfig;
  setCurrentTrack: (id: number) => Promise<void>;
  allTracks: TrackConfig[];
}

const TrackContext = createContext<TrackContextValue | null>(null);

export function TrackProvider({ children }: { children: ReactNode }) {
  const [currentTrack, setCurrentTrackState] = useState<TrackConfig>(() => {
    try {
      const saved = localStorage.getItem(LS_CURRENT_TRACK);
      if (saved) {
        const id = parseInt(saved, 10);
        const found = TRACK_CONFIGS.find((t) => t.id === id);
        if (found) return found;
      }
    } catch { /* ignore */ }
    return TRACK_CONFIGS[0];
  });

  useEffect(() => {
    localStorage.setItem(LS_CURRENT_TRACK, String(currentTrack.id));
  }, [currentTrack]);

  const setCurrentTrack = async (id: number) => {
    const found = TRACK_CONFIGS.find((t) => t.id === id);
    if (!found) return;
    setCurrentTrackState(found);
    try {
      await api.track.set(id);
    } catch { /* ignore */ }
  };

  return (
    <TrackContext.Provider value={{ currentTrack, setCurrentTrack, allTracks: TRACK_CONFIGS }}>
      {children}
    </TrackContext.Provider>
  );
}

export function useTrack(): TrackContextValue {
  const ctx = useContext(TrackContext);
  if (!ctx) throw new Error('useTrack must be inside TrackProvider');
  return ctx;
}
