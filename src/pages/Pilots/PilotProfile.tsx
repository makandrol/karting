import { useParams, Link } from 'react-router-dom';

export default function PilotProfile() {
  const { pilotName } = useParams<{ pilotName: string }>();
  const name = decodeURIComponent(pilotName || '');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 bg-primary-600/20 text-primary-400 rounded-xl flex items-center justify-center text-2xl">
          👤
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{name}</h1>
          <p className="text-dark-400 text-sm">Профіль пілота</p>
        </div>
      </div>

      <div className="card text-center py-12 text-dark-500">
        <p className="text-sm mb-2">Профіль пілота буде доступний пізніше</p>
        <Link to="/sessions" className="text-primary-400 hover:text-primary-300 text-sm">
          Переглянути заїзди
        </Link>
      </div>
    </div>
  );
}
