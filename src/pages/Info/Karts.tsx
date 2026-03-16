import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ALL_COMPETITION_EVENTS } from '../../mock/competitionEvents';
import { SessionCheckboxRows } from '../../components/Sessions/SessionRows';
import { ALL_KART_NUMBERS } from '../../mock/timingData';

const LS_DISABLED_KARTS = 'karting_disabled_karts';

function loadDisabledKarts(): Set<number> {
  try {
    const saved = localStorage.getItem(LS_DISABLED_KARTS);
    if (saved) return new Set(JSON.parse(saved));
  } catch { /* ignore */ }
  return new Set();
}

function saveDisabledKarts(set: Set<number>) {
  localStorage.setItem(LS_DISABLED_KARTS, JSON.stringify([...set]));
}

export default function Karts() {
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

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

  // Default: all today's sessions in stats
  const [statSessionIds, setStatSessionIds] = useState<Set<string>>(() => {
    const todayEvents = ALL_COMPETITION_EVENTS.filter(ev => ev.date === new Date().toISOString().split('T')[0]);
    return new Set(todayEvents.map(e => e.id));
  });

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

  // Disabled karts (persisted in localStorage)
  const [disabledKarts, setDisabledKarts] = useState<Set<number>>(loadDisabledKarts);
  const [showDisabled, setShowDisabled] = useState(false);

  useEffect(() => { saveDisabledKarts(disabledKarts); }, [disabledKarts]);

  const toggleKartDisabled = (num: number) => {
    const next = new Set(disabledKarts);
    next.has(num) ? next.delete(num) : next.add(num);
    setDisabledKarts(next);
  };

  // Compute kart stats from selected stat sessions
  const kartStats = useMemo(() => {
    const byKart = new Map<number, { pilot: string; bestLap: string; bestLapSec: number }[]>();

    for (const ev of statSessions) {
      for (const phase of ev.phases) {
        for (const result of phase.results) {
          if (!result.kart || result.kart === 0) continue;
          if (!byKart.has(result.kart)) byKart.set(result.kart, []);
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

    const stats: { number: number; top5: { pilot: string; bestLap: string; bestLapSec: number }[] }[] = [];

    for (const kartNum of ALL_KART_NUMBERS) {
      const entries = byKart.get(kartNum) || [];
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

  const activeKarts = kartStats.filter(k => !disabledKarts.has(k.number));
  const inactiveKarts = kartStats.filter(k => disabledKarts.has(k.number));

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

      {/* Kart list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Карти ({activeKarts.length} активних{inactiveKarts.length > 0 ? `, ${inactiveKarts.length} прихованих` : ''})
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex bg-dark-800 rounded-md p-0.5 mr-2">
              <button onClick={() => setViewMode('list')}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
                ☰
              </button>
              <button onClick={() => setViewMode('grid')}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${viewMode === 'grid' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>
                ▦
              </button>
            </div>
            <button onClick={() => { setDisabledKarts(new Set()); }}
              className="text-dark-400 text-[10px] hover:text-white transition-colors">показати всі</button>
            <span className="text-dark-700">|</span>
            <button onClick={() => setShowDisabled(v => !v)}
              className="text-dark-400 text-[10px] hover:text-white transition-colors">
              {showDisabled ? 'сховати неактивні' : 'показати неактивні'}
            </button>
          </div>
        </div>

        {viewMode === 'list' ? (
          <>
            <div className="space-y-0.5">
              {activeKarts.map((kart) => (
                <KartRow key={kart.number} kart={kart}
                  onDisable={() => toggleKartDisabled(kart.number)} disabled={false} />
              ))}
            </div>
            {showDisabled && inactiveKarts.length > 0 && (
              <div className="mt-3 space-y-0.5 opacity-50">
                <div className="text-dark-500 text-[10px] uppercase tracking-wider px-1 pb-1">Неактивні</div>
                {inactiveKarts.map((kart) => (
                  <KartRow key={kart.number} kart={kart}
                    onDisable={() => toggleKartDisabled(kart.number)} disabled />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-2">
              {activeKarts.map((kart) => (
                <KartCard key={kart.number} kart={kart} disabled={false}
                  onDisable={() => toggleKartDisabled(kart.number)} />
              ))}
            </div>
            {showDisabled && inactiveKarts.length > 0 && (
              <div className="mt-3 opacity-50">
                <div className="text-dark-500 text-[10px] uppercase tracking-wider px-1 pb-2">Неактивні</div>
                <div className="grid grid-cols-5 gap-2">
                  {inactiveKarts.map((kart) => (
                    <KartCard key={kart.number} kart={kart} disabled
                      onDisable={() => toggleKartDisabled(kart.number)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function KartRow({ kart, onDisable, disabled }: {
  kart: { number: number; top5: { pilot: string; bestLap: string; bestLapSec: number }[] };
  onDisable: () => void; disabled: boolean;
}) {
  const top3 = kart.top5.slice(0, 3);
  return (
    <div className="flex items-start group">
      <Link to={`/info/karts/${kart.number}`}
        className={`flex-1 flex items-start gap-4 px-3 py-2 rounded-lg hover:bg-dark-700/50 transition-colors`}>
        <span className={`font-mono font-bold text-sm w-8 shrink-0 pt-0.5 ${disabled ? 'text-dark-600' : 'text-dark-300'}`}>
          #{kart.number}
        </span>
        <div className="flex-1 space-y-0.5">
          {top3.length > 0 ? top3.map((r, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <span>
                <span className={`font-mono font-bold mr-1.5 ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : 'text-amber-600'}`}>{idx + 1}</span>
                <span className="font-mono text-green-400">{r.bestLap}</span>
                <span className="text-dark-500 ml-1.5">{r.pilot.split(' ')[0]}</span>
              </span>
            </div>
          )) : (
            <div className="text-dark-700 text-xs">—</div>
          )}
        </div>
      </Link>
      <button onClick={onDisable} title={disabled ? 'Активувати' : 'Деактивувати'}
        className={`px-2 py-2 text-[10px] rounded transition-colors shrink-0 ${
          disabled ? 'text-green-400/50 hover:text-green-400' : 'text-dark-700 hover:text-red-400'
        }`}>
        {disabled ? '✓' : '✕'}
      </button>
    </div>
  );
}

function KartCard({ kart, disabled, onDisable }: {
  kart: { number: number; top5: { pilot: string; bestLap: string; bestLapSec: number }[] };
  disabled: boolean; onDisable: () => void;
}) {
  const top3 = kart.top5.slice(0, 3);
  return (
    <Link to={`/info/karts/${kart.number}`}
      className={`relative block rounded-xl border p-3 transition-colors ${
        disabled ? 'border-dark-800 bg-dark-900/50' : 'border-dark-700 bg-dark-800/50 hover:border-dark-600 hover:bg-dark-700/50'
      }`}
    >
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDisable(); }}
        className={`absolute top-1 right-1 text-[10px] px-1 rounded transition-colors ${
          disabled ? 'text-green-400/50 hover:text-green-400' : 'text-dark-700 hover:text-red-400'
        }`}>
        {disabled ? '✓' : '✕'}
      </button>
      <div className={`font-mono font-bold text-lg text-center mb-1.5 ${disabled ? 'text-dark-600' : 'text-white'}`}>
        {kart.number}
      </div>
      <div className="space-y-0.5">
        {top3.length > 0 ? top3.map((r, idx) => (
          <div key={idx} className="text-[10px] leading-tight">
            <span className="font-mono text-green-400">{r.bestLap}</span>
            <span className="text-dark-500"> - {r.pilot.split(' ')[0]}</span>
          </div>
        )) : (
          <div className="text-dark-700 text-[10px] text-center">—</div>
        )}
      </div>
    </Link>
  );
}
