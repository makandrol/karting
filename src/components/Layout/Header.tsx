import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { NavItem } from '../../types';

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Результати',
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
    label: 'Аналітика',
    path: '/info',
    children: [
      { label: 'Таймінг', path: '/info/timing' },
      { label: 'Карти', path: '/info/karts' },
      { label: 'Відео', path: '/info/videos' },
    ],
  },
];

export default function Header() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <header className="bg-dark-900/80 backdrop-blur-md border-b border-dark-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 bg-primary-600 rounded-lg flex items-center justify-center text-white font-black text-lg group-hover:bg-primary-500 transition-colors">
              Ж
            </div>
            <div className="hidden sm:block">
              <div className="text-white font-bold text-sm leading-tight">Жага швидкості</div>
              <div className="text-dark-400 text-xs leading-tight">Картинг</div>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.path}
                className="relative"
                onMouseEnter={() => setOpenDropdown(item.path)}
                onMouseLeave={() => setOpenDropdown(null)}
              >
                <Link
                  to={item.children?.[0]?.path || item.path}
                  className={isActive(item.path) ? 'nav-link-active' : 'nav-link'}
                >
                  {item.label}
                  {item.children && (
                    <svg className="w-4 h-4 ml-1 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </Link>

                {/* Dropdown */}
                {item.children && openDropdown === item.path && (
                  <div className="absolute top-full left-0 mt-1 w-56 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-2 z-50">
                    {item.children.map((child) => (
                      <Link
                        key={child.path}
                        to={child.path}
                        className={`block px-4 py-2.5 text-sm transition-colors ${
                          location.pathname === child.path
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
            ))}
          </nav>

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
            {NAV_ITEMS.map((item) => (
              <div key={item.path}>
                <div className="text-dark-500 text-xs font-semibold uppercase tracking-wider px-3 py-2 mt-2">
                  {item.label}
                </div>
                {item.children?.map((child) => (
                  <Link
                    key={child.path}
                    to={child.path}
                    onClick={() => setMobileOpen(false)}
                    className={`block px-3 py-2 rounded-lg text-sm ${
                      location.pathname === child.path
                        ? 'text-primary-400 bg-primary-500/10'
                        : 'text-dark-300 hover:text-white hover:bg-dark-800'
                    }`}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
