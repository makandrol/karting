import { useState } from 'react';
import { useAuth, ALL_PERMISSIONS, type AdminPermission } from '../../services/auth';
import { Navigate } from 'react-router-dom';

export default function AdminPanel() {
  const { isSuperAdmin, admins, addAdmin, removeAdmin, updateAdminPermissions } = useAuth();
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<AdminPermission[]>([]);

  if (!isSuperAdmin) {
    return <Navigate to="/login" replace />;
  }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) {
      addAdmin(newName.trim(), newPerms);
      setNewName('');
      setNewPerms([]);
    }
  };

  const togglePerm = (perms: AdminPermission[], perm: AdminPermission): AdminPermission[] => {
    return perms.includes(perm) ? perms.filter((p) => p !== perm) : [...perms, perm];
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">👑 Панель адміністратора</h1>
        <p className="text-dark-400 text-sm">
          Управління адміністраторами та їх правами доступу.
          Ця сторінка доступна тільки повному адміністратору.
        </p>
      </div>

      {/* Add new admin */}
      <form onSubmit={handleAdd} className="card space-y-4">
        <h3 className="text-white font-semibold">Додати адміністратора</h3>
        <div>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ім'я адміністратора..."
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            required
          />
        </div>

        <div>
          <div className="text-dark-300 text-sm font-medium mb-2">Дозволи:</div>
          <div className="flex flex-wrap gap-2">
            {ALL_PERMISSIONS.map((p) => (
              <button
                type="button"
                key={p.key}
                onClick={() => setNewPerms(togglePerm(newPerms, p.key))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  newPerms.includes(p.key)
                    ? 'bg-primary-600 text-white'
                    : 'bg-dark-800 text-dark-400 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Додати
        </button>
      </form>

      {/* Admins list */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-800">
          <h3 className="text-white font-semibold">
            Адміністратори ({admins.length})
          </h3>
        </div>

        {admins.length === 0 ? (
          <div className="px-4 py-8 text-center text-dark-500 text-sm">
            Немає адміністраторів. Додайте першого вище.
          </div>
        ) : (
          <div className="divide-y divide-dark-800">
            {admins.map((admin) => (
              <div key={admin.id} className="px-4 py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-dark-700 rounded-full flex items-center justify-center text-sm">
                      🛡️
                    </div>
                    <div>
                      <div className="text-white font-medium">{admin.name}</div>
                      <div className="text-dark-500 text-xs">
                        {admin.permissions.length} дозвіл(ів)
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeAdmin(admin.id)}
                    className="text-dark-500 hover:text-red-400 text-xs px-2 py-1 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    Видалити
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {ALL_PERMISSIONS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() =>
                        updateAdminPermissions(
                          admin.id,
                          togglePerm(admin.permissions, p.key)
                        )
                      }
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        admin.permissions.includes(p.key)
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-dark-800 text-dark-500 hover:text-dark-300'
                      }`}
                    >
                      {admin.permissions.includes(p.key) ? '✓ ' : ''}
                      {p.label}
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
