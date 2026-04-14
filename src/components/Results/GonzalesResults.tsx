import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { toSeconds, KART_COLOR } from '../../utils/timing';
import { useAuth } from '../../services/auth';
import {
  computeGonzalesStandings, gonzalesToStandings,
  parseLapSec, type SessionLap, type CompSession,
  type GonzalesPilotRow, type GonzalesStandingsData,
} from '../../utils/scoring';
import { buildGonzalesRotation } from '../../data/competitions';

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
  onPilotCount?: (n: number) => void;
  onAutoGroups?: (n: number) => void;
  showKartManager?: boolean;
}

export interface GonzalesConfig {
  kartList?: number[];
  kartReplacements?: Record<number, number>;
  excludedKarts?: number[];
  pilotStartSlots?: Record<string, number>;
  scoringLaps?: number[];
  slotOrder?: (number | null)[];
}

type SortKey = 'average' | 'name' | `kart_${number}`;

export default function GonzalesResults({
  competitionId, sessions, sessionLaps, liveSessionId, liveEnabled,
  onToggleLive, initialExcludedPilots, excludedLapKeys, onSaveResults, gonzalesConfig,
  onPilotCount, onAutoGroups, showKartManager = false,
}: Props) {
  const { hasPermission, isOwner } = useAuth();
  const canManage = hasPermission('manage_results');

  const [excludedPilots, setExcludedPilots] = useState<Set<string>>(() => new Set(initialExcludedPilots || []));
  const [selectedPilot, setSelectedPilot] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('average');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [kartList, setKartList] = useState<number[]>(gonzalesConfig?.kartList || []);
  const [kartReplacements, setKartReplacements] = useState<Record<number, number>>(gonzalesConfig?.kartReplacements || {});
  const [excludedKarts, setExcludedKarts] = useState<Set<number>>(new Set(gonzalesConfig?.excludedKarts || []));
  const [pilotStartSlots, setPilotStartSlots] = useState<Record<string, number>>(gonzalesConfig?.pilotStartSlots || {});
  const [scoringLaps, setScoringLaps] = useState<number[]>(gonzalesConfig?.scoringLaps || [1, 2]);
  const [slotOrder, setSlotOrder] = useState<(number | null)[] | undefined>(gonzalesConfig?.slotOrder);

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
      slotOrder,
    });
  }, [sessions, effectiveLaps, excludedPilots, kartList, kartReplacements, excludedKarts, scoringLaps, pilotStartSlots, slotOrder]);

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
      slotOrder,
      ...partial,
    };
    await onSaveResults({ gonzalesConfig: cfg });
  }, [kartList, kartReplacements, excludedKarts, pilotStartSlots, scoringLaps, slotOrder, onSaveResults]);

  // Derive pilot count from qualifying sessions
  const qualifyingPilots = useMemo(() => {
    const pilots = new Set<string>();
    for (const s of sessions) {
      if (!s.phase || !s.phase.startsWith('qualifying')) continue;
      const laps = sessionLaps.get(s.sessionId) || [];
      for (const l of laps) pilots.add(l.pilot);
    }
    return pilots;
  }, [sessions, sessionLaps]);

  const pilotCount = qualifyingPilots.size > 0
    ? [...qualifyingPilots].filter(p => !excludedPilots.has(p)).length
    : data.rows.length;
  const roundCount = Math.max(pilotCount, 12);
  const roundSessions = sessions.filter(s => s.phase && !s.phase.startsWith('qualifying'));

  useEffect(() => {
    if (pilotCount > 0) onPilotCount?.(pilotCount);
  }, [pilotCount, onPilotCount]);

  useEffect(() => {
    if (roundCount > 0) onSaveResults({ gonzalesRoundCount: roundCount });
  }, [roundCount]);

  const autoGroupCount = useMemo(() => {
    const qualiSessions = sessions.filter(s => s.phase?.startsWith('qualifying'));
    return Math.max(qualiSessions.length, 1);
  }, [sessions]);

  useEffect(() => {
    onAutoGroups?.(autoGroupCount);
  }, [autoGroupCount, onAutoGroups]);

  const effectiveKarts = kartList.length > 0 ? kartList : data.karts;
  const slots = useMemo(() => buildGonzalesRotation(effectiveKarts, pilotCount, slotOrder), [effectiveKarts, pilotCount, slotOrder]);

  const getStartKartIndex = useCallback((startSlot: number): number | null => {
    if (startSlot < 0 || slots.length === 0) return null;
    const slot = slots[startSlot];
    if (slot && slot.kart !== null) {
      return data.karts.indexOf(slot.kart);
    }
    for (let i = Math.min(startSlot - 1, slots.length - 1); i >= 0; i--) {
      if (slots[i]?.kart !== null) return data.karts.indexOf(slots[i].kart!);
    }
    for (let i = slots.length - 1; i > startSlot; i--) {
      if (slots[i]?.kart !== null) return data.karts.indexOf(slots[i].kart!);
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
          {[1, 2, 3].map(lap => (
            <label key={lap} className="flex items-center gap-0.5 cursor-pointer">
              <input type="checkbox" checked={scoringLaps.includes(lap)}
                onChange={() => toggleScoringLap(lap)}
                className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0 focus:ring-offset-0 cursor-pointer" />
              <span className={`text-[10px] ${scoringLaps.includes(lap) ? 'text-primary-400' : 'text-dark-600'}`}>{lap}</span>
            </label>
          ))}
        </div>
        <span className="text-dark-600 text-[10px]">
          {pilotCount} пілотів · {data.karts.length} картів · {roundSessions.length}/{roundCount} гонок
        </span>
      </div>

      {/* Kart Manager */}
      {showKartManager && canManage && (
        <PilotKartAssignment
          autoKarts={data.karts}
          kartList={kartList}
          setKartList={(kl) => { setKartList(kl); saveGonzalesConfig({ kartList: kl }); }}
          kartReplacements={kartReplacements}
          setKartReplacements={(kr) => { setKartReplacements(kr); saveGonzalesConfig({ kartReplacements: kr }); }}
          excludedKarts={excludedKarts}
          setExcludedKarts={(ek) => { setExcludedKarts(ek); saveGonzalesConfig({ excludedKarts: [...ek] as any }); }}
          pilotCount={pilotCount}
          allPilots={[...qualifyingPilots].filter(p => !excludedPilots.has(p))}
          pilotStartSlots={pilotStartSlots}
          setPilotStartSlots={(ps) => { setPilotStartSlots(ps); saveGonzalesConfig({ pilotStartSlots: ps }); }}
          slotOrder={slotOrder}
          setSlotOrder={(so) => { setSlotOrder(so); saveGonzalesConfig({ slotOrder: so }); }}
          onExcludePilot={toggleExcludePilot}
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
// Pilot-Kart Assignment sub-component
// ============================================================

function PilotKartAssignment({ autoKarts, kartList, setKartList, kartReplacements, setKartReplacements,
  excludedKarts, setExcludedKarts, pilotCount, allPilots, pilotStartSlots, setPilotStartSlots,
  slotOrder, setSlotOrder, onExcludePilot }: {
  autoKarts: number[];
  kartList: number[];
  setKartList: (kl: number[]) => void;
  kartReplacements: Record<number, number>;
  setKartReplacements: (kr: Record<number, number>) => void;
  excludedKarts: Set<number>;
  setExcludedKarts: (ek: Set<number>) => void;
  pilotCount: number;
  allPilots: string[];
  pilotStartSlots: Record<string, number>;
  setPilotStartSlots: (ps: Record<string, number>) => void;
  slotOrder: (number | null)[] | undefined;
  setSlotOrder: (so: (number | null)[] | undefined) => void;
  onExcludePilot: (pilot: string) => void;
}) {
  const [newKart, setNewKart] = useState('');
  const [replFrom, setReplFrom] = useState('');
  const [replTo, setReplTo] = useState('');
  const [dragSlotIdx, setDragSlotIdx] = useState<number | null>(null);
  const [dragPilot, setDragPilot] = useState<string | null>(null);

  const effectiveKarts = kartList.length > 0 ? kartList : autoKarts;

  // Derive effective slotOrder: trim excess skips or add missing ones to match pilotCount
  const effectiveSlotOrder = useMemo((): (number | null)[] | undefined => {
    if (!slotOrder || slotOrder.length === 0) return undefined;
    const neededSkips = Math.max(0, pilotCount - effectiveKarts.length);
    const currentSkips = slotOrder.filter(v => v === null).length;
    if (currentSkips === neededSkips) return slotOrder;

    const result = [...slotOrder];
    if (currentSkips > neededSkips) {
      let toRemove = currentSkips - neededSkips;
      for (let i = result.length - 1; i >= 0 && toRemove > 0; i--) {
        if (result[i] === null) { result.splice(i, 1); toRemove--; }
      }
    } else {
      const toAdd = neededSkips - currentSkips;
      for (let i = 0; i < toAdd; i++) result.push(null);
    }
    return result;
  }, [slotOrder, pilotCount, effectiveKarts.length]);

  const slots = buildGonzalesRotation(effectiveKarts, pilotCount, effectiveSlotOrder);

  const slotToPilot = useMemo(() => {
    const map: Record<number, string> = {};
    for (const [pilot, idx] of Object.entries(pilotStartSlots)) {
      if (allPilots.includes(pilot)) map[idx] = pilot;
    }
    return map;
  }, [pilotStartSlots, allPilots]);

  const assignedPilots = new Set(Object.values(slotToPilot));
  const unassignedPilots = allPilots.filter(p => !assignedPilots.has(p));

  // Auto-assign unassigned pilots to empty slots on first render
  useEffect(() => {
    if (slots.length === 0) return;

    // Clean up stale assignments (indices beyond current slot count)
    const cleaned = { ...pilotStartSlots };
    let didClean = false;
    for (const [pilot, idx] of Object.entries(cleaned)) {
      if (idx >= slots.length || !allPilots.includes(pilot)) {
        delete cleaned[pilot];
        didClean = true;
      }
    }

    if (unassignedPilots.length === 0 && !didClean) return;

    const takenSlots = new Set(Object.values(cleaned));
    const next = { ...cleaned };
    let changed = didClean;
    for (const pilot of allPilots.filter(p => !(p in next))) {
      for (let i = 0; i < slots.length; i++) {
        if (!takenSlots.has(i)) {
          next[pilot] = i;
          takenSlots.add(i);
          changed = true;
          break;
        }
      }
    }
    if (changed) setPilotStartSlots(next);
  }, [allPilots.join(','), slots.length]);

  // Persist trimmed slotOrder back when it differs from stored
  useEffect(() => {
    if (effectiveSlotOrder === slotOrder) return;
    if (!effectiveSlotOrder && !slotOrder) return;
    if (effectiveSlotOrder && slotOrder &&
      effectiveSlotOrder.length === slotOrder.length &&
      effectiveSlotOrder.every((v, i) => v === slotOrder[i])) return;
    setSlotOrder(effectiveSlotOrder);
  }, [effectiveSlotOrder]);

  const currentSlotOrder = (): (number | null)[] => slots.map(s => s.kart);

  const addKart = () => {
    const k = parseInt(newKart);
    if (isNaN(k) || k <= 0) return;
    const base = kartList.length > 0 ? kartList : autoKarts;
    const next = [...new Set([...base, k])].sort((a, b) => a - b);
    setKartList(next);
    setSlotOrder(undefined);
    setNewKart('');
  };

  const removeKart = (k: number) => {
    const base = kartList.length > 0 ? kartList : autoKarts;
    const next = base.filter(x => x !== k);
    setKartList(next);
    const so = currentSlotOrder().filter(v => v !== k);
    setSlotOrder(so.length > 0 ? so : undefined);
    const updatedSlots: Record<string, number> = {};
    for (const [pilot, idx] of Object.entries(pilotStartSlots)) {
      if (slots[idx]?.kart === k) continue;
      const newIdx = so.indexOf(slots[idx]?.kart ?? null);
      if (newIdx >= 0) updatedSlots[pilot] = newIdx;
    }
    setPilotStartSlots(updatedSlots);
  };

  const toggleExcludeKart = (k: number) => {
    const next = new Set(excludedKarts);
    next.has(k) ? next.delete(k) : next.add(k);
    setExcludedKarts(next);
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

  const swapSlots = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const order = currentSlotOrder();
    [order[fromIdx], order[toIdx]] = [order[toIdx], order[fromIdx]];
    setSlotOrder(order);
  };

  const swapPilotRows = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const pilotA = slotToPilot[fromIdx];
    const pilotB = slotToPilot[toIdx];
    const next = { ...pilotStartSlots };
    if (pilotA) next[pilotA] = toIdx;
    if (pilotB) next[pilotB] = fromIdx;
    setPilotStartSlots(next);
  };

  const assignPilotToSlot = (pilot: string, slotIdx: number) => {
    const next = { ...pilotStartSlots };
    const existingPilot = slotToPilot[slotIdx];
    if (existingPilot && existingPilot !== pilot) {
      const oldIdx = pilotStartSlots[pilot];
      if (oldIdx !== undefined) {
        next[existingPilot] = oldIdx;
      } else {
        delete next[existingPilot];
      }
    }
    next[pilot] = slotIdx;
    setPilotStartSlots(next);
  };

  const unassignPilot = (pilot: string) => {
    const next = { ...pilotStartSlots };
    delete next[pilot];
    setPilotStartSlots(next);
  };

  return (
    <div className="card p-3 space-y-3 text-xs">
      <h4 className="text-white font-semibold text-sm">Привʼязка пілотів до початкового карту</h4>

      {/* Two-column assignment table */}
      <div>
        <div className="text-dark-500 text-[10px] font-semibold uppercase mb-1">
          {slots.length} позицій: {effectiveKarts.length} картів + {Math.max(0, pilotCount - effectiveKarts.length)} пропусків
        </div>
        <div style={{ width: 448 }} className="border border-dark-700 rounded overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[200px_248px] bg-dark-800/80 border-b border-dark-700">
            <div className="px-2 py-1 text-dark-500 text-[10px] font-semibold uppercase border-r border-dark-700">Карт</div>
            <div className="px-2 py-1 text-dark-500 text-[10px] font-semibold uppercase">Пілот</div>
          </div>

          {/* Slot rows */}
          {slots.map((slot, si) => {
            const pilot = slotToPilot[si];
            const isSkip = slot.kart === null;
            const replacement = slot.kart !== null ? kartReplacements[slot.kart] : undefined;
            const isExcluded = slot.kart !== null && excludedKarts.has(slot.kart);
            const isFirst = si === 0;
            const isLast = si === slots.length - 1;
            return (
              <div key={si} className={`grid grid-cols-[200px_248px] border-b border-dark-700 last:border-b-0 ${
                isSkip ? 'bg-dark-900/30' : isExcluded ? 'bg-dark-900/50 opacity-60' : ''
              }`}>
                {/* Left: slot + kart actions */}
                <div className={`flex items-center gap-1 px-1 py-1 border-r border-dark-700 cursor-grab select-none ${
                  dragSlotIdx !== null && dragSlotIdx !== si ? 'hover:bg-dark-700/50' : ''
                }`}
                  draggable
                  onDragStart={(e) => { if (dragPilot) return; setDragSlotIdx(si); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => setDragSlotIdx(null)}
                  onDragOver={(e) => { if (dragSlotIdx !== null) e.preventDefault(); }}
                  onDrop={() => { if (dragSlotIdx !== null) { swapSlots(dragSlotIdx, si); setDragSlotIdx(null); } }}
                >
                  <div className="flex flex-col shrink-0">
                    <button onClick={() => !isFirst && swapSlots(si, si - 1)} disabled={isFirst}
                      className={`text-sm leading-none px-0.5 ${isFirst ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▲</button>
                    <button onClick={() => !isLast && swapSlots(si, si + 1)} disabled={isLast}
                      className={`text-sm leading-none px-0.5 ${isLast ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▼</button>
                  </div>
                  {isSkip ? (
                    <span className="text-white font-medium text-xs">{slot.label}</span>
                  ) : (
                    <>
                      <span className={`${KART_COLOR} font-bold text-xs`}>
                        Карт {slot.kart}{replacement ? <span className="text-dark-500 font-normal text-[9px] ml-0.5">→{replacement}</span> : null}
                      </span>
                      <div className="ml-auto flex items-center gap-0.5 shrink-0">
                        <button onClick={() => toggleExcludeKart(slot.kart!)}
                          className={`w-6 h-6 flex items-center justify-center rounded text-sm font-bold ${
                            isExcluded ? 'bg-green-600/20 text-green-400 hover:bg-green-600/40' : 'bg-yellow-600/15 text-yellow-500/60 hover:bg-yellow-600/30 hover:text-yellow-400'
                          }`}
                          title={isExcluded ? 'Включити в середнє' : 'Виключити з середнього'}>
                          {isExcluded ? '↩' : '⊘'}
                        </button>
                        <button onClick={() => removeKart(slot.kart!)}
                          className="w-6 h-6 flex items-center justify-center rounded bg-red-600/15 text-red-400/60 hover:bg-red-600/30 hover:text-red-400 text-sm font-bold"
                          title="Видалити карт">×</button>
                      </div>
                    </>
                  )}
                </div>

                {/* Right: pilot */}
                <div
                  className={`flex items-center gap-1 px-1 py-1 ${!pilot && dragPilot ? 'hover:bg-primary-600/10' : ''}`}
                  onDragOver={(e) => { if (dragPilot) e.preventDefault(); }}
                  onDrop={() => { if (dragPilot) { assignPilotToSlot(dragPilot, si); setDragPilot(null); } }}
                >
                  {pilot ? (
                    <>
                      <div className="flex flex-col shrink-0">
                        <button onClick={() => !isFirst && swapPilotRows(si, si - 1)} disabled={isFirst}
                          className={`text-sm leading-none px-0.5 ${isFirst ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▲</button>
                        <button onClick={() => !isLast && swapPilotRows(si, si + 1)} disabled={isLast}
                          className={`text-sm leading-none px-0.5 ${isLast ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▼</button>
                      </div>
                      <span className="text-white cursor-grab flex-1 text-xs truncate"
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); setDragPilot(pilot); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => setDragPilot(null)}
                      >{pilot}</span>
                      <button onClick={() => onExcludePilot(pilot)}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 text-sm font-bold"
                        title="Виключити пілота">✕</button>
                    </>
                  ) : (
                    <span className="text-dark-700 text-[10px]">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add kart */}
        <div className="flex items-center gap-1.5 mt-2">
          <input type="number" value={newKart} onChange={e => setNewKart(e.target.value)}
            placeholder="Карт №"
            onKeyDown={e => { if (e.key === 'Enter') addKart(); }}
            className="w-36 bg-dark-800 rounded px-2 py-1 text-dark-300 outline-none border border-dark-700 focus:border-primary-500 text-xs" />
          <button onClick={addKart}
            className="px-3 py-1 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 transition-colors text-xs">
            + карт
          </button>
        </div>
      </div>

      {/* Unassigned pilots */}
      {unassignedPilots.length > 0 && (
        <div>
          <div className="text-dark-500 text-[10px] font-semibold uppercase mb-1">
            Непривʼязані пілоти ({unassignedPilots.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {unassignedPilots.map(pilot => (
              <div key={pilot}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-dark-800 cursor-grab"
                draggable
                onDragStart={(e) => { setDragPilot(pilot); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => setDragPilot(null)}
              >
                <span className="text-white text-[10px]">{pilot}</span>
                <button onClick={() => onExcludePilot(pilot)}
                  className="text-[9px] text-dark-600 hover:text-red-400" title="Виключити">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Replacements */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-dark-500 text-[10px] font-semibold uppercase">Заміни картів:</span>
        {Object.entries(kartReplacements).map(([from, to]) => (
          <div key={from} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-dark-800">
            <span className={KART_COLOR}>{from}</span>
            <span className="text-dark-600">→</span>
            <span className={KART_COLOR}>{to}</span>
            <button onClick={() => removeReplacement(parseInt(from))} className="text-[9px] text-dark-600 hover:text-red-400">✕</button>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <input type="number" value={replFrom} onChange={e => setReplFrom(e.target.value)}
            placeholder="Було"
            className="w-12 bg-dark-800 rounded px-1.5 py-0.5 text-dark-300 outline-none border border-dark-700 focus:border-primary-500 text-[10px]" />
          <span className="text-dark-600">→</span>
          <input type="number" value={replTo} onChange={e => setReplTo(e.target.value)}
            placeholder="Стало"
            className="w-12 bg-dark-800 rounded px-1.5 py-0.5 text-dark-300 outline-none border border-dark-700 focus:border-primary-500 text-[10px]" />
          <button onClick={addReplacement} className="px-1.5 py-0.5 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 transition-colors text-[10px]">+</button>
        </div>
      </div>
    </div>
  );
}
