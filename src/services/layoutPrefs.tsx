import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from './auth';
import { COLLECTOR_URL } from './config';

export interface SectionPref {
  id: string;
  visible: boolean;
}

export type PageLayout = SectionPref[];

interface PageLayoutWithVersion {
  sections: SectionPref[];
  basedOnVersion: number;
}

interface ServerDefaults {
  [pageId: string]: { sections: SectionPref[]; version: number };
}

interface LocalOverrides {
  [pageId: string]: PageLayoutWithVersion;
}

export const PAGE_SECTIONS: Record<string, { id: string; label: string }[]> = {
  timing: [
    { id: 'replay', label: 'Плеєр' },
    { id: 'timingTable', label: 'Таймінг' },
    { id: 'track', label: 'Трек' },
    { id: 'lapsByPilots', label: 'Всі кола' },
    { id: 'history', label: 'Історія' },
  ],
  sessionDetail: [
    { id: 'replay', label: 'Плеєр' },
    { id: 'timingTable', label: 'Таймінг' },
    { id: 'track', label: 'Трек' },
    { id: 'lapsByPilots', label: 'Всі кола' },
  ],
  competition: [
    { id: 'timeline', label: 'Таймлайн' },
    { id: 'liveSession', label: 'Заїзд' },
    { id: 'leaguePoints', label: 'Результати' },
    { id: 'kartManager', label: 'Стартові карти' },
    { id: 'sessions', label: 'Список заїздів' },
  ],
};

const HARDCODED_DEFAULTS: ServerDefaults = {
  timing: { sections: [{ id: 'replay', visible: true }, { id: 'timingTable', visible: true }, { id: 'track', visible: true }, { id: 'lapsByPilots', visible: true }, { id: 'history', visible: true }], version: 0 },
  sessionDetail: { sections: [{ id: 'replay', visible: true }, { id: 'timingTable', visible: true }, { id: 'track', visible: true }, { id: 'lapsByPilots', visible: true }], version: 0 },
  competition: { sections: [{ id: 'timeline', visible: true }, { id: 'liveSession', visible: true }, { id: 'leaguePoints', visible: true }, { id: 'kartManager', visible: false }, { id: 'sessions', visible: false }, { id: 'editLog', visible: true }], version: 3 },
};

function getStorageKey(email: string | null): string {
  return email ? `karting_layout_prefs_${email}` : 'karting_layout_prefs_anon';
}

