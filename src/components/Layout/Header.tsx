import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth, ROLE_ICONS } from '../../services/auth';
import { usePageVisibility } from '../../services/pageVisibility';

const ChevronDown = () => (
  <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

export default function Header() {
  const location = useLocation();
  const { user, isOwner, isModerator, logout } = useAuth();
  const { getVisiblePages } = usePageVisibility();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const role = user?.role ?? 'user';
  const mainPages = getVisiblePages('main', role);
  const competitionPages = getVisiblePages('competitions', role);
  const otherPages = getVisiblePages('other', role);
  const adminPages = (isOwner || isModerator) ? getVisiblePages('admin', role) : [];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };
  const isGroupActive = (paths: string[]) => paths.some(p => isActive(p));

  const openDd = useCallback((id: string) => {
    if (dropdownTimerRef.current) { clearTimeout(dropdownTimerRef.current); dropdownTimerRef.current = null; }
    setOpenDropdown(id);
  }, []);
  const closeDd = useCallback(() => {
    dropdownTimerRef.current = setTimeout(() => setOpenDropdown(null), 200);
  }, []);
  const toggleDd = useCallback((id: string) => {
    setOpenDropdown(prev => prev === id ? null : id);
  }, []);

  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dropdown]')) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [openDropdown]);

  useEffect(() => { setOpenDropdown(null); }, [location.pathname]);

  function Dropdown({ id, label, items, align = 'left' }: {
    id: string; label: string; items: { label: string; path: string }[]; align?: 'left' | 'right';
  }) {
    if (items.length === 0) return null;
    const active = isGroupActive(items.map(i => i.path));
    return (
      <div data-dropdown className="relative" onMouseEnter={() => openDd(id)} onMouseLeave={closeDd}>
        <button
          onClick={() => toggleDd(id)}
          className={`flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            active ? 'text-white bg-primary-600' : 'text-dark-300 hover:text-white hover:bg-dark-800'
          }`}
        >
          {label}
          <ChevronDown />
        </button>
        {openDropdown === id && (
          <div className={`absolute top-full ${align === 'right' ? 'right-0' : 'left-0'} mt-1 w-52 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50`}>
            {items.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className={`block px-4 py-2 text-sm transition-colors ${
                  isActive(item.path) ? 'text-primary-400 bg-primary-500/10' : 'text-dark-300 hover:text-white hover:bg-dark-800'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <header className="bg-dark-900/80 backdrop-blur-md border-b border-dark-800 sticky top-0 z-[100]">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8">
        <div className="flex items-center h-12 gap-1 overflow-x-auto scrollbar-none">
          {/* Nav items — always visible, scrollable on small screens */}
          <nav className="flex items-center gap-0.5 flex-shrink-0">
            {mainPages.map(page => (
              <Link
                key={page.id}
                to={page.path}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  isActive(page.path) ? 'text-white bg-primary-600' : 'text-dark-300 hover:text-white hover:bg-dark-800'
                }`}
              >
                {page.label}
              </Link>
            ))}

            {competitionPages.length > 0 && (
              <Dropdown id="comp" label="Змагання" items={competitionPages.map(p => ({ label: p.label, path: p.path }))} />
            )}
            {otherPages.length > 0 && (
              <Dropdown id="other" label="Інше" items={otherPages.map(p => ({ label: p.label, path: p.path }))} />
            )}
            {adminPages.length > 0 && (
              <Dropdown id="admin" label="Адмін" items={adminPages.map(p => ({ label: p.label, path: p.path }))} />
            )}
          </nav>

          <div className="flex-1" />

          {/* Auth — always visible */}
          <div className="flex items-center flex-shrink-0">
            {user ? (
              <div data-dropdown className="relative" onMouseEnter={() => openDd('user')} onMouseLeave={closeDd}>
                <button
                  onClick={() => toggleDd('user')}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-dark-300 hover:text-white hover:bg-dark-800 transition-colors whitespace-nowrap"
                >
                  {user.photo ? (
                    <img src={user.photo} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <span>{ROLE_ICONS[user.role]}</span>
                  )}
                  <span className="max-w-[80px] truncate hidden sm:inline">{user.name}</span>
                </button>
                {openDropdown === 'user' && (
                  <div className="absolute top-full right-0 mt-1 w-44 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50">
                    <Link to="/login" className="block px-4 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
                      Профіль
                    </Link>
                    <button
                      onClick={logout}
                      className="block w-full text-left px-4 py-2 text-sm text-dark-300 hover:text-red-400 hover:bg-dark-800 transition-colors"
                    >
                      Вийти
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link to="/login" className="px-2 py-1.5 rounded-lg text-xs text-dark-400 hover:text-white whitespace-nowrap">
                Вхід
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
