import { ALL_PAGES, usePageVisibility, type PageConfig } from '../../../services/pageVisibility';
import Toggle from './Toggle';

const GROUP_LABELS: Record<PageConfig['group'], string> = {
  main: 'Основні',
  other: 'Інше',
  admin: 'Адмін',
};

export default function PageVisibilitySection() {
  const { state, togglePage } = usePageVisibility();
  const groups = ['main', 'other', 'admin'] as const;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Видимість сторінок</h2>
        <p className="text-dark-400 text-sm">Які сторінки видимі для адмінів та користувачів</p>
      </div>

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
                    <th className="text-center py-1.5 px-3">Адміни</th>
                    <th className="text-center py-1.5 px-3">Користувачі</th>
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
                          <Toggle
                            enabled={adminEnabled}
                            disabled={isAlways}
                            onChange={() => togglePage(page.id, 'admin')}
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          {isAdminOnly ? (
                            <span className="text-dark-700 text-xs">—</span>
                          ) : (
                            <Toggle
                              enabled={userEnabled}
                              disabled={isAlways}
                              onChange={() => togglePage(page.id, 'user')}
                            />
                          )}
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

      <div className="text-dark-600 text-xs text-center">
        Сторінки з «завжди» не можна вимкнути. Власник бачить всі сторінки.
      </div>
    </div>
  );
}
