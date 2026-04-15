import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { KART_COLOR } from '../../utils/timing';
import { useAuth } from '../../services/auth';
import { useLayoutPrefs } from '../../services/layoutPrefs';
import { COLLECTOR_URL } from '../../services/config';
import {
  computeGonzalesStandings, gonzalesToStandings,
  type SessionLap, type CompSession,
  type GonzalesPilotRow, type GonzalesStandingsData, type GonzalesKartResult,
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
  onPilotCount, onAutoGroups,
}: Props) {
  const { hasPermission, isOwner } = useAuth();
  const { isSectionVisible } = useLayoutPrefs();
  const canManage = hasPermission('manage_results');

  const [excludedPilots, setExcludedPilots] = useState<Set<string>>(() => new Set(initialExcludedPilots || []));
  const [selectedPilot, setSelectedPilot] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('average');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showBest, setShowBest] = useState(true);
  const [showWorse, setShowWorse] = useState(false);
  const [showTB, setShowTB] = useState(false);
  const [showPos, setShowPos] = useState(true);
  const [showSectors, setShowSectors] = useState(false);

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

  const excludedKartSet = excludedKarts;
  const getRowAverage = useCallback((r: GonzalesPilotRow): number | null => {
    const useWorse = showWorse && !showBest;
    const times: number[] = [];
    for (let ki = 0; ki < r.kartResults.length; ki++) {
      const kr = r.kartResults[ki];
      if (excludedKartSet.has(data.karts[ki])) continue;
      if (kr.bestTime === null) continue;
      if (useWorse && kr.allLaps.length > 1) {
        const best = kr.allLaps.reduce((b, l) => l.time < b.time ? l : b, kr.allLaps[0]);
        const worse = kr.allLaps.reduce((w, l) => l !== best && l.time > w.time ? l : w, kr.allLaps[0]);
        times.push(worse.time);
      } else {
        times.push(kr.bestTime);
      }
    }
    return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
  }, [showBest, showWorse, excludedKartSet, data.karts]);

  const sortedRows = useMemo(() => {
    const rows = [...data.rows];
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'average') {
        const aa = getRowAverage(a);
        const bb = getRowAverage(b);
        if (aa === null && bb === null) cmp = 0;
        else if (aa === null) cmp = 1;
        else if (bb === null) cmp = -1;
        else cmp = aa - bb;
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
  }, [data, sortKey, sortDir, getRowAverage]);

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

  const activePilots = useMemo(() => {
    return [...qualifyingPilots].filter(p => !excludedPilots.has(p));
  }, [qualifyingPilots, excludedPilots]);

  const pilotCount = activePilots.length > 0 ? activePilots.length : data.rows.length;
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

  const getStartKartInfo = useCallback((startSlot: number): { kartIdx: number | null; fromSkip: boolean } => {
    if (startSlot < 0 || slots.length === 0) return { kartIdx: null, fromSkip: false };
    const slot = slots[startSlot];
    if (slot && slot.kart !== null) {
      return { kartIdx: data.karts.indexOf(slot.kart), fromSkip: false };
    }
    for (let i = Math.min(startSlot - 1, slots.length - 1); i >= 0; i--) {
      if (slots[i]?.kart !== null) return { kartIdx: data.karts.indexOf(slots[i].kart!), fromSkip: true };
    }
    for (let i = slots.length - 1; i > startSlot; i--) {
      if (slots[i]?.kart !== null) return { kartIdx: data.karts.indexOf(slots[i].kart!), fromSkip: true };
    }
    return { kartIdx: null, fromSkip: true };
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
  const STICKY_NUM = 'sticky left-0 z-10';
  const STICKY_PILOT = 'sticky left-[24px] z-10 after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:shadow-[2px_0_4px_rgba(0,0,0,0.3)]';

  /** 0→green, 0.25→red, 0.25→0.5 bright red, >0.5 max red */
  const diffColor = (diff: number): string => {
    if (diff <= 0.0005) return 'rgb(74,222,128)'; // green-400
    if (diff >= 0.5) return 'rgb(220,38,38)'; // red-600
    if (diff >= 0.25) {
      const t = (diff - 0.25) / 0.25;
      const r = Math.round(248 + (220 - 248) * t);
      const g = Math.round(113 + (38 - 113) * t);
      const b = Math.round(113 + (38 - 113) * t);
      return `rgb(${r},${g},${b})`;
    }
    // 0→0.25: green→red
    const t = diff / 0.25;
    const r = Math.round(74 + (248 - 74) * t);
    const g = Math.round(222 + (113 - 222) * t);

  const fmtDiff = (d: number, sign: '+' | '-' = '+'): string => {
    const abs = Math.abs(d);
    if (abs < 0.005) return `${sign}0.00`;
    return `${sign}${abs.toFixed(2)}`;
  };
    const b = Math.round(128 + (113 - 128) * t);
    return `rgb(${r},${g},${b})`;
  };

  /** Per-kart best time for P1-diff */
  const kartBestTime = useMemo(() => data.karts.map((_, ki) => {
    let best = Infinity;
    for (const r of data.rows) {
      const t = r.kartResults[ki]?.bestTime;
      if (t !== null && t !== undefined && t < best) best = t;
    }
    return best < Infinity ? best : null;
  }), [data]);

  /** Best average for P1-diff on average column */
  const bestAverage = useMemo(() => {
    let best = Infinity;
    for (const r of data.rows) {
      const avg = getRowAverage(r);
      if (avg !== null && avg < best) best = avg;
    }
    return best < Infinity ? best : null;
  }, [data, getRowAverage]);

  const sectorStyle = (val: number, best: number | null, worst: number | null): React.CSSProperties | undefined => {
    if (best === null) return undefined;
    if (worst !== null && Math.abs(val - worst) < 0.002 && Math.abs(best - worst) > 0.002) return { color: 'rgb(250,204,21)' };
    if (Math.abs(val - best) < 0.002) return { color: 'rgb(74,222,128)' };
    return undefined;
  };

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <button onClick={onToggleLive}
          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${liveEnabled ? 'bg-green-600/20 text-green-400' : 'bg-dark-800 text-dark-500'}`}>
          ● LIVE
        </button>
        <span className="text-dark-600 text-[10px]">
          {pilotCount} пілотів · {data.karts.length} картів · {roundSessions.length}/{roundCount} гонок
        </span>
      </div>

      {/* Kart Manager — controlled by its own layout section visibility */}
      {isSectionVisible('competition', 'kartManager') && canManage && (
        <PilotKartAssignment
          autoKarts={data.karts}
          kartList={kartList}
          setKartList={(kl) => { setKartList(kl); saveGonzalesConfig({ kartList: kl }); }}
          kartReplacements={kartReplacements}
          setKartReplacements={(kr) => { setKartReplacements(kr); saveGonzalesConfig({ kartReplacements: kr }); }}
          excludedKarts={excludedKarts}
          setExcludedKarts={(ek) => { setExcludedKarts(ek); saveGonzalesConfig({ excludedKarts: [...ek] as any }); }}
          pilotCount={pilotCount}
          allPilots={activePilots}
          excludedPilots={excludedPilots}
          pilotStartSlots={pilotStartSlots}
          setPilotStartSlots={(ps) => { setPilotStartSlots(ps); saveGonzalesConfig({ pilotStartSlots: ps }); }}
          slotOrder={slotOrder}
          setSlotOrder={(so) => { setSlotOrder(so); saveGonzalesConfig({ slotOrder: so }); }}
          onExcludePilot={toggleExcludePilot}
        />
      )}

      {/* Results table */}
      <div className="card p-0 overflow-hidden relative">
        <div className="flex items-center gap-2 flex-wrap px-3 py-1.5 border-b border-dark-800">
          <div className="flex items-center gap-1.5 border border-dark-700 rounded-lg px-2.5 py-1">
            <span className="text-dark-500 text-[9px]">Вид:</span>
            {(() => {
              const allOn = showBest && showWorse && showTB && showPos && showSectors;
              const toggleAll = () => {
                const next = !allOn;
                setShowBest(next); setShowWorse(next); setShowTB(next); setShowPos(next); setShowSectors(next);
              };
              const pill = (label: string, on: boolean, toggle: () => void) => (
                <button key={label} onClick={toggle}
                  className={`px-1.5 py-0.5 text-[9px] font-medium transition-colors ${on ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>
                  {label}</button>
              );
              return (
                <span className="flex rounded overflow-hidden divide-x divide-dark-700">
                  <button onClick={toggleAll}
                    className={`px-2 py-0.5 text-[9px] font-bold transition-colors ${allOn ? 'bg-primary-600/30 text-primary-300' : 'bg-dark-700/60 text-dark-400'}`}>
                    Все</button>
                  {pill('Pos', showPos, () => setShowPos(v => !v))}
                  {pill('Best', showBest, () => setShowBest(v => !v))}
                  {pill('Worse', showWorse, () => setShowWorse(v => !v))}
                  {pill('TB', showTB, () => setShowTB(v => !v))}
                  {pill('S1-S2', showSectors, () => setShowSectors(v => !v))}
                </span>
              );
            })()}
          </div>
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
        </div>
        <div className="overflow-auto max-h-[80vh]">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 z-20">
              <tr className="table-header">
                <th className={`table-cell text-center w-6 bg-[#1a1d23] ${STICKY_NUM}`}>#</th>
                <th className={`table-cell text-left min-w-[100px] cursor-pointer hover:text-white bg-[#1a1d23] ${STICKY_PILOT} ${sortKey === 'name' ? SORT_HL : ''}`}
                  onClick={() => handleSort('name')}>
                  Пілот<SortArrow k="name" />
                </th>
                <th className={`table-cell text-center min-w-[65px] font-bold cursor-pointer hover:text-white bg-[#1a1d23] ${sortKey === 'average' ? SORT_HL : ''}`}
                  onClick={() => handleSort('average')}>
                  Сер.<SortArrow k="average" />
                </th>
                {data.karts.map((k, ki) => {
                  if (excludedKarts.has(k)) return null;
                  return (
                  <th key={k} colSpan={1}
                    className={`table-cell text-center cursor-pointer hover:text-white bg-[#1a1d23] ${KART_COLOR} ${sortKey === `kart_${k}` ? SORT_HL : ''} ${ki > 0 ? 'border-l-2 border-dark-600' : ''}`}
                    onClick={() => handleSort(`kart_${k}`)}>
                    {k}<SortArrow k={`kart_${k}`} />
                  </th>
                  );
                })}
                {canManage && <th className="table-cell text-center w-6 bg-[#1a1d23]"></th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => {
                const isSelected = selectedPilot === r.pilot;
                const { kartIdx: startKartIdx, fromSkip: isSkipStart } = getStartKartInfo(r.startSlot);
                const stickyBg = isSelected ? 'bg-[#2a2f3a]' : 'bg-dark-900';
                return (
                  <tr key={r.pilot}
                    onClick={() => setSelectedPilot(isSelected ? null : r.pilot)}
                    className={`table-row cursor-pointer ${isSelected ? 'bg-primary-600/10' : ''} active:bg-dark-700/30`}>
                    <td className={`table-cell text-center font-mono text-white font-bold ${stickyBg} ${STICKY_NUM}`}>{i + 1}</td>
                    <td className={`table-cell text-left text-white whitespace-nowrap ${stickyBg} ${STICKY_PILOT}`}>{r.pilot}</td>
                    {(() => {
                      const avg = getRowAverage(r);
                      return (
                    <td className={`table-cell text-center font-mono font-bold ${
                      avg !== null ? 'text-white' : 'text-dark-700'
                    } ${sortKey === 'average' ? SORT_HL : ''}`}>
                      {avg !== null ? avg.toFixed(2) : '—'}
                      {showPos && avg !== null && bestAverage !== null && (() => {
                        const d = avg - bestAverage;
                        return (
                          <div className="font-normal leading-tight whitespace-nowrap">
                            <span style={{ color: diffColor(d) }}>P{i + 1}</span>
                            <span className="text-[9px]" style={{ color: diffColor(d) }}> {fmtDiff(d)}</span>
                          </div>
                        );
                      })()}
                    </td>
                      );
                    })()}
                    {r.kartResults.map((kr, ki) => {
                      const isStartKart = startKartIdx === ki;
                      const startTimeBorder = isStartKart && !isSkipStart ? 'ring-1 ring-inset ring-yellow-500/60' : '';
                      const skipIndicator = isStartKart && isSkipStart;
                      const colHighlight = sortKey === `kart_${data.karts[ki]}` ? SORT_HL : '';
                      if (excludedKarts.has(data.karts[ki])) return null;
                      const kartBorder = ki > 0 ? 'border-l-2 border-dark-600' : '';
                      if (kr.bestTime === null) {
                        return (
                          <td key={ki} className={`table-cell text-center text-dark-700 relative ${colHighlight} ${startTimeBorder} ${kartBorder}`}>
                            —
                            {skipIndicator && <span className="absolute right-0 top-0 bottom-0 w-[3px] bg-yellow-500/60" />}
                          </td>
                        );
                      }

                      const bestLap = kr.allLaps.reduce<typeof kr.allLaps[0] | null>((b, l) => !b || l.time < b.time ? l : b, null);
                      const worseLap = kr.allLaps.length > 1
                        ? kr.allLaps.reduce<typeof kr.allLaps[0] | null>((w, l) => l !== bestLap ? (!w || l.time > w.time ? l : w) : w, null)
                        : null;
                      const hasTwoLaps = bestLap !== null && worseLap !== null;

                      const pilotBestS1 = kr.allLaps.reduce<number | null>((b, l) => l.s1 !== null && (b === null || l.s1 < b) ? l.s1 : b, null);
                      const pilotBestS2 = kr.allLaps.reduce<number | null>((b, l) => l.s2 !== null && (b === null || l.s2 < b) ? l.s2 : b, null);
                      const pilotWorstS1 = hasTwoLaps ? kr.allLaps.reduce<number | null>((w, l) => l.s1 !== null && (w === null || l.s1 > w) ? l.s1 : w, null) : null;
                      const pilotWorstS2 = hasTwoLaps ? kr.allLaps.reduce<number | null>((w, l) => l.s2 !== null && (w === null || l.s2 > w) ? l.s2 : w, null) : null;

                      const p1Best = kartBestTime[ki];
                      const p1Diff = p1Best !== null && kr.bestTime !== null ? kr.bestTime - p1Best : null;
                      const tbDiffVal = kr.theoreticalBest !== null && kr.bestTime !== null ? kr.bestTime - kr.theoreticalBest : null;

                      const renderSectors = (lap: { s1: number | null; s2: number | null }) => {
                        if (!showSectors) return null;
                        if (lap.s1 === null && lap.s2 === null) return null;
                        return (
                          <div className="text-[8px] leading-tight font-normal whitespace-nowrap mb-0.5">
                            <span style={lap.s1 !== null ? sectorStyle(lap.s1, pilotBestS1, pilotWorstS1) : undefined} className={lap.s1 === null ? 'text-dark-600' : 'text-dark-500'}>
                              {lap.s1 !== null ? lap.s1.toFixed(2) : '—'}
                            </span>
                            <span className="text-dark-700"> </span>
                            <span style={lap.s2 !== null ? sectorStyle(lap.s2, pilotBestS2, pilotWorstS2) : undefined} className={lap.s2 === null ? 'text-dark-600' : 'text-dark-500'}>
                              {lap.s2 !== null ? lap.s2.toFixed(2) : '—'}
                            </span>
                          </div>
                        );
                      };

                      const lapsToShow: { lap: typeof kr.allLaps[0]; isBest: boolean }[] = [];
                      if (showBest && showWorse && bestLap && worseLap) {
                        for (const l of kr.allLaps) lapsToShow.push({ lap: l, isBest: l === bestLap });
                      } else {
                        if (showBest && bestLap) lapsToShow.push({ lap: bestLap, isBest: true });
                        if (showWorse && worseLap) lapsToShow.push({ lap: worseLap, isBest: false });
                      }

                      return (
                          <td key={ki} className={`table-cell text-center font-mono relative ${colHighlight} ${startTimeBorder} ${kartBorder}`}>
                            {lapsToShow.length === 0 && !showTB && !showPos && (
                              <span className="text-dark-500">{kr.bestTime.toFixed(2)}</span>
                            )}
                            {lapsToShow.map(({ lap, isBest }, li) => (
                              <div key={li} className="leading-tight">
                                <span className={isBest ? 'text-green-400' : 'text-yellow-400'}>
                                  {lap.time.toFixed(2)}
                                </span>
                                {renderSectors(lap)}
                              </div>
                            ))}
                            {showPos && p1Diff !== null && (
                              <div className="leading-tight whitespace-nowrap">
                                <span style={{ color: diffColor(p1Diff) }}>P{kr.place ?? '?'}</span>
                                <span className="text-[9px]" style={{ color: diffColor(p1Diff) }}> {fmtDiff(p1Diff)}</span>
                              </div>
                            )}
                            {showTB && kr.theoreticalBest !== null && (
                              <div className="leading-tight whitespace-nowrap">
                                <span className="text-dark-400">{kr.theoreticalBest.toFixed(2)}</span>
                                {tbDiffVal !== null && (
                                  <span className="text-[9px]" style={{ color: diffColor(tbDiffVal) }}> {fmtDiff(tbDiffVal, '-')}</span>
                                )}
                              </div>
                            )}
                            {skipIndicator && <span className="absolute right-0 top-0 bottom-0 w-[3px] bg-yellow-500/60" />}
                          </td>
                      );
                    })}
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

      {/* Edit Log — controlled by its own layout section visibility */}
      {isOwner && isSectionVisible('competition', 'editLog') && (
        <GonzalesEditLog competitionId={competitionId} />
      )}
    </div>
  );
}

function GonzalesEditLog({ competitionId }: { competitionId: string }) {
  const [log, setLog] = useState<{ pilot: string; action: string; detail: string; user: string; ts: number }[]>([]);

  useEffect(() => {
    fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competitionId)}`)
      .then(r => r.json())
      .then(c => {
        const results = typeof c.results === 'string' ? JSON.parse(c.results) : (c.results || {});
        setLog((results.editLog || []).slice().reverse());
      })
      .catch(() => {});
  }, [competitionId]);

  return (
    <div className="card p-0 overflow-hidden max-h-60 overflow-y-auto">
      {log.length === 0 ? (
        <div className="px-4 py-3 text-dark-600 text-[10px]">Немає записів</div>
      ) : (
        <table className="text-[10px]" style={{ tableLayout: 'auto', width: 'auto' }}>
          <thead><tr className="bg-dark-800/50 sticky top-0">
            <th className="px-2 py-1 text-left text-dark-400">Час</th>
            <th className="px-2 py-1 text-left text-dark-400">Користувач</th>
            <th className="px-2 py-1 text-left text-dark-400">Пілот</th>
            <th className="px-2 py-1 text-left text-dark-400">Дія</th>
          </tr></thead>
          <tbody>
            {log.map((entry, i) => (
              <tr key={i} className="border-b border-dark-800/50">
                <td className="px-2 py-1 text-dark-500 whitespace-nowrap">{new Date(entry.ts).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                <td className="px-2 py-1 text-dark-400">{entry.user.split('@')[0]}</td>
                <td className="px-2 py-1 text-white">{entry.pilot}</td>
                <td className="px-2 py-1 text-dark-300">{entry.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================
// Pilot-Kart Assignment sub-component
// ============================================================

function PilotKartAssignment({ autoKarts, kartList, setKartList, kartReplacements, setKartReplacements,
  excludedKarts, setExcludedKarts, pilotCount, allPilots, excludedPilots, pilotStartSlots, setPilotStartSlots,
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
  excludedPilots: Set<string>;
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

  // Derive effective slotOrder: only trim excess skips (don't auto-add removed ones)
  const effectiveSlotOrder = useMemo((): (number | null)[] | undefined => {
    if (!slotOrder || slotOrder.length === 0) return undefined;
    const neededSkips = Math.max(0, pilotCount - effectiveKarts.length);
    const currentSkips = slotOrder.filter(v => v === null).length;
    if (currentSkips <= neededSkips) return slotOrder;

    let toRemove = currentSkips - neededSkips;
    const result = [...slotOrder];
    for (let i = result.length - 1; i >= 0 && toRemove > 0; i--) {
      if (result[i] === null) { result.splice(i, 1); toRemove--; }
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

  // Clean up stale pilot assignments (pilots removed from allPilots)
  useEffect(() => {
    if (slots.length === 0 || allPilots.length === 0) return;
    const pilotSet = new Set(allPilots);
    const next: Record<string, number> = {};
    let changed = false;
    for (const [pilot, idx] of Object.entries(pilotStartSlots)) {
      if (pilotSet.has(pilot) && idx < slots.length) {
        next[pilot] = idx;
      } else {
        changed = true;
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

  const removeSkip = (slotIdx: number) => {
    const order = currentSlotOrder();
    if (order[slotIdx] !== null) return;
    order.splice(slotIdx, 1);
    setSlotOrder(order.length > 0 ? order : undefined);
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

  const moveSlot = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const order = currentSlotOrder();
    const [item] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, item);
    setSlotOrder(order);
  };

  const movePilot = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const next = { ...pilotStartSlots };
    const pilotAtFrom = Object.entries(next).find(([, idx]) => idx === fromIdx)?.[0];
    const pilotAtTo = Object.entries(next).find(([, idx]) => idx === toIdx)?.[0];
    if (!pilotAtFrom) return;
    next[pilotAtFrom] = toIdx;
    if (pilotAtTo) next[pilotAtTo] = fromIdx;
    setPilotStartSlots(next);
  };

  const assignPilotToSlot = (pilot: string, slotIdx: number) => {
    const next = { ...pilotStartSlots };
    const existingPilot = Object.entries(next).find(([, idx]) => idx === slotIdx)?.[0];
    const previousSlot = next[pilot];
    if (existingPilot && previousSlot !== undefined) {
      next[existingPilot] = previousSlot;
    } else if (existingPilot) {
      delete next[existingPilot];
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
    <div className="card p-3 space-y-3 text-xs relative z-10">
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
                  onDrop={() => { if (dragSlotIdx !== null) { moveSlot(dragSlotIdx, si); setDragSlotIdx(null); } }}
                >
                  <div className="flex flex-col shrink-0">
                    <button onClick={() => !isFirst && moveSlot(si, si - 1)} disabled={isFirst}
                      className={`text-sm leading-none px-0.5 ${isFirst ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▲</button>
                    <button onClick={() => !isLast && moveSlot(si, si + 1)} disabled={isLast}
                      className={`text-sm leading-none px-0.5 ${isLast ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▼</button>
                  </div>
                  {isSkip ? (
                    <>
                      <span className="text-white font-medium text-xs">{slot.label}</span>
                      <button onClick={() => removeSkip(si)}
                        className="ml-auto w-6 h-6 flex items-center justify-center rounded bg-red-600/15 text-red-400/60 hover:bg-red-600/30 hover:text-red-400 text-sm font-bold shrink-0"
                        title="Видалити пропуск">×</button>
                    </>
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
                        <button onClick={() => !isFirst && movePilot(si, si - 1)} disabled={isFirst}
                          className={`text-sm leading-none px-0.5 ${isFirst ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▲</button>
                        <button onClick={() => !isLast && movePilot(si, si + 1)} disabled={isLast}
                          className={`text-sm leading-none px-0.5 ${isLast ? 'text-dark-800' : 'text-dark-500 hover:text-white active:text-white'}`}>▼</button>
                      </div>
                      <span className="text-white cursor-grab flex-1 text-xs truncate"
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); setDragPilot(pilot); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => setDragPilot(null)}
                      >{pilot}</span>
                      <button onClick={() => unassignPilot(pilot)}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-dark-700/50 text-dark-500 hover:bg-dark-700 hover:text-dark-300 text-sm"
                        title="Зняти привʼязку">↩</button>
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

      {/* Excluded pilots */}
      {excludedPilots.size > 0 && (
        <div>
          <div className="text-dark-500 text-[10px] font-semibold uppercase mb-1">
            Виключені пілоти ({excludedPilots.size})
          </div>
          <div className="flex flex-wrap gap-1">
            {[...excludedPilots].map(pilot => (
              <div key={pilot} className="flex items-center gap-1 px-2 py-0.5 rounded bg-dark-800">
                <span className="text-dark-500 text-[10px]">{pilot}</span>
                <button onClick={() => onExcludePilot(pilot)}
                  className="text-[10px] text-green-500 hover:text-green-400 font-bold" title="Повернути">↩</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Replacements */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-dark-500 text-[10px] font-semibold uppercase">Заміни картів: Було → Стало</span>
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
            className="w-16 bg-dark-800 rounded px-2 py-0.5 text-dark-300 outline-none border border-dark-700 focus:border-primary-500 text-[10px]" />
          <span className="text-dark-600">→</span>
          <input type="number" value={replTo} onChange={e => setReplTo(e.target.value)}
            placeholder="Стало"
            className="w-16 bg-dark-800 rounded px-2 py-0.5 text-dark-300 outline-none border border-dark-700 focus:border-primary-500 text-[10px]" />
          <button onClick={addReplacement} className="px-1.5 py-0.5 rounded bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 transition-colors text-[10px]">+</button>
        </div>
      </div>
    </div>
  );
}
