import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../services/auth';

const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_URL || 'http://150.230.157.143:3001';

interface CompetitionState {
  state: string;
  competition: {
    format: string;
    name: string;
    startTime: number;
    phases: { type: string; name: string; sessionId: string | null; startTime: number }[];
    manualMode: boolean;
  } | null;
  todayOverride: boolean;
  scheduled: { format: string; name: string; startTime: string } | null;
}

const FORMAT_LABELS: Record<string, string> = {
  gonzales: '🏆 Гонзалес',
  light_league: '⭐ Лайт Ліга',
  champions_league: '👑 Ліга Чемпіонів',
};

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  none: { label: 'Немає змагання', color: 'text-dark-400' },
  detected: { label: 'Визначено', color: 'text-blue-400' },
  warmup: { label: 'Тренування', color: 'text-yellow-400' },
  qualifying: { label: 'Кваліфікація', color: 'text-purple-400' },
  pause: { label: 'Перерва', color: 'text-dark-300' },
  race: { label: 'Гонка', color: 'text-green-400' },
  finished: { label: 'Завершено', color: 'text-dark-500' },
  manual: { label: 'Ручний режим', color: 'text-primary-400' },
};

export default function CompetitionControl() {
  const { isModerator, hasPermission } = useAuth();
  const [comp, setComp] = useState<CompetitionState | null>(null);
  const [loading, setLoading] = useState(false);

  const canManage = hasPermission('manage_results');

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`${COLLECTOR_URL}/competition`);
      if (res.ok) setComp(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchState();
    const timer = setInterval(fetchState, 10000);
    return () => clearInterval(timer);
  }, [fetchState]);

  const apiCall = async (endpoint: string, body?: object) => {
    setLoading(true);
    try {
      await fetch(`${COLLECTOR_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      await fetchState();
    } catch {} finally { setLoading(false); }
  };

  if (!comp) return null;

  const stateInfo = STATE_LABELS[comp.state] || STATE_LABELS.none;
  const isActive = !['none', 'finished'].includes(comp.state);

  return (
    <div className="card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${stateInfo.color}`}>
            {stateInfo.label}
          </span>
          {comp.competition && (
            <span className="text-dark-400 text-xs">
              {FORMAT_LABELS[comp.competition.format] || comp.competition.name}
              {comp.competition.manualMode && ' (ручний)'}
            </span>
          )}
        </div>

        {/* Schedule info */}
        {!isActive && comp.scheduled && (
          <span className="text-dark-500 text-xs">
            Сьогодні: {FORMAT_LABELS[comp.scheduled.format] || comp.scheduled.name} о {comp.scheduled.startTime}
          </span>
        )}
      </div>

      {/* Active competition phases */}
      {comp.competition?.phases && comp.competition.phases.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {comp.competition.phases.map((phase, i) => (
            <span key={i} className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              phase.type === 'qualifying' ? 'bg-purple-500/20 text-purple-400' :
              phase.type === 'race' ? 'bg-green-500/20 text-green-400' :
              'bg-dark-700 text-dark-300'
            }`}>
              {phase.name}
            </span>
          ))}
        </div>
      )}

      {/* Admin controls */}
      {canManage && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-dark-800">
          {!isActive ? (
            <>
              {/* Start buttons */}
              <button
                onClick={() => apiCall('/competition/start', { format: 'gonzales', name: 'Гонзалес' })}
                disabled={loading}
                className="text-[10px] px-2.5 py-1 bg-dark-800 hover:bg-dark-700 text-dark-300 rounded-md transition-colors"
              >
                🏆 Старт Гонзалес
              </button>
              <button
                onClick={() => apiCall('/competition/start', { format: 'light_league', name: 'Лайт Ліга' })}
                disabled={loading}
                className="text-[10px] px-2.5 py-1 bg-dark-800 hover:bg-dark-700 text-dark-300 rounded-md transition-colors"
              >
                ⭐ Старт ЛЛ
              </button>
              <button
                onClick={() => apiCall('/competition/start', { format: 'champions_league', name: 'Ліга Чемпіонів' })}
                disabled={loading}
                className="text-[10px] px-2.5 py-1 bg-dark-800 hover:bg-dark-700 text-dark-300 rounded-md transition-colors"
              >
                👑 Старт ЛЧ
              </button>
            </>
          ) : (
            <>
              {/* Phase buttons — format specific */}
              <PhaseButtons format={comp.competition?.format || comp.scheduled?.format || ''} onMark={(type, name) => apiCall('/competition/phase', { type, name })} disabled={loading} />
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => apiCall('/competition/stop')}
                  disabled={loading}
                  className="text-[10px] px-2.5 py-1 bg-dark-800 hover:bg-dark-700 text-dark-400 rounded-md transition-colors"
                >
                  ⏹ Завершити
                </button>
                <button
                  onClick={() => apiCall('/competition/reset')}
                  disabled={loading}
                  className="text-[10px] px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-md transition-colors"
                >
                  🔄 Скинути
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Кнопки фаз — залежать від формату змагання */
function PhaseButtons({ format, onMark, disabled }: { format: string; onMark: (type: string, name: string) => void; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const Btn = ({ type, name, icon, color }: { type: string; name: string; icon: string; color: string }) => (
    <button onClick={() => onMark(type, name)} disabled={disabled}
      className={`text-[10px] px-2 py-1 ${color} rounded-md transition-colors whitespace-nowrap`}>
      {icon} {name}
    </button>
  );

  const qualaBtn = (n: number) => <Btn key={`q${n}`} type="qualifying" name={`Квала ${n}`} icon="⏱️" color="bg-purple-500/20 hover:bg-purple-500/30 text-purple-400" />;
  const raceBtn = (r: number, g?: number) => <Btn key={`r${r}g${g||0}`} type="race" name={g ? `Гонка ${r}, Група ${g}` : `Гонка ${r}`} icon="🏁" color="bg-green-500/20 hover:bg-green-500/30 text-green-400" />;

  if (format === 'gonzales') {
    return (
      <div className="flex flex-wrap gap-1">
        {[1, 2, 3, 4].map(n => qualaBtn(n))}
        <span className="text-dark-600 text-[10px] px-1">|</span>
        {expanded
          ? Array.from({ length: 24 }, (_, i) => raceBtn(i + 1))
          : <>
              {[1, 2, 3, 4, 5].map(n => raceBtn(n))}
              <button onClick={() => setExpanded(true)} className="text-[10px] px-2 py-1 bg-dark-800 text-dark-500 rounded-md">
                +{19} більше
              </button>
            </>
        }
      </div>
    );
  }

  if (format === 'light_league') {
    return (
      <div className="flex flex-wrap gap-1">
        {[1, 2, 3, 4].map(n => qualaBtn(n))}
        <span className="text-dark-600 text-[10px] px-1">|</span>
        {[3, 2, 1].map(g => raceBtn(1, g))}
        <span className="text-dark-600 text-[10px] px-1">|</span>
        {[3, 2, 1].map(g => raceBtn(2, g))}
      </div>
    );
  }

  if (format === 'champions_league') {
    return (
      <div className="flex flex-wrap gap-1">
        {[1, 2].map(n => qualaBtn(n))}
        <span className="text-dark-600 text-[10px] px-1">|</span>
        {[2, 1].map(g => raceBtn(1, g))}
        <span className="text-dark-600 text-[10px] px-1">|</span>
        {[2, 1].map(g => raceBtn(2, g))}
        <span className="text-dark-600 text-[10px] px-1">|</span>
        {[2, 1].map(g => raceBtn(3, g))}
      </div>
    );
  }

  // Fallback
  return (
    <div className="flex flex-wrap gap-1">
      {[1, 2].map(n => qualaBtn(n))}
      {[1, 2, 3].map(n => raceBtn(n))}
    </div>
  );
}
