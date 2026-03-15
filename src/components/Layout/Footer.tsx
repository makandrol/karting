import { Link } from 'react-router-dom';
import { APP_VERSION } from '../../data/changelog';

export default function Footer() {
  return (
    <footer className="bg-dark-900/50 border-t border-dark-800 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-black text-sm">
              Ж
            </div>
            <div>
              <div className="text-dark-300 text-sm font-medium">Жага швидкості</div>
              <div className="text-dark-500 text-xs">Картодром • Київ</div>
            </div>
          </div>

          <div className="flex items-center gap-6 text-dark-500 text-sm">
            <a
              href="https://timing.karting.ua/board.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-dark-300 transition-colors"
            >
              Таймінг
            </a>
            <Link to="/changelog" className="hover:text-dark-300 transition-colors font-mono text-xs">
              v{APP_VERSION}
            </Link>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
