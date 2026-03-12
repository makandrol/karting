import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

// ============================================================
// Types
// ============================================================

export type UserRole = 'super_admin' | 'admin' | 'user';

export interface User {
  id: string;
  name: string;
  role: UserRole;
}

export interface AdminEntry {
  id: string;
  name: string;
  role: 'admin';
  permissions: AdminPermission[];
}

export type AdminPermission =
  | 'change_track'
  | 'manage_results'
  | 'manage_videos'
  | 'manage_karts';

export const ALL_PERMISSIONS: { key: AdminPermission; label: string }[] = [
  { key: 'change_track', label: 'Зміна конфігурації траси' },
  { key: 'manage_results', label: 'Управління результатами' },
  { key: 'manage_videos', label: 'Управління відео' },
  { key: 'manage_karts', label: 'Управління картами' },
];

// ============================================================
// Хардкод super_admin (ти)
// ============================================================

const SUPER_ADMIN_PASSWORD = 'zhaga2025';
const SUPER_ADMIN: User = {
  id: 'super_admin',
  name: 'Адміністратор',
  role: 'super_admin',
};

// ============================================================
// LocalStorage keys
// ============================================================

const LS_CURRENT_USER = 'karting_current_user';
const LS_ADMINS = 'karting_admins';

// ============================================================
// Context
// ============================================================

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  /** Повертає true якщо поточний юзер має цей дозвіл */
  hasPermission: (perm: AdminPermission) => boolean;
  /** Логін як super_admin по паролю */
  loginSuperAdmin: (password: string) => boolean;
  /** Логін як admin по імені */
  loginAdmin: (name: string) => boolean;
  logout: () => void;
  /** Список адмінів (видимий тільки для super_admin) */
  admins: AdminEntry[];
  addAdmin: (name: string, permissions: AdminPermission[]) => void;
  removeAdmin: (id: string) => void;
  updateAdminPermissions: (id: string, permissions: AdminPermission[]) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [admins, setAdmins] = useState<AdminEntry[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem(LS_CURRENT_USER);
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      }
      const savedAdmins = localStorage.getItem(LS_ADMINS);
      if (savedAdmins) {
        setAdmins(JSON.parse(savedAdmins));
      }
    } catch {
      // ignore
    }
  }, []);

  // Persist admins
  useEffect(() => {
    localStorage.setItem(LS_ADMINS, JSON.stringify(admins));
  }, [admins]);

  const persistUser = useCallback((u: User | null) => {
    setUser(u);
    if (u) {
      localStorage.setItem(LS_CURRENT_USER, JSON.stringify(u));
    } else {
      localStorage.removeItem(LS_CURRENT_USER);
    }
  }, []);

  const loginSuperAdmin = useCallback((password: string): boolean => {
    if (password === SUPER_ADMIN_PASSWORD) {
      persistUser(SUPER_ADMIN);
      return true;
    }
    return false;
  }, [persistUser]);

  const loginAdmin = useCallback((name: string): boolean => {
    const admin = admins.find(
      (a) => a.name.toLowerCase() === name.toLowerCase()
    );
    if (admin) {
      persistUser({
        id: admin.id,
        name: admin.name,
        role: 'admin',
      });
      return true;
    }
    return false;
  }, [admins, persistUser]);

  const logout = useCallback(() => {
    persistUser(null);
  }, [persistUser]);

  const hasPermission = useCallback((perm: AdminPermission): boolean => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    if (user.role === 'admin') {
      const admin = admins.find((a) => a.id === user.id);
      return admin?.permissions.includes(perm) ?? false;
    }
    return false;
  }, [user, admins]);

  const addAdmin = useCallback((name: string, permissions: AdminPermission[]) => {
    const id = `admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setAdmins((prev) => [...prev, { id, name, role: 'admin', permissions }]);
  }, []);

  const removeAdmin = useCallback((id: string) => {
    setAdmins((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const updateAdminPermissions = useCallback((id: string, permissions: AdminPermission[]) => {
    setAdmins((prev) =>
      prev.map((a) => (a.id === id ? { ...a, permissions } : a))
    );
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    isSuperAdmin: user?.role === 'super_admin',
    isAdmin: user?.role === 'super_admin' || user?.role === 'admin',
    hasPermission,
    loginSuperAdmin,
    loginAdmin,
    logout,
    admins,
    addAdmin,
    removeAdmin,
    updateAdminPermissions,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
