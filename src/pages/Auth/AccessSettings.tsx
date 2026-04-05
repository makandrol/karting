import { useState } from 'react';
import { useAuth, ALL_PERMISSIONS, type ModeratorPermission } from '../../services/auth';
import { Navigate } from 'react-router-dom';
import { ALL_PAGES, usePageVisibility, type PageConfig } from '../../services/pageVisibility';

const GROUP_LABELS: Record<PageConfig['group'], string> = {
  main: 'Основні',
  other: 'Інше',
  admin: 'Адмін',
};

function Toggle({ enabled, disabled, onChange }: { enabled: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <button
      onClick={() => !disabled && onChange()}
      disabled={disabled}
      className={`w-8 h-5 rounded-full transition-colors relative ${
        enabled ? 'bg-green-500' : 'bg-dark-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
        enabled ? 'left-[14px]' : 'left-0.5'
      }`} />
    </button>
  );
}

function PageVisibilitySection() {
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

function ModeratorsSection() {
  const { moderators, addModerator, removeModerator, updateModerator } = useAuth();
  const { state: pageState, setAccountOverrides } = usePageVisibility();
  const [newEmail, setNewEmail] = useState('');
  const [newPerms, setNewPerms] = useState<ModeratorPermission[]>([]);
  const [formError, setFormError] = useState('');
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!newEmail.trim() || !newEmail.includes('@')) {
      setFormError('Введіть валідний email');
      return;
    }
    const error = addModerator(newEmail.trim(), newPerms);
    if (error) { setFormError(error); return; }
    setNewEmail('');
    setNewPerms([]);
  };

  const togglePerm = (perms: ModeratorPermission[], perm: ModeratorPermission): ModeratorPermission[] => {
    return perms.includes(perm) ? perms.filter((p) => p !== perm) : [...perms, perm];
  };

  const getAccountPages = (email: string): Set<string> | null => {
    return pageState.accountOverrides.get(email.toLowerCase()) ?? null;
  };

  const toggleAccountPage = (email: string, pageId: string) => {
    const key = email.toLowerCase();
    const current = pageState.accountOverrides.get(key) ?? new Set(ALL_PAGES.filter(p => !p.adminOnly || true).map(p => p.id));
    const next = new Set(current);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    const newOverrides = new Map(pageState.accountOverrides);
    newOverrides.set(key, next);
    setAccountOverrides(newOverrides);
  };

  const hasAccountOverride = (email: string): boolean => {
    return pageState.accountOverrides.has(email.toLowerCase());
  };

  const enableAccountOverride = (email: string) => {
    const key = email.toLowerCase();
    if (pageState.accountOverrides.has(key)) return;
    const newOverrides = new Map(pageState.accountOverrides);
    newOverrides.set(key, new Set(ALL_PAGES.map(p => p.id)));
    setAccountOverrides(newOverrides);
  };

  const removeAccountOverride = (email: string) => {
    const key = email.toLowerCase();
    const newOverrides = new Map(pageState.accountOverrides);
    newOverrides.delete(key);
    setAccountOverrides(newOverrides);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Модератори</h2>
        <p className="text-dark-400 text-sm">Управління модераторами та їх правами</p>
      </div>

      <form onSubmit={handleAdd} className="card space-y-4">
        <h3 className="text-white font-semibold">Додати модератора</h3>
        <div>
          <label className="block text-dark-400 text-xs mb-1">Google email</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="user@gmail.com"
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary-500 outline-none font-mono"
            required
          />
        </div>

        <div>
          <div className="text-dark-400 text-xs mb-2">Дозволи:</div>
          <div className="flex flex-wrap gap-2">
            {ALL_PERMISSIONS.map((p) => (
              <button
                type="button"
                key={p.key}
                onClick={() => setNewPerms(togglePerm(newPerms, p.key))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  newPerms.includes(p.key) ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {formError && (
          <div className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{formError}</div>
        )}

        <button type="submit" className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          + Додати
        </button>
      </form>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800">
          <h3 className="text-white font-semibold">Модератори ({moderators.length})</h3>
        </div>
        {moderators.length === 0 ? (
          <div className="px-4 py-8 text-center text-dark-500 text-sm">
            Немає модераторів. Додайте email вище.
          </div>
        ) : (
          <div className="divide-y divide-dark-800">
            {moderators.map((mod) => {
              const isExpanded = expandedEmail === mod.email;
              const hasOverride = hasAccountOverride(mod.email);

              return (
                <div key={mod.email} className="px-4 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center text-sm">🛡️</div>
                      <div>
                        <div className="text-white font-medium font-mono text-sm">{mod.email}</div>
                        <div className="text-dark-500 text-xs">{mod.permissions.length} дозвіл(ів)</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedEmail(isExpanded ? null : mod.email)}
                        className="text-dark-500 hover:text-primary-400 text-xs px-2 py-1 hover:bg-primary-500/10 rounded-lg transition-colors"
                      >
                        {isExpanded ? 'Згорнути' : 'Сторінки'}
                      </button>
                      <button
                        onClick={() => removeModerator(mod.email)}
                        className="text-dark-500 hover:text-red-400 text-xs px-2 py-1 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        Видалити
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {ALL_PERMISSIONS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => updateModerator(mod.email, togglePerm(mod.permissions, p.key))}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                          mod.permissions.includes(p.key) ? 'bg-green-500/20 text-green-400' : 'bg-dark-800 text-dark-500 hover:text-dark-300'
                        }`}
                      >
                        {mod.permissions.includes(p.key) ? '✓ ' : ''}{p.label}
                      </button>
                    ))}
                  </div>

                  {isExpanded && (
                    <AccountPageOverrides
                      email={mod.email}
                      hasOverride={hasOverride}
                      getAccountPages={getAccountPages}
                      toggleAccountPage={toggleAccountPage}
                      enableAccountOverride={enableAccountOverride}
                      removeAccountOverride={removeAccountOverride}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AccountPageOverrides({ email, hasOverride, getAccountPages, toggleAccountPage, enableAccountOverride, removeAccountOverride }: {
  email: string;
  hasOverride: boolean;
  getAccountPages: (email: string) => Set<string> | null;
  toggleAccountPage: (email: string, pageId: string) => void;
  enableAccountOverride: (email: string) => void;
  removeAccountOverride: (email: string) => void;
}) {
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

function CustomAccountSection() {
  const { state: pageState, setAccountOverrides } = usePageVisibility();
  const { moderators } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const moderatorEmails = new Set(moderators.map(m => m.email.toLowerCase()));
  const customAccounts = [...pageState.accountOverrides.keys()].filter(e => !moderatorEmails.has(e));

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Введіть валідний email');
      return;
    }
    if (pageState.accountOverrides.has(trimmed)) {
      setError('Цей email вже має індивідуальні доступи');
      return;
    }
    const newOverrides = new Map(pageState.accountOverrides);
    newOverrides.set(trimmed, new Set(ALL_PAGES.map(p => p.id)));
    setAccountOverrides(newOverrides);
    setEmail('');
  };

  const togglePage = (accountEmail: string, pageId: string) => {
    const current = pageState.accountOverrides.get(accountEmail) ?? new Set(ALL_PAGES.map(p => p.id));
    const next = new Set(current);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    const newOverrides = new Map(pageState.accountOverrides);
    newOverrides.set(accountEmail, next);
    setAccountOverrides(newOverrides);
  };

  const removeOverride = (accountEmail: string) => {
    const newOverrides = new Map(pageState.accountOverrides);
    newOverrides.delete(accountEmail);
    setAccountOverrides(newOverrides);
  };

  const nonAdminPages = ALL_PAGES.filter(p => !p.adminOnly);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Індивідуальні доступи</h2>
        <p className="text-dark-400 text-sm">Налаштування доступу для конкретних акаунтів (по email)</p>
      </div>

      <form onSubmit={handleAdd} className="card space-y-3">
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@gmail.com"
            className="flex-1 bg-dark-800 border border-dark-700 text-white rounded-lg px-3 py-2 text-sm focus:border-primary-500 outline-none font-mono"
          />
          <button type="submit" className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
            + Додати
          </button>
        </div>
        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</div>
        )}
      </form>

      {customAccounts.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-dark-800">
            {customAccounts.map(accountEmail => {
              const pages = pageState.accountOverrides.get(accountEmail);
              return (
                <div key={accountEmail} className="px-4 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-purple-500/10 text-purple-400 rounded-full flex items-center justify-center text-sm">👤</div>
                      <div className="text-white font-medium font-mono text-sm">{accountEmail}</div>
                    </div>
                    <button
                      onClick={() => removeOverride(accountEmail)}
                      className="text-dark-500 hover:text-red-400 text-xs px-2 py-1 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      Видалити
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {nonAdminPages.map(page => {
                      const enabled = page.always || (pages?.has(page.id) ?? true);
                      const isAlways = !!page.always;
                      return (
                        <button
                          key={page.id}
                          onClick={() => !isAlways && togglePage(accountEmail, page.id)}
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
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AccessSettings() {
  const { isOwner } = useAuth();

  if (!isOwner) return <Navigate to="/login" replace />;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Доступи</h1>
      <PageVisibilitySection />
      <ModeratorsSection />
      <CustomAccountSection />
    </div>
  );
}
