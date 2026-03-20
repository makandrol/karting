import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth, ROLE_ICONS } from '../../services/auth';

interface NavEntry {
  label: string;
  path: string;
  children?: { label: string; path: string }[];
}

const NAV: NavEntry[] = [
  { label: 'Таймінг', path: '/' },
  { label: 'Заїзди', path: '/sessions' },
  { label: 'Карти', path: '/info/karts' },
  {
    label: 'Змагання',
    path: '/results',
    children: [
      { label: 'Поточне змагання', path: '/results/current' },
      { label: 'Гонзалес', path: '/results/gonzales' },
      { label: 'Лайт Ліга', path: '/results/light-league' },
      { label: 'Ліга Чемпіонів', path: '/results/champions-league' },
      { label: 'Спринти', path: '/results/sprints' },
      { label: 'Марафони', path: '/results/marathons' },
    ],
  },
  {
    label: 'Інше',
    path: '/other',
    children: [
      { label: 'Траси', path: '/info/tracks' },
      { label: 'Відео', path: '/info/videos' },
      { label: 'Головна', path: '/home' },
      { label: 'Changelog', path: '/changelog' },
    ],
  },
];

export default function Header() {
  const location = useLocation();
  const { user, isOwner, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const isActive = (item: NavEntry) => {
    if (item.path === '/') return location.pathname === '/';
    return location.pathname.startsWith(item.path);
  };

  const isChildActive = (path: string) => location.pathname === path;

  return (
    <header className="bg-dark-900/80 backdrop-blur-md border-b border-dark-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV.map((item) =>
              item.children ? (
                <div
                  key={item.path}
                  className="relative"
                  onMouseEnter={() => setOpenDropdown(item.path)}
                  onMouseLeave={() => setOpenDropdown(null)}
                >
                  <button
                    className={`nav-link flex items-center gap-1 ${isActive(item) ? 'text-white bg-primary-600' : ''}`}
                  >
                    {item.label}
                    <svg className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {openDropdown === item.path && (
                    <div className="absolute top-full left-0 mt-1 w-52 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50">
                      {item.children.map((child) => (
                        <Link
                          key={child.path}
                          to={child.path}
                          className={`block px-4 py-2 text-sm transition-colors ${
                            isChildActive(child.path)
                              ? 'text-primary-400 bg-primary-500/10'
                              : 'text-dark-300 hover:text-white hover:bg-dark-800'
                          }`}
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  key={item.path}
                  to={item.path}
                  className={isActive(item) ? 'nav-link-active' : 'nav-link'}
                >
                  {item.label}
                </Link>
              )
            )}
          </nav>

          {/* Auth (desktop) */}
          <div className="hidden md:flex items-center">
            {user ? (
              <div
                className="relative"
                onMouseEnter={() => setOpenDropdown('user')}
                onMouseLeave={() => setOpenDropdown(null)}
              >
                <button className="nav-link flex items-center gap-2">
                  {user.photo ? (
                    <img src={user.photo} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="text-xs">{ROLE_ICONS[user.role]}</span>
                  )}
                  <span className="max-w-[120px] truncate">{user.name}</span>
                </button>
                {openDropdown === 'user' && (
                  <div className="absolute top-full right-0 mt-1 w-48 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50">
                    <Link to="/login" className="block px-4 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
                      👤 Профіль
                    </Link>
                    {isOwner && (
                      <Link to="/admin" className="block px-4 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
                        🔧 Модератори
                      </Link>
                    )}
                    {isOwner && (
                      <Link to="/admin/db" className="block px-4 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
                        💾 База даних
                      </Link>
                    )}
                    {isOwner && (
                      <Link to="/admin/monitoring" className="block px-4 py-2 text-sm text-dark-300 hover:text-white hover:bg-dark-800 transition-colors">
                        📊 Моніторинг
                      </Link>
                    )}
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
              <Link to="/login" className="nav-link text-dark-400 hover:text-white">
                Вхід
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 text-dark-300 hover:text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-dark-800 bg-dark-900">
          <div className="px-4 py-3 space-y-1">
            {NAV.map((item) =>
              item.children ? (
                <div key={item.path}>
                  <div className="text-dark-500 text-xs font-semibold uppercase tracking-wider px-3 py-2 mt-2">
                    {item.label}
                  </div>
                  {item.children.map((child) => (
                    <Link
                      key={child.path}
                      to={child.path}
                      onClick={() => setMobileOpen(false)}
                      className={`block px-3 py-2 rounded-lg text-sm ${
                        isChildActive(child.path)
                          ? 'text-primary-400 bg-primary-500/10'
                          : 'text-dark-300 hover:text-white hover:bg-dark-800'
                      }`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              ) : (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-3 py-2 rounded-lg text-sm ${
                    isActive(item)
                      ? 'text-primary-400 bg-primary-500/10'
                      : 'text-dark-300 hover:text-white hover:bg-dark-800'
                  }`}
                >
                  {item.label}
                </Link>
              )
            )}

            {/* Mobile auth */}
            <div className="pt-2 mt-2 border-t border-dark-800">
              {user ? (
                <>
                  <Link
                    to="/login"
                    onClick={() => setMobileOpen(false)}
                    className="block px-3 py-2 rounded-lg text-sm text-dark-300"
                  >
                    {ROLE_ICONS[user.role]} {user.name}
                  </Link>
                  {isOwner && (
                    <Link
                      to="/admin"
                      onClick={() => setMobileOpen(false)}
                      className="block px-3 py-2 rounded-lg text-sm text-dark-300 hover:text-white hover:bg-dark-800"
                    >
                      🔧 Модератори
                    </Link>
                  )}
                  <button
                    onClick={() => { logout(); setMobileOpen(false); }}
                    className="block w-full text-left px-3 py-2 rounded-lg text-sm text-dark-400 hover:text-red-400"
                  >
                    Вийти
                  </button>
                </>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2 rounded-lg text-sm text-dark-300 hover:text-white hover:bg-dark-800"
                >
                  Вхід
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
