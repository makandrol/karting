import { useState } from 'react';

export type FilterMode = 'today' | 'date_range' | 'last_sessions' | 'competition';

export interface LapFilterState {
  mode: FilterMode;
  dateFrom: string;   // ISO date "2025-03-12"
  dateTo: string;
  lastSessions: number;
  competitionId: string; // 'current' | competition id
}

const COMPETITIONS = [
  { id: 'current', name: 'Поточне змагання' },
  { id: 'gonzales', name: 'Гонзалес 2025' },
  { id: 'light_league', name: 'Лайт Ліга 2025' },
  { id: 'champions', name: 'Ліга Чемпіонів 2025' },
  { id: 'sprints', name: 'Спринти 2025' },
  { id: 'marathons', name: 'Марафони 2025' },
];

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function getDefaultFilter(): LapFilterState {
  const today = todayISO();
  return {
    mode: 'today',
    dateFrom: today,
    dateTo: today,
    lastSessions: 5,
    competitionId: 'current',
  };
}

interface LapFilterProps {
  filter: LapFilterState;
  onChange: (f: LapFilterState) => void;
}

export default function LapFilter({ filter, onChange }: LapFilterProps) {
  const [expanded, setExpanded] = useState(false);

  const set = (partial: Partial<LapFilterState>) => {
    onChange({ ...filter, ...partial });
  };

  const modeLabel = {
    today: '📅 Сьогодні',
    date_range: '📆 Період',
    last_sessions: '🔢 Останні заїзди',
    competition: '🏆 Змагання',
  };

  return (
    <div className="card p-3 space-y-3">
      {/* Mode buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-dark-500 text-xs">Фільтр:</span>
        {(Object.keys(modeLabel) as FilterMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { set({ mode: m }); setExpanded(true); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter.mode === m
                ? 'bg-primary-600 text-white'
                : 'bg-dark-800 text-dark-400 hover:text-white'
            }`}
          >
            {modeLabel[m]}
          </button>
        ))}
        {expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="text-dark-500 hover:text-dark-300 text-xs ml-auto"
          >
            ▲
          </button>
        )}
        {!expanded && filter.mode !== 'today' && (
          <button
            onClick={() => setExpanded(true)}
            className="text-dark-500 hover:text-dark-300 text-xs ml-auto"
          >
            ▼
          </button>
        )}
      </div>

      {/* Expanded options */}
      {expanded && filter.mode === 'date_range' && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-dark-400 text-xs">
            Від:
            <input
              type="date"
              value={filter.dateFrom}
              onChange={(e) => set({ dateFrom: e.target.value })}
              className="ml-1.5 bg-dark-800 border border-dark-700 text-white text-xs rounded-md px-2 py-1 outline-none focus:border-primary-500"
            />
          </label>
          <label className="text-dark-400 text-xs">
            До:
            <input
              type="date"
              value={filter.dateTo}
              onChange={(e) => set({ dateTo: e.target.value })}
              className="ml-1.5 bg-dark-800 border border-dark-700 text-white text-xs rounded-md px-2 py-1 outline-none focus:border-primary-500"
            />
          </label>
        </div>
      )}

      {expanded && filter.mode === 'last_sessions' && (
        <div className="flex items-center gap-3">
          <label className="text-dark-400 text-xs">
            Останніх заїздів:
            <input
              type="number"
              min={1}
              max={50}
              value={filter.lastSessions}
              onChange={(e) => set({ lastSessions: parseInt(e.target.value) || 5 })}
              className="ml-1.5 w-16 bg-dark-800 border border-dark-700 text-white text-xs rounded-md px-2 py-1 outline-none focus:border-primary-500"
            />
          </label>
        </div>
      )}

      {expanded && filter.mode === 'competition' && (
        <div className="flex items-center gap-3">
          <label className="text-dark-400 text-xs">
            Змагання:
            <select
              value={filter.competitionId}
              onChange={(e) => set({ competitionId: e.target.value })}
              className="ml-1.5 bg-dark-800 border border-dark-700 text-white text-xs rounded-md px-2 py-1 outline-none focus:border-primary-500"
            >
              {COMPETITIONS.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
