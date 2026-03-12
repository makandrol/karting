import { useState } from 'react';
import { useAuth } from '../../services/auth';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const { loginSuperAdmin, loginAdmin, isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'admin' | 'super'>('admin');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (isAuthenticated && user) {
    return (
      <div className="max-w-md mx-auto space-y-6">
        <div className="card text-center py-10 space-y-4">
          <div className="text-5xl">
            {user.role === 'super_admin' ? '👑' : '🛡️'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-1">
              Вітаємо, {user.name}!
            </h2>
            <p className="text-dark-400 text-sm">
              Роль:{' '}
              <span className="text-primary-400 font-medium">
                {user.role === 'super_admin' ? 'Повний адміністратор' : 'Адміністратор'}
              </span>
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {user.role === 'super_admin' && (
              <button
                onClick={() => navigate('/admin')}
                className="bg-dark-800 hover:bg-dark-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                🔧 Панель адміністратора
              </button>
            )}
            <button
              onClick={logout}
              className="text-dark-400 hover:text-red-400 text-sm transition-colors"
            >
              Вийти
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'super') {
      if (loginSuperAdmin(password)) {
        navigate('/');
      } else {
        setError('Невірний пароль');
      }
    } else {
      if (loginAdmin(name)) {
        navigate('/');
      } else {
        setError('Адміністратор з таким ім\'ям не знайдений');
      }
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-1">🔐 Вхід</h1>
        <p className="text-dark-400 text-sm">
          Авторизуйтесь для доступу до адмін-функцій
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex bg-dark-800 rounded-xl p-1">
        <button
          onClick={() => { setMode('admin'); setError(''); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === 'admin' ? 'bg-dark-700 text-white' : 'text-dark-400'
          }`}
        >
          Адміністратор
        </button>
        <button
          onClick={() => { setMode('super'); setError(''); }}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            mode === 'super' ? 'bg-dark-700 text-white' : 'text-dark-400'
          }`}
        >
          Повний адмін
        </button>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        {mode === 'admin' ? (
          <div>
            <label className="block text-dark-300 text-sm font-medium mb-1.5">
              Ваше ім'я
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введіть ім'я адміна..."
              className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              required
            />
          </div>
        ) : (
          <div>
            <label className="block text-dark-300 text-sm font-medium mb-1.5">
              Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введіть пароль..."
              className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              required
            />
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="w-full bg-primary-600 hover:bg-primary-500 text-white py-2.5 rounded-lg font-semibold transition-colors"
        >
          Увійти
        </button>
      </form>
    </div>
  );
}