function loadLocal(email: string | null): LocalOverrides {
  try {
    const raw = localStorage.getItem(getStorageKey(email));
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveLocal(email: string | null, data: LocalOverrides) {
  localStorage.setItem(getStorageKey(email), JSON.stringify(data));
}

function migrateOldPrefs(email: string | null): LocalOverrides | null {
  const oldKey = email ? `karting_view_prefs_${email}` : 'karting_view_prefs_anon';
  const migratedKey = `${oldKey}_migrated_layout`;
  try {
    if (localStorage.getItem(migratedKey)) return null;
    const raw = localStorage.getItem(oldKey);
    if (!raw) return null;
    const old = JSON.parse(raw);
    const overrides: LocalOverrides = {};
    const hasTimingCustom = old.showTrack === false || old.showLapsByPilots === false;
    if (hasTimingCustom) {
      overrides.timing = {
        sections: [
          { id: 'replay', visible: true },
          { id: 'timingTable', visible: true },
          { id: 'track', visible: old.showTrack !== false },
          { id: 'lapsByPilots', visible: old.showLapsByPilots !== false },
          { id: 'history', visible: true },
        ],
        basedOnVersion: 0,
      };
      overrides.sessionDetail = {
        sections: [
          { id: 'replay', visible: true },
          { id: 'timingTable', visible: true },
          { id: 'track', visible: old.showTrack !== false },
          { id: 'lapsByPilots', visible: old.showLapsByPilots !== false },
        ],
        basedOnVersion: 0,
      };
    }
    if (old.showLeaguePoints === false) {
      overrides.competition = {
        sections: [
          { id: 'leaguePoints', visible: false },
          { id: 'liveSession', visible: true },
        ],
        basedOnVersion: 0,
      };
    }
    localStorage.setItem(migratedKey, '1');
    return Object.keys(overrides).length > 0 ? overrides : null;
  } catch {
    return null;
  }
}

function ensureAllSections(layout: SectionPref[], pageId: string): SectionPref[] {
  const known = PAGE_SECTIONS[pageId];
  if (!known) return layout;
  const existingIds = new Set(layout.map(s => s.id));
  const result = [...layout];
  for (const s of known) {
    if (!existingIds.has(s.id)) {
      result.push({ id: s.id, visible: true });
    }
  }
  return result;
}

function mergeDefaults(serverDefaults: ServerDefaults, local: LocalOverrides): Record<string, PageLayout> {
  const result: Record<string, PageLayout> = {};
  const allPageIds = new Set([...Object.keys(serverDefaults), ...Object.keys(HARDCODED_DEFAULTS), ...Object.keys(local)]);
  for (const pageId of allPageIds) {
    const server = serverDefaults[pageId] || HARDCODED_DEFAULTS[pageId];
    const userOverride = local[pageId];
    if (!server) {
      if (userOverride) result[pageId] = ensureAllSections(userOverride.sections, pageId);
      continue;
    }
    if (!userOverride || userOverride.basedOnVersion < server.version) {
      result[pageId] = ensureAllSections(server.sections, pageId);
    } else {
      result[pageId] = ensureAllSections(userOverride.sections, pageId);
    }
  }
  return result;
}

interface LayoutContextValue {
  layouts: Record<string, PageLayout>;
  getPageLayout: (pageId: string) => PageLayout;
  isSectionVisible: (pageId: string, sectionId: string) => boolean;
  toggleSection: (pageId: string, sectionId: string) => void;
  reorderSections: (pageId: string, fromIdx: number, toIdx: number) => void;
  resetPage: (pageId: string) => void;
  serverDefaults: ServerDefaults;
  saveServerDefaults: (defaults: ServerDefaults) => Promise<void>;
  refreshServerDefaults: () => Promise<void>;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutPrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const email = user?.email ?? null;
  const [serverDefaults, setServerDefaults] = useState<ServerDefaults>({});
  const [localOverrides, setLocalOverrides] = useState<LocalOverrides>(() => loadLocal(email));
  const [layouts, setLayouts] = useState<Record<string, PageLayout>>(() => mergeDefaults({}, loadLocal(email)));

  const fetchDefaults = useCallback(async () => {
    try {
      const res = await fetch(`${COLLECTOR_URL}/view-defaults`);
      if (res.ok) {
        const data = await res.json();
        setServerDefaults(data);
        return data as ServerDefaults;
      }
    } catch {}
    return {} as ServerDefaults;
  }, []);

  useEffect(() => {
    const local = loadLocal(email);
    const migrated = migrateOldPrefs(email);
    const merged = migrated ? { ...local, ...migrated } : local;
    if (migrated) saveLocal(email, merged);
    setLocalOverrides(merged);
    fetchDefaults().then(sd => {
      setLayouts(mergeDefaults(sd, merged));
    });
  }, [email, fetchDefaults]);

  useEffect(() => {
    setLayouts(mergeDefaults(serverDefaults, localOverrides));
  }, [serverDefaults, localOverrides]);

  const getPageLayout = useCallback((pageId: string): PageLayout => {
    return layouts[pageId] || HARDCODED_DEFAULTS[pageId]?.sections || [];
  }, [layouts]);

  const isSectionVisible = useCallback((pageId: string, sectionId: string): boolean => {
    const layout = layouts[pageId] || HARDCODED_DEFAULTS[pageId]?.sections || [];
    const section = layout.find(s => s.id === sectionId);
    return section?.visible ?? true;
  }, [layouts]);

  const updateLocal = useCallback((pageId: string, sections: SectionPref[]) => {
    const server = serverDefaults[pageId] || HARDCODED_DEFAULTS[pageId];
    const version = server?.version ?? 0;
    setLocalOverrides(prev => {
      const next = { ...prev, [pageId]: { sections, basedOnVersion: version } };
      saveLocal(email, next);
      return next;
    });
  }, [email, serverDefaults]);

  const toggleSection = useCallback((pageId: string, sectionId: string) => {
    const current = layouts[pageId] || HARDCODED_DEFAULTS[pageId]?.sections || [];
    const updated = current.map(s => s.id === sectionId ? { ...s, visible: !s.visible } : s);
    updateLocal(pageId, updated);
  }, [layouts, updateLocal]);

  const reorderSections = useCallback((pageId: string, fromIdx: number, toIdx: number) => {
    const current = [...(layouts[pageId] || HARDCODED_DEFAULTS[pageId]?.sections || [])];
    const [moved] = current.splice(fromIdx, 1);
    current.splice(toIdx, 0, moved);
    updateLocal(pageId, current);
  }, [layouts, updateLocal]);

  const resetPage = useCallback((pageId: string) => {
    setLocalOverrides(prev => {
      const next = { ...prev };
      delete next[pageId];
      saveLocal(email, next);
      return next;
    });
  }, [email]);

  const saveServerDefaults = useCallback(async (defaults: ServerDefaults) => {
    const token = import.meta.env.VITE_ADMIN_TOKEN || '';
    const res = await fetch(`${COLLECTOR_URL}/view-defaults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(defaults),
    });
    if (res.ok) setServerDefaults(defaults);
  }, []);

  const refreshServerDefaults = useCallback(async () => {
    const sd = await fetchDefaults();
    setLayouts(mergeDefaults(sd, localOverrides));
  }, [fetchDefaults, localOverrides]);

  const value: LayoutContextValue = {
    layouts,
    getPageLayout,
    isSectionVisible,
    toggleSection,
    reorderSections,
    resetPage,
    serverDefaults,
    saveServerDefaults,
    refreshServerDefaults,
  };

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayoutPrefs() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayoutPrefs must be used within LayoutPrefsProvider');
  return ctx;
}
