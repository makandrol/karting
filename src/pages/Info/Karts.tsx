import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_KARTS } from '../../mock/timingData';
import { ALL_COMPETITION_EVENTS, type CompetitionEvent } from '../../mock/competitionEvents';

export default function Karts() {
  const [expandedKart, setExpandedKart] = useState<number | null>(null);

  // Filter state
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [includeProkat, setIncludeProkat] = useState(true);
  const [includeCompetitions, setIncludeCompetitions] = useState(true);

  // Filtered sessions list
  const filteredSessions = useMemo(() => {
    return ALL_COMPETITION_EVENTS.filter(ev => {
      if (ev.date < dateFrom || ev.date > dateTo) return false;
      const isComp = ['gonzales', 'light_league', 'champions_league'].includes(ev.format);
      if (isComp && !includeCompetitions) return false;
      if (!isComp && !includeProkat) return false;
      return true;
    });
  }, [dateFrom, dateTo, includeProkat, includeCompetitions]);

  // Sessions used for stats
  const [statSessionIds, setStatSessionIds] = useState<Set<string>>(new Set());
  const [showFiltered, setShowFiltered] = useState(false);
  const [selectedForAdd, setSelectedForAdd] = useState<Set<string>>(new Set());

  const addSessionsToStats = () => {
    const next = new Set(statSessionIds);
    for (const id of selectedForAdd) next.add(id);
    setStatSessionIds(next);
    setSelectedForAdd(new Set());
    setShowFiltered(false);
  };

  const removeFromStats = (ids: Set<string>) => {
    const next = new Set(statSessionIds);
    for (const id of ids) next.delete(id);
    setStatSessionIds(next);
    setSelectedToRemove(new Set());
  };

  const [selectedToRemove, setSelectedToRemove] = useState<Set<string>>(new Set());

  // When showing filtered, auto-select all
  const toggleShowFiltered = () => {
    if (!showFiltered) {
      setSelectedForAdd(new Set(filteredSessions.map(e => e.id)));
    }
    setShowFiltered(v => !v);
  };

  const statSessions = ALL_COMPETITION_EVENTS.filter(e => statSessionIds.has(e.id));

  const fmtEvName = (ev: CompetitionEvent) => {
    const isComp = ['gonzales', 'light_league', 'champions_league'].includes(ev.format);
    const compName = ev.format === 'light_league' ? 'ЛЛ' :
                     ev.format === 'champions_league' ? 'ЛЧ' :
                     ev.format === 'gonzales' ? 'Гонзалес' : 'Прокат';
    return `${ev.date}, ${isComp ? compName : 'Прокат'}, траса ${ev.trackConfigId}`;
  };

  // Last sessions input
  const [lastNInput, setLastNInput] = useState('5');
  const [lastNPrev, setLastNPrev] = useState('5');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">🔧 Карти</h1>

      {/* Filters */}
      <div className="card p-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap text-xs">
          <label className="text-dark-400">
            Від:
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="ml-1 bg-dark-800 border border-dark-700 text-white rounded-md px-2 py-1 outline-none focus:border-primary-500 text-xs" />
          </label>
          <label className="text-dark-400">
            До:
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="ml-1 bg-dark-800 border border-dark-700 text-white rounded-md px-2 py-1 outline-none focus:border-primary-500 text-xs" />
          </label>
          <label className="flex items-center gap-1.5 text-dark-400 cursor-pointer select-none">
            <input type="checkbox" checked={includeProkat} onChange={e => setIncludeProkat(e.target.checked)}
              className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0" />
            Прокат
          </label>
          <label className="flex items-center gap-1.5 text-dark-400 cursor-pointer select-none">
            <input type="checkbox" checked={includeCompetitions} onChange={e => setIncludeCompetitions(e.target.checked)}
              className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0" />
            Змагання
          </label>
          <label className="text-dark-400">
            Останніх:
            <input type="text" inputMode="numeric" value={lastNInput}
              onChange={e => setLastNInput(e.target.value.replace(/\D/g, ''))}
              onFocus={() => setLastNPrev(lastNInput)}
              onBlur={() => { if (!lastNInput) setLastNInput(lastNPrev); }}
              className="ml-1 w-12 bg-dark-800 border border-dark-700 text-white rounded-md px-2 py-1 outline-none focus:border-primary-500 text-xs text-center" />
          </label>
        </div>

        {/* Filtered sessions (collapsible) */}
        <div>
          <button onClick={toggleShowFiltered}
            className="flex items-center gap-1.5 text-dark-400 text-xs hover:text-white transition-colors">
            <span className={`text-[8px] transition-transform ${showFiltered ? 'rotate-90' : ''}`}>▶</span>
            Знайдено заїздів: {filteredSessions.length}
          </button>

          {showFiltered && (
            <div className="mt-2 space-y-1">
              {filteredSessions.map(ev => (
                <label key={ev.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-dark-800/50 cursor-pointer text-xs text-dark-300">
                  <input type="checkbox" checked={selectedForAdd.has(ev.id)}
                    onChange={e => {
                      const next = new Set(selectedForAdd);
                      e.target.checked ? next.add(ev.id) : next.delete(ev.id);
                      setSelectedForAdd(next);
                    }}
                    className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0" />
                  {fmtEvName(ev)}
                </label>
              ))}
              {filteredSessions.length > 0 && (
                <button onClick={addSessionsToStats}
                  className="mt-1 px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-500 transition-colors">
                  Додати до статистики ({selectedForAdd.size})
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active stats sessions */}
      {statSessions.length > 0 && (
        <div className="card p-3 space-y-2">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">Заїзди для статистики ({statSessions.length})</div>
          <div className="space-y-0.5">
            {statSessions.map(ev => (
              <label key={ev.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-dark-800/50 cursor-pointer text-xs text-dark-300">
                <input type="checkbox" checked={selectedToRemove.has(ev.id)}
                  onChange={e => {
                    const next = new Set(selectedToRemove);
                    e.target.checked ? next.add(ev.id) : next.delete(ev.id);
                    setSelectedToRemove(next);
                  }}
                  className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0" />
                {fmtEvName(ev)}
              </label>
            ))}
          </div>
          {selectedToRemove.size > 0 && (
            <button onClick={() => removeFromStats(selectedToRemove)}
              className="px-3 py-1.5 bg-red-600/20 text-red-400 text-xs rounded-lg hover:bg-red-600/30 transition-colors">
              Видалити ({selectedToRemove.size})
            </button>
          )}
        </div>
      )}

      {/* Kart list */}
      <div className="space-y-0.5">
        {MOCK_KARTS.map((kart) => {
          const isExpanded = expandedKart === kart.number;
          const best = kart.top5[0];

          return (
            <div key={kart.number}>
              <button
                onClick={() => setExpandedKart(isExpanded ? null : kart.number)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-dark-700/50 transition-colors group"
              >
                <span className="text-dark-300 text-sm group-hover:text-white transition-colors">
                  <span className={`transition-transform inline-block text-[8px] text-dark-500 mr-2 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  Карт #{kart.number}
                </span>
                {best && (
                  <span className="text-dark-500 text-xs font-mono shrink-0 ml-4">
                    {best.pilot.split(' ')[0]} — <span className="text-green-400">{best.bestLap}</span>
                  </span>
                )}
              </button>

              {isExpanded && (
                <div className="ml-6 mb-2 space-y-0.5">
                  {kart.top5.map((result, idx) => (
                    <div key={`${result.pilot}-${idx}`} className="flex items-center justify-between px-3 py-1 text-xs">
                      <span>
                        <span className={`font-mono font-bold mr-2 ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-amber-600' : 'text-dark-500'}`}>
                          {idx + 1}
                        </span>
                        <Link to={`/pilots/${encodeURIComponent(result.pilot)}`} className="text-dark-300 hover:text-primary-400 transition-colors">
                          {result.pilot}
                        </Link>
                      </span>
                      <span className="font-mono text-green-400">{result.bestLap}</span>
                    </div>
                  ))}
                  <Link to={`/info/karts/${kart.number}`} className="text-primary-400 hover:text-primary-300 text-xs px-3 py-1 inline-block">
                    Детальніше →
                  </Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
