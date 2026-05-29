import { useState } from 'react';
import { useAuth, ALL_PERMISSIONS, type ModeratorPermission } from '../../../services/auth';
import { ALL_PAGES, usePageVisibility } from '../../../services/pageVisibility';
import AccountPageOverrides from './AccountPageOverrides';

const togglePerm = (perms: ModeratorPermission[], perm: ModeratorPermission): ModeratorPermission[] =>
  perms.includes(perm) ? perms.filter((p) => p !== perm) : [...perms, perm];

export default function ModeratorsSection() {
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

  const getAccountPages = (email: string): Set<string> | null =>
    pageState.accountOverrides.get(email.toLowerCase()) ?? null;

  const toggleAccountPage = (email: string, pageId: string) => {
    const key = email.toLowerCase();
    const current = pageState.accountOverrides.get(key) ?? new Set(ALL_PAGES.map(p => p.id));
    const next = new Set(current);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    const newOverrides = new Map(pageState.accountOverrides);
    newOverrides.set(key, next);
    setAccountOverrides(newOverrides);
  };

  const hasAccountOverride = (email: string): boolean =>
    pageState.accountOverrides.has(email.toLowerCase());

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
