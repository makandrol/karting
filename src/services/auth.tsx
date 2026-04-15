import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, hasConfig, type FirebaseUser } from './firebase';
import { COLLECTOR_URL } from './config';

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

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  photo: string | null;
  role: UserRole;
}

export interface ModeratorEntry {
  email: string;
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
// Власник — по email
// ============================================================

const OWNER_EMAIL = 'makandrol@gmail.com';

// ============================================================
// LocalStorage
// ============================================================

const LS_MODERATORS = 'karting_moderators_v3';

// ============================================================
// Context
// ============================================================

interface AuthContextValue {
  user: AppUser | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  isAuthenticated: boolean;
  isOwner: boolean;
  isModerator: boolean;
  hasPermission: (perm: ModeratorPermission) => boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  moderators: ModeratorEntry[];
  addModerator: (email: string, permissions: ModeratorPermission[]) => string | null;
  removeModerator: (email: string) => void;
  updateModerator: (email: string, permissions: ModeratorPermission[]) => void;
  /** true якщо Firebase налаштовано */
  firebaseConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================
// Helper — визначити роль по email
// ============================================================

function determineRole(email: string, moderators: ModeratorEntry[]): UserRole {
  if (email.toLowerCase() === OWNER_EMAIL) return 'owner';
  if (moderators.some((m) => m.email.toLowerCase() === email.toLowerCase())) return 'moderator';
  return 'user';
}

// ============================================================
// Localhost auto-owner (для розробки)
// ============================================================

const IS_LOCALHOST = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
);

const LOCALHOST_OWNER: AppUser = {
  uid: 'localhost-owner',
  email: OWNER_EMAIL,
  name: 'Owner (localhost)',
  photo: null,
  role: 'owner',
};

// ============================================================
// Provider
// ============================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [moderators, setModerators] = useState<ModeratorEntry[]>([]);
  const [localhostLoggedOut, setLocalhostLoggedOut] = useState(false);
  const savingRef = useRef(false);

  // Load moderators from server (with localStorage cache for instant display)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_MODERATORS);
      if (saved) setModerators(JSON.parse(saved));
    } catch {}
    fetch(`${COLLECTOR_URL}/moderators`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setModerators(data);
          localStorage.setItem(LS_MODERATORS, JSON.stringify(data));
        }
      })
      .catch(() => {});
  }, []);

  const saveModsToServer = useCallback((mods: ModeratorEntry[]) => {
    localStorage.setItem(LS_MODERATORS, JSON.stringify(mods));
    if (savingRef.current) return;
    savingRef.current = true;
    const token = import.meta.env.VITE_ADMIN_TOKEN || '';
    fetch(`${COLLECTOR_URL}/moderators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(mods),
    }).catch(() => {}).finally(() => { savingRef.current = false; });
  }, []);

  // Listen to Firebase auth state
  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Build AppUser: localhost → auto owner, otherwise from Firebase
  const user: AppUser | null = (IS_LOCALHOST && !localhostLoggedOut)
    ? LOCALHOST_OWNER
    : firebaseUser && firebaseUser.email ? {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
    photo: firebaseUser.photoURL,
    role: determineRole(firebaseUser.email, moderators),
  } : null;

  const loginWithGoogle = useCallback(async () => {
    if (IS_LOCALHOST) { setLocalhostLoggedOut(false); return; }
    if (!auth || !googleProvider) return;
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Google login failed:', err);
    }
  }, []);

  const logout = useCallback(async () => {
    if (IS_LOCALHOST) { setLocalhostLoggedOut(true); return; }
    if (!auth) return;
    await signOut(auth);
  }, []);

  const hasPermission = useCallback((perm: ModeratorPermission): boolean => {
    if (!user) return false;
    if (user.role === 'owner') return true;
    if (user.role === 'moderator') {
      const mod = moderators.find((m) => m.email.toLowerCase() === user.email.toLowerCase());
      return mod?.permissions.includes(perm) ?? false;
    }
    return false;
  }, [user, moderators]);

  const addModerator = useCallback((email: string, permissions: ModeratorPermission[]): string | null => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed === OWNER_EMAIL) return 'Це email власника';
    if (moderators.some((m) => m.email.toLowerCase() === trimmed)) return 'Цей email вже доданий';
    const next = [...moderators, { email: trimmed, permissions }];
    setModerators(next);
    saveModsToServer(next);
    return null;
  }, [moderators, saveModsToServer]);

  const removeModerator = useCallback((email: string) => {
    setModerators((prev) => {
      const next = prev.filter((m) => m.email.toLowerCase() !== email.toLowerCase());
      saveModsToServer(next);
      return next;
    });
  }, [saveModsToServer]);

  const updateModerator = useCallback((email: string, permissions: ModeratorPermission[]) => {
    setModerators((prev) => {
      const next = prev.map((m) => m.email.toLowerCase() === email.toLowerCase() ? { ...m, permissions } : m);
      saveModsToServer(next);
      return next;
    });
  }, [saveModsToServer]);

  const value: AuthContextValue = {
    user,
    firebaseUser,
    loading,
    isAuthenticated: !!user,
    isOwner: user?.role === 'owner',
    isModerator: user?.role === 'owner' || user?.role === 'moderator',
    hasPermission,
    loginWithGoogle,
    logout,
    moderators,
    addModerator,
    removeModerator,
    updateModerator,
    firebaseConfigured: hasConfig,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
