import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { COLLECTOR_URL } from './config';

export interface PageConfig {
  id: string;
  label: string;
  path: string;
  group: 'main' | 'other' | 'admin';
  /** If true, page is always visible and cannot be disabled */
  always?: boolean;
  /** If true, only owner/moderator can see this page */
  adminOnly?: boolean;
}

export const ALL_PAGES: PageConfig[] = [
  { id: 'timing', label: 'Таймінг', path: '/', group: 'main', always: true },
  { id: 'onboard', label: 'Onboard', path: '/onboard', group: 'main' },
  { id: 'sessions', label: 'Заїзди', path: '/sessions', group: 'main' },
  { id: 'karts', label: 'Карти', path: '/info/karts', group: 'main' },
  { id: 'results', label: 'Змагання', path: '/results', group: 'main' },

  { id: 'tracks', label: 'Траси', path: '/info/tracks', group: 'other' },
  { id: 'videos', label: 'Відео', path: '/info/videos', group: 'other' },
  { id: 'home', label: 'Головна', path: '/home', group: 'other' },
  { id: 'changelog', label: 'Changelog', path: '/changelog', group: 'other' },

  { id: 'admin-access', label: 'Доступи', path: '/admin/access', group: 'admin', adminOnly: true },
  { id: 'admin-db', label: 'База даних', path: '/admin/db', group: 'admin', adminOnly: true },
  { id: 'admin-monitoring', label: 'Моніторинг', path: '/admin/monitoring', group: 'admin', adminOnly: true },
  { id: 'admin-collector-log', label: 'Лог колектора', path: '/admin/collector-log', group: 'admin', adminOnly: true },
  { id: 'admin-scoring', label: 'Бали', path: '/admin/scoring', group: 'admin', adminOnly: true },
];

const LS_KEY = 'karting_page_visibility_v2';

export interface PageVisibilityState {
  userPages: Set<string>;
  adminPages: Set<string>;
  /** Per-account page overrides: email → set of allowed page ids */
  accountOverrides: Map<string, Set<string>>;
}

interface PageVisibilityContextValue {
  isPageVisible: (pageId: string, role: 'owner' | 'moderator' | 'user', email?: string) => boolean;
  isPathAccessible: (path: string, role: 'owner' | 'moderator' | 'user', email?: string) => boolean;
  getVisiblePages: (group: PageConfig['group'], role: 'owner' | 'moderator' | 'user', email?: string) => PageConfig[];
  state: PageVisibilityState;
  togglePage: (pageId: string, audience: 'user' | 'admin') => void;
  setAccountOverrides: (overrides: Map<string, Set<string>>) => void;
  loaded: boolean;
}

const defaults: PageVisibilityState = {
  userPages: new Set(ALL_PAGES.filter(p => !p.adminOnly).map(p => p.id)),
  adminPages: new Set(ALL_PAGES.map(p => p.id)),
  accountOverrides: new Map(),
};

interface SerializedState {
  userPages: string[];
  adminPages: string[];
  accountOverrides: Record<string, string[]>;
}

function serializeState(state: PageVisibilityState): SerializedState {
  const overrides: Record<string, string[]> = {};
  for (const [email, pages] of state.accountOverrides) {
    overrides[email] = [...pages];
  }
  return {
    userPages: [...state.userPages],
    adminPages: [...state.adminPages],
    accountOverrides: overrides,
  };
}

const VALID_IDS = new Set(ALL_PAGES.map(p => p.id));
const ALWAYS_IDS = ALL_PAGES.filter(p => p.always).map(p => p.id);

function deserializeState(parsed: SerializedState): PageVisibilityState {
  const overrides = new Map<string, Set<string>>();
  if (parsed.accountOverrides) {
    for (const [email, pages] of Object.entries(parsed.accountOverrides)) {
      overrides.set(email, new Set((pages as string[]).filter(id => VALID_IDS.has(id))));
    }
  }
  const filterValid = (ids: string[] | undefined, fallback: Set<string>) => {
    if (!ids) return new Set(fallback);
    const filtered = ids.filter(id => VALID_IDS.has(id));
    ALWAYS_IDS.forEach(id => { if (!filtered.includes(id)) filtered.push(id); });
    return new Set(filtered);
  };
  return {
    userPages: filterValid(parsed.userPages, defaults.userPages),
    adminPages: filterValid(parsed.adminPages, defaults.adminPages),
    accountOverrides: overrides,
  };
}

function loadLocalCache(): PageVisibilityState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return deserializeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveLocalCache(state: PageVisibilityState) {
  localStorage.setItem(LS_KEY, JSON.stringify(serializeState(state)));
}

function findPageByPath(path: string): PageConfig | undefined {
  return ALL_PAGES.find(p => {
    if (p.path === '/') return path === '/';
    return path === p.path || path.startsWith(p.path + '/');
  });
}

const PageVisibilityContext = createContext<PageVisibilityContextValue | null>(null);

export function PageVisibilityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageVisibilityState>(() => loadLocalCache() || defaults);
  const [loaded, setLoaded] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${COLLECTOR_URL}/page-visibility`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data && data.userPages) {
          const serverState = deserializeState(data);
          setState(serverState);
          saveLocalCache(serverState);
        }
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const saveToServer = useCallback(async (newState: PageVisibilityState) => {
    saveLocalCache(newState);
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const token = import.meta.env.VITE_ADMIN_TOKEN || '';
      await fetch(`${COLLECTOR_URL}/page-visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(serializeState(newState)),
      });
    } catch {}
    savingRef.current = false;
  }, []);

  const isPageVisible = (pageId: string, role: 'owner' | 'moderator' | 'user', email?: string): boolean => {
    const page = ALL_PAGES.find(p => p.id === pageId);
    if (!page) return false;
    if (page.always) return true;
    if (role === 'owner') return true;

    if (email) {
      const accountPages = state.accountOverrides.get(email.toLowerCase());
      if (accountPages) return accountPages.has(pageId);
    }

    if (role === 'moderator') return state.adminPages.has(pageId);
    return state.userPages.has(pageId);
  };

  const isPathAccessible = (path: string, role: 'owner' | 'moderator' | 'user', email?: string): boolean => {
    const page = findPageByPath(path);
    if (!page) return true;
    return isPageVisible(page.id, role, email);
  };

  const getVisiblePages = (group: PageConfig['group'], role: 'owner' | 'moderator' | 'user', email?: string): PageConfig[] => {
    return ALL_PAGES
      .filter(p => p.group === group)
      .filter(p => isPageVisible(p.id, role, email));
  };

  const togglePage = (pageId: string, audience: 'user' | 'admin') => {
    setState(prev => {
      const set = audience === 'user' ? new Set(prev.userPages) : new Set(prev.adminPages);
      if (set.has(pageId)) set.delete(pageId);
      else set.add(pageId);
      const next = audience === 'user'
        ? { ...prev, userPages: set }
        : { ...prev, adminPages: set };
      saveToServer(next);
      return next;
    });
  };

  const setAccountOverrides = (overrides: Map<string, Set<string>>) => {
    setState(prev => {
      const next = { ...prev, accountOverrides: overrides };
      saveToServer(next);
      return next;
    });
  };

  return (
    <PageVisibilityContext.Provider value={{ isPageVisible, isPathAccessible, getVisiblePages, state, togglePage, setAccountOverrides, loaded }}>
      {children}
    </PageVisibilityContext.Provider>
  );
}

export function usePageVisibility(): PageVisibilityContextValue {
  const ctx = useContext(PageVisibilityContext);
  if (!ctx) throw new Error('usePageVisibility must be inside PageVisibilityProvider');
  return ctx;
}
