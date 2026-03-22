import { useAuth } from '../../services/auth';
import { Navigate, Link } from 'react-router-dom';
import { ALL_PAGES, usePageVisibility, type PageConfig } from '../../services/pageVisibility';

const GROUP_LABELS: Record<PageConfig['group'], string> = {
  main: 'Основні',
  competitions: 'Змагання',
  other: 'Інше',
  admin: 'Адмін',
};

export default function PageSettings() {
  const { isOwner } = useAuth();
  const { state, togglePage } = usePageVisibility();

  if (!isOwner) return <Navigate to="/login" replace />;

  const groups = ['main', 'competitions', 'other', 'admin'] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Налаштування сторінок</h1>
          <p className="text-dark-400 text-sm">Які сторінки видимі для користувачів та адмінів</p>
        </div>
      </div>

      <div className="space-y-4">
        {groups.map(group => {
          const pages = ALL_PAGES.filter(p => p.group === group);
          if (pages.length === 0) return null;

          return (
            <div key={group} className="card">
              <h3 className="text-white font-semibold mb-3">{GROUP_LABELS[group]}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-dark-500 text-xs">
                      <th className="text-left py-1.5 pr-4">Сторінка</th>
                      <th className="text-left py-1.5 pr-4 font-mono">Шлях</th>
                      <th className="text-center py-1.5 px-3">Користувачі</th>
                      <th className="text-center py-1.5 px-3">Адміни</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map(page => {
                      const userEnabled = page.always || state.userPages.has(page.id);
                      const adminEnabled = page.always || state.adminPages.has(page.id);
                      const isAlways = !!page.always;
                      const isAdminOnly = !!page.adminOnly;

                      return (
                        <tr key={page.id} className="border-t border-dark-800/50">
                          <td className="py-2 pr-4 text-dark-200">{page.label}</td>
                          <td className="py-2 pr-4 text-dark-500 font-mono text-xs">{page.path}</td>
                          <td className="py-2 px-3 text-center">
                            {isAdminOnly ? (
                              <span className="text-dark-700 text-xs">—</span>
                            ) : (
                              <button
                                onClick={() => !isAlways && togglePage(page.id, 'user')}
                                disabled={isAlways}
                                className={`w-8 h-5 rounded-full transition-colors relative ${
                                  userEnabled ? 'bg-green-500' : 'bg-dark-700'
                                } ${isAlways ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                              >
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                  userEnabled ? 'left-[14px]' : 'left-0.5'
                                }`} />
                              </button>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => !isAlways && togglePage(page.id, 'admin')}
                              disabled={isAlways}
                              className={`w-8 h-5 rounded-full transition-colors relative ${
                                adminEnabled ? 'bg-green-500' : 'bg-dark-700'
                              } ${isAlways ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                adminEnabled ? 'left-[14px]' : 'left-0.5'
                              }`} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-dark-600 text-xs text-center">
        Сторінки з галочкою "завжди" не можна вимкнути. Власник бачить всі сторінки.
      </div>
    </div>
  );
}
