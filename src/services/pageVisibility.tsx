import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

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
}

const defaults: PageVisibilityState = {
  userPages: new Set(ALL_PAGES.filter(p => !p.adminOnly).map(p => p.id)),
  adminPages: new Set(ALL_PAGES.map(p => p.id)),
  accountOverrides: new Map(),
};

function loadState(): PageVisibilityState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const oldRaw = localStorage.getItem('karting_page_visibility_v1');
      if (oldRaw) {
        const parsed = JSON.parse(oldRaw);
        return {
          userPages: new Set(parsed.userPages ?? [...defaults.userPages]),
          adminPages: new Set(parsed.adminPages ?? [...defaults.adminPages]),
          accountOverrides: new Map(),
        };
      }
      return defaults;
    }
    const parsed = JSON.parse(raw);
    const overrides = new Map<string, Set<string>>();
    if (parsed.accountOverrides) {
      for (const [email, pages] of Object.entries(parsed.accountOverrides)) {
        overrides.set(email, new Set(pages as string[]));
      }
    }
    return {
      userPages: new Set(parsed.userPages ?? [...defaults.userPages]),
      adminPages: new Set(parsed.adminPages ?? [...defaults.adminPages]),
      accountOverrides: overrides,
    };
  } catch {
    return defaults;
  }
}

function saveState(state: PageVisibilityState) {
  const overrides: Record<string, string[]> = {};
  for (const [email, pages] of state.accountOverrides) {
    overrides[email] = [...pages];
  }
  localStorage.setItem(LS_KEY, JSON.stringify({
    userPages: [...state.userPages],
    adminPages: [...state.adminPages],
    accountOverrides: overrides,
  }));
}

function findPageByPath(path: string): PageConfig | undefined {
  return ALL_PAGES.find(p => {
    if (p.path === '/') return path === '/';
    return path === p.path || path.startsWith(p.path + '/');
  });
}

const PageVisibilityContext = createContext<PageVisibilityContextValue | null>(null);

export function PageVisibilityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageVisibilityState>(loadState);

  useEffect(() => { saveState(state); }, [state]);

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
      return audience === 'user'
        ? { ...prev, userPages: set }
        : { ...prev, adminPages: set };
    });
  };

  const setAccountOverrides = (overrides: Map<string, Set<string>>) => {
    setState(prev => ({ ...prev, accountOverrides: overrides }));
  };

  return (
    <PageVisibilityContext.Provider value={{ isPageVisible, isPathAccessible, getVisiblePages, state, togglePage, setAccountOverrides }}>
      {children}
    </PageVisibilityContext.Provider>
  );
}

export function usePageVisibility(): PageVisibilityContextValue {
  const ctx = useContext(PageVisibilityContext);
  if (!ctx) throw new Error('usePageVisibility must be inside PageVisibilityProvider');
  return ctx;
}
