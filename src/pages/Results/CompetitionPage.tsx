import { Link } from 'react-router-dom';

export default function CompetitionPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Змагання</h1>
      <div className="card text-center py-12 text-dark-500">
        <p className="text-sm mb-2">Результати змагань будуть доступні через нову систему управління змаганнями</p>
        <Link to="/admin/competitions" className="text-primary-400 hover:text-primary-300 text-sm">
          Управління змаганнями
        </Link>
      </div>
    </div>
  );
}
