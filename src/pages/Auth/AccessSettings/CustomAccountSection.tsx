import { useState } from 'react';
import { useAuth } from '../../../services/auth';
import { ALL_PAGES, usePageVisibility } from '../../../services/pageVisibility';

export default function CustomAccountSection() {
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
