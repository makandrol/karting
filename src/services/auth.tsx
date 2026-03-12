import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

// ============================================================
// Types
// ============================================================

export type UserRole = 'owner' | 'moderator' | 'user';

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Власник',
  moderator: 'Модератор',
  user: 'Користувач',
};

export const ROLE_ICONS: Record<UserRole, string> = {
  owner: '👑',
  moderator: '🛡️',
  user: '👤',
};

export interface User {
  id: string;
  name: string;
  login: string;
  role: UserRole;
}

export interface ModeratorEntry {
  id: string;
  name: string;
  login: string;
  password: string;
  permissions: ModeratorPermission[];
}

export type ModeratorPermission =
  | 'change_track'
  | 'manage_results'
  | 'manage_videos'
  | 'manage_karts';

export const ALL_PERMISSIONS: { key: ModeratorPermission; label: string }[] = [
  { key: 'change_track', label: 'Зміна конфігурації траси' },
  { key: 'manage_results', label: 'Управління результатами' },
  { key: 'manage_videos', label: 'Управління відео' },
  { key: 'manage_karts', label: 'Управління картами' },
];

// ============================================================
// Власник (Owner) — хардкод
// ============================================================

const OWNER_LOGIN = 'admin';
const OWNER_PASSWORD = 'zhaga2026';
const OWNER_USER: User = {
  id: 'owner',
  name: 'Власник',
  login: OWNER_LOGIN,
  role: 'owner',
};

// ============================================================
// LocalStorage keys
// ============================================================

const LS_CURRENT_USER = 'karting_current_user_v2';
const LS_MODERATORS = 'karting_moderators_v2';

// ============================================================
// Context
// ============================================================

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isOwner: boolean;
  /** Owner або Moderator */
  isModerator: boolean;
  /** Повертає true якщо поточний юзер має цей дозвіл */
  hasPermission: (perm: ModeratorPermission) => boolean;
  /** Єдиний метод логіну — login + password, система сама визначає роль */
  login: (login: string, password: string) => { success: boolean; error?: string };
  logout: () => void;
  /** Список модераторів (видимий тільки для owner) */
  moderators: ModeratorEntry[];
  addModerator: (name: string, login: string, password: string, permissions: ModeratorPermission[]) => string | null;
  removeModerator: (id: string) => void;
  updateModerator: (id: string, updates: Partial<Pick<ModeratorEntry, 'name' | 'password' | 'permissions'>>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [moderators, setModerators] = useState<ModeratorEntry[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem(LS_CURRENT_USER);
      if (savedUser) setUser(JSON.parse(savedUser));
      const savedMods = localStorage.getItem(LS_MODERATORS);
      if (savedMods) setModerators(JSON.parse(savedMods));
    } catch { /* ignore */ }
  }, []);

  // Persist moderators
  useEffect(() => {
    localStorage.setItem(LS_MODERATORS, JSON.stringify(moderators));
  }, [moderators]);

  const persistUser = useCallback((u: User | null) => {
    setUser(u);
    if (u) {
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(u));
    } else {
      localStorage.removeItem(LS_CURRENT_USER);
    }
  }, []);

  const login = useCallback((loginStr: string, password: string): { success: boolean; error?: string } => {
    const trimLogin = loginStr.trim().toLowerCase();

    // 1. Перевірити Власника
    if (trimLogin === OWNER_LOGIN && password === OWNER_PASSWORD) {
      persistUser(OWNER_USER);
      return { success: true };
    }

    // 2. Перевірити модераторів
    const mod = moderators.find((m) => m.login.toLowerCase() === trimLogin);
    if (mod) {
      if (mod.password === password) {
        persistUser({
          id: mod.id,
          name: mod.name,
          login: mod.login,
          role: 'moderator',
        });
        return { success: true };
      }
      return { success: false, error: 'Невірний пароль' };
    }

    // 3. Не знайдено
    return { success: false, error: 'Користувача з таким логіном не знайдено' };
  }, [moderators, persistUser]);

  const logout = useCallback(() => {
    persistUser(null);
  }, [persistUser]);

  const hasPermission = useCallback((perm: ModeratorPermission): boolean => {
    if (!user) return false;
    if (user.role === 'owner') return true;
    if (user.role === 'moderator') {
      const mod = moderators.find((m) => m.id === user.id);
      return mod?.permissions.includes(perm) ?? false;
    }
    return false;
  }, [user, moderators]);

  const addModerator = useCallback((
    name: string, loginStr: string, password: string, permissions: ModeratorPermission[]
  ): string | null => {
    const trimLogin = loginStr.trim().toLowerCase();

    // Перевірити унікальність логіну
    if (trimLogin === OWNER_LOGIN) return 'Цей логін зарезервовано';
    if (moderators.some((m) => m.login.toLowerCase() === trimLogin)) {
      return 'Модератор з таким логіном вже існує';
    }

    const id = `mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setModerators((prev) => [...prev, { id, name, login: trimLogin, password, permissions }]);
    return null; // success
  }, [moderators]);

  const removeModerator = useCallback((id: string) => {
    setModerators((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const updateModerator = useCallback((
    id: string,
    updates: Partial<Pick<ModeratorEntry, 'name' | 'password' | 'permissions'>>
  ) => {
    setModerators((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
    );
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    isOwner: user?.role === 'owner',
    isModerator: user?.role === 'owner' || user?.role === 'moderator',
    hasPermission,
    login,
    logout,
    moderators,
    addModerator,
    removeModerator,
    updateModerator,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
