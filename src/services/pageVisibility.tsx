import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

/**
 * All pages that can be toggled on/off by the owner.
 * 'always' pages are never hidden (Таймінг, Login).
 */

export interface PageConfig {
  id: string;
  label: string;
  path: string;
  group: 'main' | 'competitions' | 'other' | 'admin';
  /** If true, page is always visible and cannot be disabled */
  always?: boolean;
  /** If true, only owner/moderator can see this page */
  adminOnly?: boolean;
}

export const ALL_PAGES: PageConfig[] = [
  // Main (shown as top-level nav items)
  { id: 'timing', label: 'Таймінг', path: '/', group: 'main', always: true },
  { id: 'onboard', label: 'Onboard', path: '/onboard', group: 'main' },
  { id: 'sessions', label: 'Заїзди', path: '/sessions', group: 'main' },
  { id: 'karts', label: 'Карти', path: '/info/karts', group: 'main' },

  // Competitions (single page with filters)
  { id: 'results', label: 'Змагання', path: '/results', group: 'main' },

  // Other (shown in "Інше" dropdown)
  { id: 'tracks', label: 'Траси', path: '/info/tracks', group: 'other' },
  { id: 'videos', label: 'Відео', path: '/info/videos', group: 'other' },
  { id: 'home', label: 'Головна', path: '/home', group: 'other' },
  { id: 'changelog', label: 'Changelog', path: '/changelog', group: 'other' },

  // Admin (shown in "Адмін" dropdown, adminOnly)
  { id: 'admin-pages', label: 'Сторінки', path: '/admin/pages', group: 'admin', adminOnly: true },
  { id: 'admin-moderators', label: 'Модератори', path: '/admin', group: 'admin', adminOnly: true },
  { id: 'admin-db', label: 'База даних', path: '/admin/db', group: 'admin', adminOnly: true },
  { id: 'admin-monitoring', label: 'Моніторинг', path: '/admin/monitoring', group: 'admin', adminOnly: true },
  { id: 'admin-collector-log', label: 'Лог колектора', path: '/admin/collector-log', group: 'admin', adminOnly: true },
  { id: 'admin-competitions', label: 'Змагання', path: '/admin/competitions', group: 'admin', adminOnly: true },
  { id: 'admin-scoring', label: 'Бали', path: '/admin/scoring', group: 'admin', adminOnly: true },
];

const LS_KEY = 'karting_page_visibility_v1';

interface PageVisibilityState {
  /** Set of page IDs that are enabled for regular users */
  userPages: Set<string>;
  /** Set of page IDs that are enabled for admins/moderators */
  adminPages: Set<string>;
}

interface PageVisibilityContextValue {
  /** Check if a page is visible for the current role */
  isPageVisible: (pageId: string, role: 'owner' | 'moderator' | 'user') => boolean;
  /** Get all visible pages for a given group and role */
  getVisiblePages: (group: PageConfig['group'], role: 'owner' | 'moderator' | 'user') => PageConfig[];
  /** Raw state for the settings page */
  state: PageVisibilityState;
  /** Toggle page visibility (owner only) */
  togglePage: (pageId: string, audience: 'user' | 'admin') => void;
}

const defaults: PageVisibilityState = {
  userPages: new Set(ALL_PAGES.filter(p => !p.adminOnly).map(p => p.id)),
  adminPages: new Set(ALL_PAGES.map(p => p.id)),
};

function loadState(): PageVisibilityState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      userPages: new Set(parsed.userPages ?? [...defaults.userPages]),
      adminPages: new Set(parsed.adminPages ?? [...defaults.adminPages]),
    };
  } catch {
    return defaults;
  }
}

function saveState(state: PageVisibilityState) {
  localStorage.setItem(LS_KEY, JSON.stringify({
    userPages: [...state.userPages],
    adminPages: [...state.adminPages],
  }));
}

const PageVisibilityContext = createContext<PageVisibilityContextValue | null>(null);

export function PageVisibilityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageVisibilityState>(loadState);

  useEffect(() => { saveState(state); }, [state]);

  const isPageVisible = (pageId: string, role: 'owner' | 'moderator' | 'user'): boolean => {
    const page = ALL_PAGES.find(p => p.id === pageId);
    if (!page) return false;
    if (page.always) return true;
    if (role === 'owner') return true;
    if (role === 'moderator') return state.adminPages.has(pageId);
    return state.userPages.has(pageId);
  };

  const getVisiblePages = (group: PageConfig['group'], role: 'owner' | 'moderator' | 'user'): PageConfig[] => {
    return ALL_PAGES
      .filter(p => p.group === group)
      .filter(p => isPageVisible(p.id, role));
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

  return (
    <PageVisibilityContext.Provider value={{ isPageVisible, getVisiblePages, state, togglePage }}>
      {children}
    </PageVisibilityContext.Provider>
  );
}

export function usePageVisibility(): PageVisibilityContextValue {
  const ctx = useContext(PageVisibilityContext);
  if (!ctx) throw new Error('usePageVisibility must be inside PageVisibilityProvider');
  return ctx;
}
