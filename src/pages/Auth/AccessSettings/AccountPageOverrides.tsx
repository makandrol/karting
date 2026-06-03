import { ALL_PAGES } from '../../../services/pageVisibility';

interface AccountPageOverridesProps {
  email: string;
  hasOverride: boolean;
  getAccountPages: (email: string) => Set<string> | null;
  toggleAccountPage: (email: string, pageId: string) => void;
  enableAccountOverride: (email: string) => void;
  removeAccountOverride: (email: string) => void;
}

export default function AccountPageOverrides({
  email, hasOverride, getAccountPages,
  toggleAccountPage, enableAccountOverride, removeAccountOverride,
}: AccountPageOverridesProps) {
  const pages = getAccountPages(email);
  const nonAdminPages = ALL_PAGES.filter(p => !p.adminOnly);

  if (!hasOverride) {
    return (
      <div className="bg-dark-800/50 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-dark-400 text-xs">Індивідуальні доступи до сторінок не налаштовані (використовуються загальні)</span>
          <button
            onClick={() => enableAccountOverride(email)}
            className="text-primary-400 hover:text-primary-300 text-xs px-2 py-1 hover:bg-primary-500/10 rounded-lg transition-colors"
          >
            Налаштувати
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark-800/50 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-dark-300 text-xs font-medium">Індивідуальні доступи до сторінок</span>
        <button
          onClick={() => removeAccountOverride(email)}
          className="text-dark-500 hover:text-red-400 text-xs px-2 py-1 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          Скинути
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {nonAdminPages.map(page => {
          const enabled = page.always || (pages?.has(page.id) ?? true);
          const isAlways = !!page.always;
          return (
            <button
              key={page.id}
              onClick={() => !isAlways && toggleAccountPage(email, page.id)}
              disabled={isAlways}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                isAlways ? 'bg-dark-700 text-dark-500 cursor-not-allowed' :
                enabled ? 'bg-green-500/20 text-green-400' : 'bg-dark-800 text-dark-500 hover:text-dark-300'
              }`}
            >
              {!isAlways && enabled ? '✓ ' : ''}{page.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
