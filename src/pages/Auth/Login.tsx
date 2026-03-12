import { useAuth, ROLE_LABELS, ROLE_ICONS } from '../../services/auth';
import { Link } from 'react-router-dom';

export default function Login() {
  const { user, loading, loginWithGoogle, logout, isOwner, firebaseConfigured } = useAuth();

  if (loading) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <div className="text-dark-500">Завантаження...</div>
      </div>
    );
  }

  // Авторизований — профіль
  if (user) {
    return (
      <div className="max-w-md mx-auto space-y-6">
        <div className="card text-center py-10 space-y-4">
          {user.photo ? (
            <img src={user.photo} alt={user.name} className="w-16 h-16 rounded-full mx-auto" referrerPolicy="no-referrer" />
          ) : (
            <div className="text-5xl">{ROLE_ICONS[user.role]}</div>
          )}
          <div>
            <h2 className="text-xl font-bold text-white mb-1">{user.name}</h2>
            <p className="text-dark-400 text-sm">{user.email}</p>
            <span className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium ${
              user.role === 'owner'
                ? 'bg-yellow-500/20 text-yellow-400'
                : user.role === 'moderator'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-dark-700 text-dark-300'
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
              onClick={logout}
              className="text-dark-400 hover:text-red-400 text-sm transition-colors pt-1"
            >
              Вийти
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Форма логіну — тільки Google
  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-1">🔐 Вхід</h1>
        <p className="text-dark-400 text-sm">
          Увійдіть через Google для доступу до функцій управління
        </p>
      </div>

      <div className="card text-center py-8 space-y-6">
        {firebaseConfigured ? (
          <button
            onClick={loginWithGoogle}
            className="inline-flex items-center gap-3 bg-white text-gray-800 px-6 py-3 rounded-xl font-semibold transition-colors hover:bg-gray-100 mx-auto"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Увійти через Google
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-dark-400 text-sm">
              Firebase не налаштовано. Для активації Google авторизації:
            </p>
            <ol className="text-dark-500 text-xs text-left max-w-sm mx-auto space-y-1 list-decimal list-inside">
              <li>Створити проєкт на <a href="https://console.firebase.google.com" target="_blank" className="text-primary-400 hover:underline">Firebase Console</a></li>
              <li>Увімкнути Authentication → Google Sign-In</li>
              <li>Скопіювати конфіг в <code className="bg-dark-800 px-1 rounded">.env</code></li>
            </ol>
          </div>
        )}
      </div>

      <p className="text-center text-dark-600 text-xs">
        Роль визначається автоматично по email
      </p>
    </div>
  );
}
