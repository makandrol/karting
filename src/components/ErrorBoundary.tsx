import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">💥</div>
          <h2 className="text-2xl font-bold text-white mb-2">Щось пішло не так</h2>
          <p className="text-dark-400 text-sm mb-4 max-w-md mx-auto">
            {this.state.error?.message || 'Невідома помилка'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors mr-2"
          >
            Спробувати ще
          </button>
          <Link to="/" className="text-primary-400 hover:underline text-sm">
            На головну
          </Link>
        </div>
      );
    }
    return this.props.children;
  }
}
