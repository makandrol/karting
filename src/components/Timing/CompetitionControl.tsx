import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../services/auth';
import { COLLECTOR_URL } from '../../services/config';

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
  manual: { label: 'Змагання', color: 'text-primary-400' },
};

interface PhaseOption {
  type: string;
  name: string;
}

interface CompetitionTree {
  format: string;
  label: string;
  phases: PhaseOption[];
}

const COMPETITION_TREE: CompetitionTree[] = [
  {
    format: 'light_league',
    label: '⭐ Лайт Ліга',
    phases: [
      { type: 'qualifying', name: 'Квала 1' },
      { type: 'qualifying', name: 'Квала 2' },
      { type: 'qualifying', name: 'Квала 3' },
      { type: 'qualifying', name: 'Квала 4' },
      { type: 'race', name: 'Гонка 1, Група 3' },
      { type: 'race', name: 'Гонка 1, Група 2' },
      { type: 'race', name: 'Гонка 1, Група 1' },
      { type: 'race', name: 'Гонка 2, Група 3' },
      { type: 'race', name: 'Гонка 2, Група 2' },
      { type: 'race', name: 'Гонка 2, Група 1' },
    ],
  },
  {
    format: 'champions_league',
    label: '👑 Ліга Чемпіонів',
    phases: [
      { type: 'qualifying', name: 'Квала 1' },
      { type: 'qualifying', name: 'Квала 2' },
      { type: 'race', name: 'Гонка 1, Група 2' },
      { type: 'race', name: 'Гонка 1, Група 1' },
      { type: 'race', name: 'Гонка 2, Група 2' },
      { type: 'race', name: 'Гонка 2, Група 1' },
      { type: 'race', name: 'Гонка 3, Група 2' },
      { type: 'race', name: 'Гонка 3, Група 1' },
    ],
  },
];

export default function CompetitionControl() {
  const { hasPermission } = useAuth();
  const [comp, setComp] = useState<CompetitionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedFormat, setExpandedFormat] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
        setExpandedFormat(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pickerOpen]);

  const apiCall = async (endpoint: string, body?: object) => {
    setLoading(true);
    try {
      const token = import.meta.env.VITE_ADMIN_TOKEN || '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch(`${COLLECTOR_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      await fetchState();
    } catch {} finally { setLoading(false); }
  };

  const handlePickPhase = async (tree: CompetitionTree, phase: PhaseOption) => {
    if (!comp?.competition || comp.competition.format !== tree.format) {
      await apiCall('/competition/start', { format: tree.format, name: tree.label.replace(/^[^\s]+\s/, '') });
    }
    await apiCall('/competition/phase', { type: phase.type, name: phase.name });
    setPickerOpen(false);
    setExpandedFormat(null);
  };

  if (!comp) return null;

  const stateInfo = STATE_LABELS[comp.state] || STATE_LABELS.none;
  const isActive = !['none', 'finished'].includes(comp.state);
  const currentPhaseName = comp.competition?.phases?.[comp.competition.phases.length - 1]?.name;

  return (
    <div className="card p-3 space-y-3">
      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${stateInfo.color}`}>
            {stateInfo.label}
          </span>
          {comp.competition && (
            <span className="text-dark-400 text-xs">
              {FORMAT_LABELS[comp.competition.format] || comp.competition.name}
              {currentPhaseName && <span className="text-dark-500"> — {currentPhaseName}</span>}
            </span>
          )}
        </div>

        {!isActive && comp.scheduled && (
          <span className="text-dark-500 text-xs">
            Сьогодні: {FORMAT_LABELS[comp.scheduled.format] || comp.scheduled.name} о {comp.scheduled.startTime}
          </span>
        )}
      </div>

      {/* Completed phases */}
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
        <div className="flex items-center gap-2 pt-1 border-t border-dark-800">
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => { setPickerOpen(!pickerOpen); setExpandedFormat(null); }}
              disabled={loading}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                isActive
                  ? 'bg-dark-800 hover:bg-dark-700 text-dark-300'
                  : 'bg-primary-600 hover:bg-primary-500 text-white'
              }`}
            >
              {isActive ? 'Редагувати змагання' : 'Почати змагання'}
            </button>

            {pickerOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1.5 z-50">
                <div className="px-3 py-1.5 text-[10px] text-dark-500">
                  Оберіть заїзд — поточний або наступний активний заїзд стане обраною фазою
                </div>
                {COMPETITION_TREE.map((tree) => (
                  <div key={tree.format}>
                    <button
                      onClick={() => setExpandedFormat(expandedFormat === tree.format ? null : tree.format)}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between ${
                        expandedFormat === tree.format
                          ? 'text-white bg-dark-800'
                          : 'text-dark-300 hover:text-white hover:bg-dark-800'
                      }`}
                    >
                      <span>{tree.label}</span>
                      <svg className={`w-3.5 h-3.5 transition-transform ${expandedFormat === tree.format ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>

                    {expandedFormat === tree.format && (
                      <div className="bg-dark-800/50 py-1">
                        {tree.phases.map((phase) => {
                          const alreadyDone = comp.competition?.format === tree.format &&
                            comp.competition.phases.some(p => p.name === phase.name);
                          return (
                            <button
                              key={phase.name}
                              onClick={() => !alreadyDone && handlePickPhase(tree, phase)}
                              disabled={loading || alreadyDone}
                              className={`w-full text-left px-6 py-1.5 text-xs transition-colors ${
                                alreadyDone
                                  ? 'text-dark-600 cursor-default'
                                  : phase.type === 'qualifying'
                                    ? 'text-purple-400 hover:bg-purple-500/10'
                                    : 'text-green-400 hover:bg-green-500/10'
                              }`}
                            >
                              {alreadyDone && <span className="text-dark-600 mr-1">✓</span>}
                              {phase.type === 'qualifying' ? '⏱️ ' : '🏁 '}
                              {phase.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isActive && (
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
          )}
        </div>
      )}
    </div>
  );
}
