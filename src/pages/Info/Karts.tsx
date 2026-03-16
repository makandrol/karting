import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ALL_COMPETITION_EVENTS } from '../../mock/competitionEvents';
import { SessionCheckboxRows } from '../../components/Sessions/SessionRows';
import { ALL_KART_NUMBERS } from '../../mock/timingData';

export default function Karts() {
  const [expandedKart, setExpandedKart] = useState<number | null>(null);

  // Filter state
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [includeProkat, setIncludeProkat] = useState(true);
  const [includeCompetitions, setIncludeCompetitions] = useState(true);

  // Last sessions input
  const [lastNInput, setLastNInput] = useState('5');
  const [lastNPrev, setLastNPrev] = useState('5');

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return ALL_COMPETITION_EVENTS.filter(ev => {
      if (ev.date < dateFrom || ev.date > dateTo) return false;
      const isComp = ['gonzales', 'light_league', 'champions_league'].includes(ev.format);
      if (isComp && !includeCompetitions) return false;
      if (!isComp && !includeProkat) return false;
      return true;
    });
  }, [dateFrom, dateTo, includeProkat, includeCompetitions]);

  // Sessions for stats
  const [statSessionIds, setStatSessionIds] = useState<Set<string>>(new Set());
  const [showFiltered, setShowFiltered] = useState(false);
  const [selectedForAdd, setSelectedForAdd] = useState<Set<string>>(new Set());
  const [selectedToRemove, setSelectedToRemove] = useState<Set<string>>(new Set());

  const toggleShowFiltered = () => {
    if (!showFiltered) setSelectedForAdd(new Set(filteredSessions.map(e => e.id)));
    setShowFiltered(v => !v);
  };

  const addToStats = () => {
    const next = new Set(statSessionIds);
    for (const id of selectedForAdd) next.add(id);
    setStatSessionIds(next);
    setSelectedForAdd(new Set());
    setShowFiltered(false);
  };

  const removeFromStats = () => {
    const next = new Set(statSessionIds);
    for (const id of selectedToRemove) next.delete(id);
    setStatSessionIds(next);
    setSelectedToRemove(new Set());
  };

  const clearAllStats = () => { setStatSessionIds(new Set()); setSelectedToRemove(new Set()); };

  const statSessions = ALL_COMPETITION_EVENTS.filter(e => statSessionIds.has(e.id));

  // Compute kart stats from selected stat sessions
  const kartStats = useMemo(() => {
    const byKart = new Map<number, { pilot: string; bestLap: string; bestLapSec: number }[]>();

    for (const ev of statSessions) {
      for (const phase of ev.phases) {
        for (const result of phase.results) {
          if (!result.kart || result.kart === 0) continue;
          if (!byKart.has(result.kart)) byKart.set(result.kart, []);
          // Best lap from this result's laps
          for (const lap of result.laps) {
            byKart.get(result.kart)!.push({
              pilot: result.pilot,
              bestLap: lap.lapTime,
              bestLapSec: lap.lapTimeSec,
            });
          }
        }
      }
    }

    // For each kart: deduplicate and get top 5
    const stats: { number: number; top5: { pilot: string; bestLap: string; bestLapSec: number }[] }[] = [];

    for (const kartNum of ALL_KART_NUMBERS) {
      const entries = byKart.get(kartNum) || [];
      // Group by pilot, take best per pilot
      const pilotBest = new Map<string, { pilot: string; bestLap: string; bestLapSec: number }>();
      for (const e of entries) {
        const prev = pilotBest.get(e.pilot);
        if (!prev || e.bestLapSec < prev.bestLapSec) pilotBest.set(e.pilot, e);
      }
      const top5 = [...pilotBest.values()].sort((a, b) => a.bestLapSec - b.bestLapSec).slice(0, 5);
      stats.push({ number: kartNum, top5 });
    }

    return stats;
  }, [statSessions]);

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

        {/* Filtered sessions */}
        <div>
          <button onClick={toggleShowFiltered}
            className="flex items-center gap-1.5 text-dark-400 text-xs hover:text-white transition-colors">
            <span className={`text-[8px] transition-transform ${showFiltered ? 'rotate-90' : ''}`}>▶</span>
            Знайдено заїздів: {filteredSessions.length}
          </button>

          {showFiltered && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 mb-1">
                <button onClick={() => setSelectedForAdd(new Set(filteredSessions.map(e => e.id)))}
                  className="text-dark-400 text-[10px] hover:text-white transition-colors">виділити всі</button>
                <span className="text-dark-700">|</span>
                <button onClick={() => setSelectedForAdd(new Set())}
                  className="text-dark-400 text-[10px] hover:text-white transition-colors">зняти всі</button>
              </div>

              <SessionCheckboxRows events={filteredSessions} selected={selectedForAdd} showDate
                onToggle={(id, checked) => {
                  const next = new Set(selectedForAdd);
                  checked ? next.add(id) : next.delete(id);
                  setSelectedForAdd(next);
                }} />

              {filteredSessions.length > 0 && (
                <button onClick={addToStats}
                  className="mt-2 px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-500 transition-colors">
                  Додати до статистики ({selectedForAdd.size})
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stats sessions — always visible */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Заїзди для статистики ({statSessions.length})
          </div>
          {statSessions.length > 0 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedToRemove(new Set(statSessions.map(e => e.id)))}
                className="text-dark-400 text-[10px] hover:text-white transition-colors">виділити всі</button>
              <span className="text-dark-700">|</span>
              <button onClick={() => setSelectedToRemove(new Set())}
                className="text-dark-400 text-[10px] hover:text-white transition-colors">зняти всі</button>
              <span className="text-dark-700">|</span>
              <button onClick={clearAllStats}
                className="text-red-400/60 text-[10px] hover:text-red-400 transition-colors">очистити</button>
            </div>
          )}
        </div>

        {statSessions.length === 0 ? (
          <div className="text-dark-600 text-xs py-2">Немає заїздів. Додайте через фільтр вище.</div>
        ) : (
          <div className="space-y-0.5">
            <SessionCheckboxRows events={statSessions} selected={selectedToRemove} showDate
              onToggle={(id, checked) => {
                const next = new Set(selectedToRemove);
                checked ? next.add(id) : next.delete(id);
                setSelectedToRemove(next);
              }} />
          </div>
        )}

        {selectedToRemove.size > 0 && (
          <button onClick={removeFromStats}
            className="px-3 py-1.5 bg-red-600/20 text-red-400 text-xs rounded-lg hover:bg-red-600/30 transition-colors">
            Видалити ({selectedToRemove.size})
          </button>
        )}
      </div>

      {/* Kart list — computed from stats sessions */}
      {statSessions.length === 0 ? (
        <div className="text-dark-600 text-xs text-center py-4">Додайте заїзди для перегляду статистики картів</div>
      ) : (
        <div className="space-y-0.5">
          {kartStats.filter(k => k.top5.length > 0).map((kart) => {
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
      )}
    </div>
  );
}
