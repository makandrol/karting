import { useState, useEffect } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';

export default function CurrentRace() {
  const [loading, setLoading] = useState(true);
  const [liveComp, setLiveComp] = useState<{ id: string; format: string } | null>(null);

  useEffect(() => {
    fetch(`${COLLECTOR_URL}/competitions`)
      .then(r => r.json())
      .then((comps: { id: string; format: string; status: string }[]) => {
        const live = comps.find(c => c.status === 'live');
        setLiveComp(live ? { id: live.id, format: live.format } : null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="card text-center py-12 text-dark-500">Завантаження...</div>;

  if (liveComp) {
    return <Navigate to={`/results/${liveComp.format}/${liveComp.id}`} replace />;
  }

  return (
    <div className="card text-center py-12 space-y-4">
      <div className="text-4xl">📊</div>
      <div>
        <h2 className="text-xl font-bold text-white mb-2">Немає активного змагання</h2>
        <p className="text-dark-400 text-sm max-w-md mx-auto">
          Коли адмін створить та запустить змагання — воно з'явиться тут автоматично.
        </p>
      </div>
      <div className="flex items-center justify-center gap-3">
        <Link to="/results/gonzales" className="text-primary-400 hover:text-primary-300 text-sm transition-colors">Гонзалес</Link>
        <Link to="/results/light_league" className="text-primary-400 hover:text-primary-300 text-sm transition-colors">Лайт Ліга</Link>
        <Link to="/results/champions_league" className="text-primary-400 hover:text-primary-300 text-sm transition-colors">Ліга Чемпіонів</Link>
      </div>
    </div>
  );
}
