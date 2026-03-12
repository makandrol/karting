import { useState } from 'react';
import { useAuth, ALL_PERMISSIONS, type ModeratorPermission } from '../../services/auth';
import { Navigate } from 'react-router-dom';

export default function AdminPanel() {
  const { isOwner, moderators, addModerator, removeModerator, updateModerator } = useAuth();
  const [newEmail, setNewEmail] = useState('');
  const [newPerms, setNewPerms] = useState<ModeratorPermission[]>([]);
  const [formError, setFormError] = useState('');

  if (!isOwner) {
    return <Navigate to="/login" replace />;
  }

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">👑 Управління модераторами</h1>
        <p className="text-dark-400 text-sm">
          Додайте Google email модераторів. Коли вони увійдуть через Google — їм автоматично
          присвоїться роль модератора з вибраними дозволами.
        </p>
      </div>

      {/* Add */}
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

      {/* List */}
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
            {moderators.map((mod) => (
              <div key={mod.email} className="px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center text-sm">🛡️</div>
                    <div>
                      <div className="text-white font-medium font-mono text-sm">{mod.email}</div>
                      <div className="text-dark-500 text-xs">{mod.permissions.length} дозвіл(ів)</div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeModerator(mod.email)}
                    className="text-dark-500 hover:text-red-400 text-xs px-2 py-1 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    Видалити
                  </button>
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
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
