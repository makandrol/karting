import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { toSeconds, KART_COLOR } from '../../utils/timing';
import { useAuth } from '../../services/auth';
import {
  computeGonzalesStandings, gonzalesToStandings,
  parseLapSec, type SessionLap, type CompSession,
  type GonzalesPilotRow, type GonzalesStandingsData,
} from '../../utils/scoring';
import { buildGonzalesRotation, getGonzalesKartForRound, type GonzalesKartSlot } from '../../data/competitions';

interface Props {
  competitionId: string;
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
  liveSessionId: string | null;
  liveEnabled: boolean;
  onToggleLive: () => void;
  initialExcludedPilots?: string[];
  excludedLapKeys?: string[];
  onSaveResults: (partial: Record<string, any>) => Promise<void>;
  gonzalesConfig?: GonzalesConfig;
}

export interface GonzalesConfig {
  kartList?: number[];
  kartReplacements?: Record<number, number>;
  excludedKarts?: number[];
  pilotStartSlots?: Record<string, number>;
  scoringLaps?: number[];
}

type SortKey = 'average' | 'name' | `kart_${number}`;

export default function GonzalesResults({
  competitionId, sessions, sessionLaps, liveSessionId, liveEnabled,
  onToggleLive, initialExcludedPilots, excludedLapKeys, onSaveResults, gonzalesConfig,
}: Props) {
  const { hasPermission, isOwner } = useAuth();
  const canManage = hasPermission('manage_results');

  const [excludedPilots, setExcludedPilots] = useState<Set<string>>(() => new Set(initialExcludedPilots || []));
  const [selectedPilot, setSelectedPilot] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('average');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showKartManager, setShowKartManager] = useState(false);

  const [kartList, setKartList] = useState<number[]>(gonzalesConfig?.kartList || []);
  const [kartReplacements, setKartReplacements] = useState<Record<number, number>>(gonzalesConfig?.kartReplacements || {});
  const [excludedKarts, setExcludedKarts] = useState<Set<number>>(new Set(gonzalesConfig?.excludedKarts || []));
  const [pilotStartSlots, setPilotStartSlots] = useState<Record<string, number>>(gonzalesConfig?.pilotStartSlots || {});
  const [scoringLaps, setScoringLaps] = useState<number[]>(gonzalesConfig?.scoringLaps || [1, 2, 3, 4]);

  const excludedLapSet = useMemo(() => new Set(excludedLapKeys || []), [excludedLapKeys]);
  const effectiveLaps = useMemo(() => {
    if (excludedLapSet.size === 0) return sessionLaps;
    const filtered = new Map<string, SessionLap[]>();
    for (const [sid, laps] of sessionLaps) {
      filtered.set(sid, laps.filter(l => !excludedLapSet.has(`${sid}|${l.pilot}|${l.ts}`)));
    }
    return filtered;
  }, [sessionLaps, excludedLapSet]);

  const data = useMemo<GonzalesStandingsData>(() => {
    return computeGonzalesStandings({
      sessions, sessionLaps: effectiveLaps, excludedPilots,
      kartList: kartList.length > 0 ? kartList : undefined,
      kartReplacements: Object.keys(kartReplacements).length > 0 ? kartReplacements : undefined,
      excludedKarts: excludedKarts.size > 0 ? excludedKarts : undefined,
      scoringLaps: scoringLaps.length > 0 ? scoringLaps : undefined,
      pilotStartSlots: Object.keys(pilotStartSlots).length > 0 ? pilotStartSlots : undefined,
    });
  }, [sessions, effectiveLaps, excludedPilots, kartList, kartReplacements, excludedKarts, scoringLaps, pilotStartSlots]);

  const sortedRows = useMemo(() => {
    const rows = [...data.rows];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'average') {
        if (a.averageTime === null && b.averageTime === null) cmp = 0;
        else if (a.averageTime === null) cmp = 1;
        else if (b.averageTime === null) cmp = -1;
        else cmp = a.averageTime - b.averageTime;
      } else if (sortKey === 'name') {
        cmp = a.pilot.localeCompare(b.pilot, 'uk');
      } else if (sortKey.startsWith('kart_')) {
        const ki = data.karts.indexOf(parseInt(sortKey.slice(5)));
        if (ki >= 0) {
          const ta = a.kartResults[ki]?.bestTime ?? Infinity;
          const tb = b.kartResults[ki]?.bestTime ?? Infinity;
          cmp = ta - tb;
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  useEffect(() => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      const standings = gonzalesToStandings(dataRef.current, excludedPilots);
      onSaveResults({ standings });
    }, 10000);
    return () => { if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current); };
  }, [data, excludedPilots]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleExcludePilot = async (pilot: string) => {
    const next = new Set(excludedPilots);
    next.has(pilot) ? next.delete(pilot) : next.add(pilot);
    setExcludedPilots(next);
    await onSaveResults({ excludedPilots: [...next] });
  };

  const saveGonzalesConfig = useCallback(async (partial: Partial<GonzalesConfig>) => {
    const cfg: GonzalesConfig = {
      kartList,
      kartReplacements,
      excludedKarts: [...excludedKarts],
      pilotStartSlots,
      scoringLaps,
      ...partial,
    };
    await onSaveResults({ gonzalesConfig: cfg });
  }, [kartList, kartReplacements, excludedKarts, pilotStartSlots, scoringLaps, onSaveResults]);

  const pilotCount = data.rows.length + excludedPilots.size;
  const roundCount = Math.max(pilotCount, 12);
  const roundSessions = sessions.filter(s => s.phase && !s.phase.startsWith('qualifying'));

  const effectiveKarts = kartList.length > 0 ? kartList : data.karts;
  const slots = useMemo(() => buildGonzalesRotation(effectiveKarts, pilotCount), [effectiveKarts, pilotCount]);

  const getStartKartIndex = useCallback((startSlot: number): number | null => {
    if (startSlot < 0 || slots.length === 0) return null;
    const slot = slots[startSlot];
    if (slot && slot.kart !== null) {
      return data.karts.indexOf(slot.kart);
    }
    // Skip — find the kart before the skip in the slot list
    for (let i = startSlot - 1; i >= 0; i--) {
      if (slots[i].kart !== null) return data.karts.indexOf(slots[i].kart!);
    }
    // Wrap around
    for (let i = slots.length - 1; i > startSlot; i--) {
      if (slots[i].kart !== null) return data.karts.indexOf(slots[i].kart!);
    }
    return null;
  }, [slots, data.karts]);

  const toggleScoringLap = (lap: number) => {
    const next = scoringLaps.includes(lap) ? scoringLaps.filter(l => l !== lap) : [...scoringLaps, lap].sort((a, b) => a - b);
    setScoringLaps(next);
    saveGonzalesConfig({ scoringLaps: next });
  };

  if (data.rows.length === 0 && sessions.length === 0) {
    return <div className="card text-center py-12 text-dark-500">Немає даних</div>;
  }

  const SortArrow = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null;
    return <span className="ml-0.5 text-primary-400">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const SORT_HL = 'bg-primary-600/10';

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <div className="flex items-center gap-1">
          <span className="text-dark-500 text-[10px] font-semibold uppercase">Сорт:</span>
          {(['average', 'name'] as SortKey[]).map(k => (
            <button key={k} onClick={() => handleSort(k)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${sortKey === k ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-500 hover:text-dark-300'}`}>
              {k === 'average' ? 'Середнє' : 'Імʼя'}
            </button>
          ))}
        </div>
        <button onClick={onToggleLive}
          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${liveEnabled ? 'bg-green-600/20 text-green-400' : 'bg-dark-800 text-dark-500'}`}>
          ● LIVE
        </button>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-dark-700 bg-dark-800/50">
          <span className="text-dark-500 text-[10px] font-semibold uppercase">Залікові кола:</span>
          {[1, 2, 3, 4].map(lap => (
            <label key={lap} className="flex items-center gap-0.5 cursor-pointer">
              <input type="checkbox" checked={scoringLaps.includes(lap)}
                onChange={() => toggleScoringLap(lap)}
                className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0 focus:ring-offset-0 cursor-pointer" />
              <span className={`text-[10px] ${scoringLaps.includes(lap) ? 'text-primary-400' : 'text-dark-600'}`}>{lap}</span>
            </label>
          ))}
        </div>
        {canManage && (
          <button onClick={() => setShowKartManager(v => !v)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${showKartManager ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-500 hover:text-dark-300'}`}>
            Карти
          </button>
        )}
        <span className="text-dark-600 text-[10px]">
          {data.rows.length} пілотів · {data.karts.length} картів · {roundSessions.length}/{roundCount} раундів
        </span>
      </div>

      {/* Kart Manager */}
      {showKartManager && canManage && (
        <KartManager
          karts={data.karts}
          kartList={kartList}
          setKartList={(kl) => { setKartList(kl); saveGonzalesConfig({ kartList: kl }); }}
          kartReplacements={kartReplacements}
          setKartReplacements={(kr) => { setKartReplacements(kr); saveGonzalesConfig({ kartReplacements: kr }); }}
          excludedKarts={excludedKarts}
          setExcludedKarts={(ek) => { setExcludedKarts(ek); saveGonzalesConfig({ excludedKarts: [...ek] as any }); }}
          pilotCount={pilotCount}
          pilots={data.rows.map(r => r.pilot)}
          pilotStartSlots={pilotStartSlots}
          setPilotStartSlots={(ps) => { setPilotStartSlots(ps); saveGonzalesConfig({ pilotStartSlots: ps }); }}
        />
      )}

      {/* Results table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-center w-6" rowSpan={2}>#</th>
                <th className={`table-cell text-left min-w-[100px] cursor-pointer hover:text-white ${sortKey === 'name' ? SORT_HL : ''}`}
                  onClick={() => handleSort('name')} rowSpan={2}>
                  Пілот<SortArrow k="name" />
                </th>
                {data.karts.map(k => (
                  <th key={k} colSpan={2}
                    className={`table-cell text-center cursor-pointer hover:text-white ${KART_COLOR} ${sortKey === `kart_${k}` ? SORT_HL : ''} ${excludedKarts.has(k) ? 'opacity-40' : ''}`}
                    onClick={() => handleSort(`kart_${k}`)}>
                    {k}<SortArrow k={`kart_${k}`} />
                  </th>
                ))}
                <th className={`table-cell text-center min-w-[65px] font-bold cursor-pointer hover:text-white ${sortKey === 'average' ? SORT_HL : ''}`}
                  onClick={() => handleSort('average')} rowSpan={2}>
                  Сер.<SortArrow k="average" />
                </th>
                {canManage && <th className="table-cell text-center w-6" rowSpan={2}></th>}
              </tr>
              <tr className="table-header">
                {data.karts.map(k => (
                  <React.Fragment key={k}>
                    <th className={`table-cell text-center text-[8px] text-dark-600 font-normal min-w-[48px] ${excludedKarts.has(k) ? 'opacity-40' : ''}`}>час</th>
                    <th className={`table-cell text-center text-[8px] text-dark-600 font-normal w-[28px] ${excludedKarts.has(k) ? 'opacity-40' : ''}`}>м.</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => {
                const isSelected = selectedPilot === r.pilot;
                const startKartIdx = getStartKartIndex(r.startSlot);
                return (
                  <tr key={r.pilot}
                    onClick={() => setSelectedPilot(isSelected ? null : r.pilot)}
                    className={`table-row cursor-pointer ${isSelected ? 'bg-primary-600/10' : ''} active:bg-dark-700/30`}>
                    <td className="table-cell text-center font-mono text-white font-bold">{i + 1}</td>
                    <td className="table-cell text-left text-white whitespace-nowrap">{r.pilot}</td>
                    {r.kartResults.map((kr, ki) => {
                      const isStartKart = startKartIdx === ki;
                      const colHighlight = sortKey === `kart_${data.karts[ki]}` ? SORT_HL : '';
                      const excluded = excludedKarts.has(data.karts[ki]) ? 'opacity-40' : '';
                      if (kr.bestTime === null) {
                        return (
                          <React.Fragment key={ki}>
                            <td className={`table-cell text-center text-dark-700 ${colHighlight} ${excluded}`}>—</td>
                            <td className={`table-cell text-center text-dark-700 ${colHighlight} ${excluded} ${isStartKart ? 'bg-yellow-500/20' : ''}`}>—</td>
                          </React.Fragment>
                        );
                      }
                      const isBestOnKart = data.overallBestPerKart[ki] !== null && Math.abs(kr.bestTime - data.overallBestPerKart[ki]!) < 0.002;
                      const isBestOfPilot = r.kartResults.every(
                        other => other.bestTime === null || kr.bestTime! <= other.bestTime
                      );
                      const timeColor = isBestOnKart ? 'text-purple-400 font-bold' : isBestOfPilot ? 'text-green-400' : 'text-dark-300';
                      return (
                        <React.Fragment key={ki}>
                          <td className={`table-cell text-center font-mono ${timeColor} ${colHighlight} ${excluded}`}>
                            {toSeconds(kr.bestTimeStr!)}
                          </td>
                          <td className={`table-cell text-center font-mono text-dark-500 ${colHighlight} ${excluded} ${isStartKart ? 'bg-yellow-500/20 text-yellow-300' : ''}`}>
                            {kr.place ?? '—'}
                          </td>
                        </React.Fragment>
                      );
                    })}
                    <td className={`table-cell text-center font-mono font-bold ${
                      i === 0 && r.averageTime !== null ? 'text-purple-400' : r.averageTime !== null ? 'text-green-400' : 'text-dark-700'
                    } ${sortKey === 'average' ? SORT_HL : ''}`}>
                      {r.averageTime !== null ? r.averageTime.toFixed(3) : '—'}
                    </td>
                    {canManage && (
                      <td className="table-cell text-center">
                        <button onClick={(e) => { e.stopPropagation(); toggleExcludePilot(r.pilot); }}
                          className="text-dark-600 hover:text-red-400 text-[10px]" title="Виключити пілота">
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Excluded pilots */}
      {excludedPilots.size > 0 && (
        <div className="px-1 text-[10px] text-dark-600">
          Виключені: {[...excludedPilots].map(p => (
            <span key={p} className="inline-flex items-center gap-0.5 mr-2">
              {p}
              {canManage && (
                <button onClick={() => toggleExcludePilot(p)} className="text-dark-500 hover:text-green-400">↩</button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Kart Manager sub-component
// ============================================================

function KartManager({ karts, kartList, setKartList, kartReplacements, setKartReplacements,
  excludedKarts, setExcludedKarts, pilotCount, pilots, pilotStartSlots, setPilotStartSlots }: {
  karts: number[];
  kartList: number[];
  setKartList: (kl: number[]) => void;
  kartReplacements: Record<number, number>;
  setKartReplacements: (kr: Record<number, number>) => void;
  excludedKarts: Set<number>;
  setExcludedKarts: (ek: Set<number>) => void;
  pilotCount: number;
  pilots: string[];
  pilotStartSlots: Record<string, number>;
  setPilotStartSlots: (ps: Record<string, number>) => void;
}) {
  const [newKart, setNewKart] = useState('');
  const [replFrom, setReplFrom] = useState('');
  const [replTo, setReplTo] = useState('');

  const effectiveKarts = kartList.length > 0 ? kartList : karts;
  const slots = buildGonzalesRotation(effectiveKarts, pilotCount);

  const addKart = () => {
    const k = parseInt(newKart);
    if (isNaN(k) || k <= 0) return;
    const next = [...(kartList.length > 0 ? kartList : karts), k].sort((a, b) => a - b);
    setKartList([...new Set(next)]);
    setNewKart('');
  };

  const removeKart = (k: number) => {
    const base = kartList.length > 0 ? kartList : karts;
    setKartList(base.filter(x => x !== k));
  };

  const addReplacement = () => {
    const from = parseInt(replFrom);
    const to = parseInt(replTo);
    if (isNaN(from) || isNaN(to) || from <= 0 || to <= 0) return;
    setKartReplacements({ ...kartReplacements, [from]: to });
    setReplFrom('');
    setReplTo('');
  };

  const removeReplacement = (from: number) => {
    const next = { ...kartReplacements };
    delete next[from];
    setKartReplacements(next);
  };

  const toggleExcludeKart = (k: number) => {
    const next = new Set(excludedKarts);
    next.has(k) ? next.delete(k) : next.add(k);
    setExcludedKarts(next);
  };

  const [dragPilot, setDragPilot] = useState<string | null>(null);

  return (
    <div className="card p-3 space-y-3 text-xs">
      <h4 className="text-white font-semibold text-sm">Управління картами</h4>

      {/* Kart list */}
      <div>
        <div className="text-dark-500 text-[10px] font-semibold uppercase mb-1">Карти ({effectiveKarts.length})</div>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {effectiveKarts.map(k => (
            <div key={k} className={`flex items-center gap-1 px-2 py-0.5 rounded ${excludedKarts.has(k) ? 'bg-dark-900 opacity-50' : 'bg-dark-800'}`}>
              <span className={KART_COLOR}>{k}</span>
              <button onClick={() => toggleExcludeKart(k)}
                className={`text-[9px] ${excludedKarts.has(k) ? 'text-green-400' : 'text-dark-600 hover:text-red-400'}`}
                title={excludedKarts.has(k) ? 'Включити в середнє' : 'Виключити з середнього'}>
                {excludedKarts.has(k) ? '↩' : '✕'}
              </button>
              <button onClick={() => removeKart(k)} className="text-[9px] text-dark-700 hover:text-red-400" title="Видалити">×</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input type="number" value={newKart} onChange={e => setNewKart(e.target.value)}
            placeholder="Номер карту"
            className="w-20 bg-dark-800 rounded px-2 py-0.5 text-dark-300 outline-none border border-dark-700 focus:border-primary-500" />
          <button onClick={addKart} className="px-2 py-0.5 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 transition-colors">+</button>
        </div>
      </div>

      {/* Replacements */}
      <div>
        <div className="text-dark-500 text-[10px] font-semibold uppercase mb-1">Заміни картів</div>
        {Object.entries(kartReplacements).length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {Object.entries(kartReplacements).map(([from, to]) => (
              <div key={from} className="flex items-center gap-1 px-2 py-0.5 rounded bg-dark-800">
                <span className={KART_COLOR}>{from}</span>
                <span className="text-dark-600">→</span>
                <span className={KART_COLOR}>{to}</span>
                <button onClick={() => removeReplacement(parseInt(from))} className="text-[9px] text-dark-600 hover:text-red-400">✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <input type="number" value={replFrom} onChange={e => setReplFrom(e.target.value)}
            placeholder="Зламаний"
            className="w-16 bg-dark-800 rounded px-2 py-0.5 text-dark-300 outline-none border border-dark-700 focus:border-primary-500" />
          <span className="text-dark-600">→</span>
          <input type="number" value={replTo} onChange={e => setReplTo(e.target.value)}
            placeholder="Заміна"
            className="w-16 bg-dark-800 rounded px-2 py-0.5 text-dark-300 outline-none border border-dark-700 focus:border-primary-500" />
          <button onClick={addReplacement} className="px-2 py-0.5 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 transition-colors">+</button>
        </div>
      </div>

      {/* Rotation / Starting slots */}
      <div>
        <div className="text-dark-500 text-[10px] font-semibold uppercase mb-1">
          Ротаційний список ({slots.length} позицій: {effectiveKarts.length} картів + {Math.max(0, pilotCount - effectiveKarts.length)} пропусків)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="table-header">
                <th className="table-cell text-left min-w-[100px]">Пілот</th>
                <th className="table-cell text-center w-10">Поз.</th>
                {slots.map(s => (
                  <th key={s.position} className={`table-cell text-center min-w-[40px] ${s.kart === null ? 'text-dark-600' : KART_COLOR}`}>
                    {s.kart !== null ? s.kart : `П${s.position - effectiveKarts.length}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pilots.map(pilot => {
                const startSlot = pilotStartSlots[pilot] ?? -1;
                return (
                  <tr key={pilot} className="table-row"
                    draggable
                    onDragStart={() => setDragPilot(pilot)}
                    onDragEnd={() => setDragPilot(null)}>
                    <td className="table-cell text-left text-white whitespace-nowrap cursor-grab">{pilot}</td>
                    <td className="table-cell text-center">
                      <input type="number" min={1} max={slots.length}
                        value={startSlot >= 0 ? startSlot + 1 : ''}
                        onChange={e => {
                          const v = parseInt(e.target.value);
                          if (!isNaN(v) && v >= 1 && v <= slots.length) {
                            const next = { ...pilotStartSlots, [pilot]: v - 1 };
                            setPilotStartSlots(next);
                          }
                        }}
                        className="w-8 bg-dark-800 rounded px-1 py-0 text-center text-dark-300 outline-none border border-dark-700 focus:border-primary-500" />
                    </td>
                    {slots.map((s, si) => {
                      const isAssigned = startSlot === si;
                      const roundIdx = startSlot >= 0
                        ? slots.map((_, ri) => getGonzalesKartForRound(slots, startSlot, ri))
                        : [];
                      const kartForThisRound = startSlot >= 0 ? getGonzalesKartForRound(slots, startSlot, si) : null;
                      const isSkip = kartForThisRound?.kart === null;
                      return (
                        <td key={si}
                          className={`table-cell text-center ${isAssigned ? 'bg-primary-600/20 text-primary-400 font-bold' : isSkip ? 'text-dark-700' : 'text-dark-500'}`}
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => {
                            if (dragPilot) {
                              const next = { ...pilotStartSlots, [dragPilot]: si };
                              setPilotStartSlots(next);
                            }
                          }}>
                          {isAssigned ? '●' : ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
