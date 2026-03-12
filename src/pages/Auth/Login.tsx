import { useState } from 'react';
import { useAuth, ROLE_LABELS, ROLE_ICONS } from '../../services/auth';
import { useNavigate, Link } from 'react-router-dom';

export default function Login() {
  const { login, isAuthenticated, user, isOwner, logout } = useAuth();
  const navigate = useNavigate();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Вже авторизований — показуємо профіль
  if (isAuthenticated && user) {
    return (
      <div className="max-w-md mx-auto space-y-6">
        <div className="card text-center py-10 space-y-4">
          <div className="text-5xl">{ROLE_ICONS[user.role]}</div>
          <div>
            <h2 className="text-xl font-bold text-white mb-1">{user.name}</h2>
            <p className="text-dark-400 text-sm">
              Логін: <span className="text-dark-200 font-mono">{user.login}</span>
            </p>
            <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${
              user.role === 'owner'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'bg-blue-500/20 text-blue-400'
            }`}>
              {ROLE_ICONS[user.role]} {ROLE_LABELS[user.role]}
            </span>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            {isOwner && (
              <Link
                to="/admin"
                className="bg-dark-800 hover:bg-dark-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
              >
                🔧 Управління модераторами
              </Link>
            )}
            <button
              onClick={() => { logout(); }}
              className="text-dark-400 hover:text-red-400 text-sm transition-colors pt-1"
            >
              Вийти
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Форма логіну
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const result = login(loginValue, password);
    if (result.success) {
      navigate('/');
    } else {
      setError(result.error || 'Помилка авторизації');
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-1">🔐 Вхід</h1>
        <p className="text-dark-400 text-sm">
          Введіть логін та пароль для доступу до функцій управління
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="block text-dark-300 text-sm font-medium mb-1.5">
            Логін
          </label>
          <input
            type="text"
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            placeholder="Введіть логін..."
            autoComplete="username"
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-dark-300 text-sm font-medium mb-1.5">
            Пароль
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Введіть пароль..."
            autoComplete="current-password"
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-lg px-4 py-2.5 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
            required
          />
        </div>

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

      <p className="text-center text-dark-600 text-xs">
        Доступ надається власником сайту
      </p>
    </div>
  );
}
