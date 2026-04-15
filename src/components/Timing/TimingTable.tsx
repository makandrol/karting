import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { TimingEntry } from '../../types';
import { parseTime, toSeconds, toHundredths, getTimeColor, COLOR_CLASSES, KART_COLOR, shortName, type TimeColor } from '../../utils/timing';

export type SortMode = 'qualifying' | 'race';

const ALL_COL_IDS = ['start', 'arrows', 'change', 'pilot', 'points', 'kart', 'gap', 'last', 's1', 's2', 'best', 'bestS1', 'bestS2', 'tb', 'loss', 'laps'] as const;
type ColId = typeof ALL_COL_IDS[number];
const DEFAULT_ORDER: ColId[] = [...ALL_COL_IDS];
const RACE_ORDER: ColId[] = ['start', 'arrows', 'change', 'points', 'pilot', 'laps', 'gap', 'kart', 'last', 's1', 's2', 'best', 'bestS1', 'bestS2', 'tb', 'loss'];
const COL_LABELS: Record<ColId, string> = {
  start: 'Start', arrows: '', change: 'Δ', pilot: 'Pilot', points: 'P',
  kart: 'Kart', gap: 'Gap', last: 'Last', s1: 'S1', s2: 'S2',
  best: 'Best', bestS1: 'B.S1', bestS2: 'B.S2', tb: 'TB', loss: 'Loss', laps: 'L',
};
const COL_WIDTHS: Record<ColId, string> = {
  start: 'w-[120px]', arrows: 'min-w-[100px] w-[100px]', change: 'w-5', pilot: 'min-w-[150px]', points: 'w-8',
  kart: 'w-12', gap: 'w-16', last: 'w-16', s1: 'w-14', s2: 'w-14',
  best: 'w-16', bestS1: 'w-14', bestS2: 'w-14', tb: 'w-16', loss: 'w-16', laps: 'w-8',
};
const ALL_COLS_SET = new Set<ColId>(ALL_COL_IDS);
const MAIN_QUAL_VISIBLE = new Set<ColId>(['start', 'arrows', 'change', 'pilot', 'points', 'kart', 'last', 'best', 'laps']);
const MAIN_RACE_VISIBLE = new Set<ColId>(['change', 'pilot', 'points', 'kart', 'gap', 'last', 'best', 'laps']);
const RACE_ONLY_COLS = new Set<ColId>(['gap']);
const START_GROUP: ColId[] = ['start', 'arrows'];
const START_GROUP_SET = new Set<ColId>(START_GROUP);

export interface TimingTableProps {
  entries: TimingEntry[];
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  columnFilter?: 'all' | 'main' | 'custom';
  onColumnFilterChange?: (filter: 'all' | 'main' | 'custom') => void;
  startPositions?: Map<string, number>;
  startGrid?: Map<number, string>;
  raceGroup?: number;
  totalQualifiedPilots?: number;
  isCompetitionRace?: boolean;
  competitionFormat?: string;
  hidePoints?: boolean;
  /** Map pilot name -> display suffix, e.g. "Карт 22" -> "(Макаревич?)" */
  pilotSuffix?: Map<string, string>;
}

function arrowColor(diff: number): string {
  if (diff === 0) return '#6b7280';
  const abs = Math.abs(diff);
  if (diff > 0) return abs >= 5 ? '#22c55e' : abs >= 3 ? '#4ade80' : '#86efac';
  return abs >= 5 ? '#ef4444' : abs >= 3 ? '#f87171' : '#fca5a5';
}

export default function TimingTable({
  entries, sortMode, onSortModeChange,
  columnFilter: controlledColumnFilter, onColumnFilterChange,
  startPositions, startGrid,
  raceGroup, totalQualifiedPilots, isCompetitionRace, competitionFormat, hidePoints, pilotSuffix,
}: TimingTableProps) {
  const [internalColumnFilter, setInternalColumnFilter] = useState<'all' | 'main' | 'custom'>(() => {
    try { const s = localStorage.getItem('karting_timing_col_filter'); if (s === 'all' || s === 'main' || s === 'custom') return s; } catch {} return 'all';
  });
  const columnFilter = controlledColumnFilter ?? internalColumnFilter;
  const setColumnFilter = onColumnFilterChange ?? ((f: 'all' | 'main' | 'custom') => { setInternalColumnFilter(f); localStorage.setItem('karting_timing_col_filter', f); });

  const [customCols, setCustomCols] = useState<Record<SortMode, { visible: Set<ColId>; order: ColId[] }>>(() => {
    const load = (mode: SortMode) => {
      const modeOrder = mode === 'race' ? RACE_ORDER : DEFAULT_ORDER;
      try {
        const raw = localStorage.getItem(`karting_timing_cols_${mode}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.order && parsed.hidden) {
            const order = (parsed.order as string[]).filter(c => ALL_COLS_SET.has(c as ColId)) as ColId[];
            const missing = modeOrder.filter(c => !order.includes(c));
            const fullOrder = [...order, ...missing];
            const hidden = new Set(parsed.hidden as string[]);
            return { visible: new Set<ColId>(fullOrder.filter(c => !hidden.has(c))), order: fullOrder };
          }
          const visible = new Set((parsed as string[]).filter(c => ALL_COLS_SET.has(c as ColId)) as ColId[]);
          for (const c of ALL_COLS_SET) visible.add(c);
          return { visible, order: [...modeOrder] };
        }
      } catch {}
      return { visible: new Set<ColId>(ALL_COLS_SET), order: [...modeOrder] };
    };
    return { qualifying: load('qualifying'), race: load('race') };
  });

  const saveCustom = useCallback((mode: SortMode, state: { visible: Set<ColId>; order: ColId[] }) => {
    const hidden = state.order.filter(c => !state.visible.has(c));
    localStorage.setItem(`karting_timing_cols_${mode}`, JSON.stringify({ order: state.order, hidden }));
  }, []);

  const toggleCustomCol = useCallback((col: ColId) => {
    const cols = START_GROUP_SET.has(col) ? START_GROUP : [col];
    setCustomCols(prev => {
      const current = prev[sortMode];
      const nextVisible = new Set(current.visible);
      const isOn = nextVisible.has(col);
      for (const c of cols) isOn ? nextVisible.delete(c) : nextVisible.add(c);
      const next = { visible: nextVisible, order: current.order };
      saveCustom(sortMode, next);
      return { ...prev, [sortMode]: next };
    });
  }, [sortMode, saveCustom]);

  const [dragCol, setDragCol] = useState<ColId | null>(null);
  const handleDragStart = useCallback((col: ColId) => { setDragCol(col); }, []);
  const handleDragOver = useCallback((e: React.DragEvent, targetCol: ColId) => {
    e.preventDefault();
    if (!dragCol || dragCol === targetCol) return;
    setCustomCols(prev => {
      const current = prev[sortMode];
      const order = [...current.order];
      const fromIdx = order.indexOf(dragCol);
      const toIdx = order.indexOf(targetCol);
      if (fromIdx === -1 || toIdx === -1) return prev;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragCol);
      const next = { visible: current.visible, order };
      saveCustom(sortMode, next);
      return { ...prev, [sortMode]: next };
    });
  }, [dragCol, sortMode, saveCustom]);
  const handleDragEnd = useCallback(() => { setDragCol(null); }, []);

  const customState = customCols[sortMode];
  const modeDefaultOrder = sortMode === 'race' ? RACE_ORDER : DEFAULT_ORDER;
  const visibleCols: Set<ColId> = columnFilter === 'all' ? ALL_COLS_SET : columnFilter === 'main' ? (sortMode === 'race' ? MAIN_RACE_VISIBLE : MAIN_QUAL_VISIBLE) : customState.visible;
  const baseOrder: ColId[] = columnFilter === 'custom' ? customState.order : modeDefaultOrder;
  const colOrder: ColId[] = useMemo(() => {
    if (columnFilter !== 'custom') return baseOrder;
    const fixed = modeDefaultOrder.filter(c => START_GROUP_SET.has(c));
    const rest = baseOrder.filter(c => !START_GROUP_SET.has(c));
    const result: ColId[] = [];
    let fi = 0;
    for (const c of modeDefaultOrder) {
      if (START_GROUP_SET.has(c)) {
        result.push(c);
        fi++;
      } else if (fi > 0 && result.length === fi) {
        result.push(...rest);
        break;
      }
    }
    if (result.length <= fixed.length) result.push(...rest);
    return result;
  }, [columnFilter, baseOrder, modeDefaultOrder]);

  const hasStartData = sortMode === 'race' && startPositions && startPositions.size > 0;

  const isColVisible = (id: ColId) => {
    if (START_GROUP_SET.has(id) && !hasStartData) return false;
    if (RACE_ONLY_COLS.has(id) && sortMode !== 'race') return false;
    return visibleCols.has(id);
  };

  const [scoringData, setScoringData] = useState<any>(null);
  useEffect(() => { fetch('/data/scoring.json').then(r => r.json()).then(setScoringData).catch(() => {}); }, []);

  const { overallBestLap, overallBestS1, overallBestS2 } = useMemo(() => {
    let bLap: number | null = null, bS1: number | null = null, bS2: number | null = null;
    for (const e of entries) {
      const lap = parseTime(e.bestLap); if (lap !== null && (bLap === null || lap < bLap)) bLap = lap;
      const s1 = parseTime(e.bestS1); if (s1 !== null && s1 >= 10 && (bS1 === null || s1 < bS1)) bS1 = s1;
      const s2 = parseTime(e.bestS2); if (s2 !== null && s2 >= 10 && (bS2 === null || s2 < bS2)) bS2 = s2;
    }
    return { overallBestLap: bLap, overallBestS1: bS1, overallBestS2: bS2 };
  }, [entries]);

  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const [tbodyH, setTbodyH] = useState(0);
  const n = entries.filter(e => e.lapNumber >= 0).length;
  const arrowW = 100;

  useEffect(() => {
    if (!tbodyRef.current) return;
    const ro = new ResizeObserver(([entry]) => setTbodyH(entry.contentRect.height));
    ro.observe(tbodyRef.current);
    return () => ro.disconnect();
  }, [entries.length]);

  const arrows = useMemo(() => {
    if (!hasStartData || tbodyH <= 0 || n === 0) return [];
    const rowH = tbodyH / n;
    return entries
      .filter(e => e.lapNumber >= 0 && e.currentLapSec != null && e.currentLapSec > 0 && e.currentLapSec <= n)
      .map(e => {
        const startPos = e.currentLapSec!;
        const finishPos = e.position;
        const diff = startPos - finishPos;
        const sy = (startPos - 0.5) * rowH;
        const fy = (finishPos - 0.5) * rowH;
        const col = arrowColor(diff);
        return {
          d: `M 2 ${sy} C ${arrowW * 0.4} ${sy} ${arrowW * 0.6} ${fy} ${arrowW - 5} ${fy}`,
          tip: `M ${arrowW - 9} ${fy - 3} L ${arrowW - 4} ${fy} L ${arrowW - 9} ${fy + 3}`,
          col,
        };
      });
  }, [hasStartData, tbodyH, n, entries, arrowW]);

  const visibleColList = colOrder.filter(c => isColVisible(c));
  const showArrowsCol = visibleColList.includes('arrows');

  const gapMap = useMemo(() => {
    if (sortMode !== 'race') return new Map<string, string>();
    const map = new Map<string, string>();
    const sorted = [...entries].filter(e => e.lapNumber >= 0).sort((a, b) => a.position - b.position);
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      if (i === 0) { map.set(e.pilot, '—'); continue; }
      map.set(e.pilot, e.gap || '—');
    }
    return map;
  }, [entries, sortMode]);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800 flex items-center gap-3 flex-wrap">
        {isCompetitionRace && (
          <div className="flex bg-dark-800 rounded-md p-0.5">
            <button
              onClick={() => onSortModeChange('qualifying')}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                sortMode === 'qualifying' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              Квала
            </button>
            <button
              onClick={() => onSortModeChange('race')}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                sortMode === 'race' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'
              }`}
            >
              Гонка
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5 border border-dark-700 rounded-lg px-2.5 py-1 flex-wrap">
          <span className="text-dark-500 text-[9px]">Вид:</span>
          <span className="flex rounded overflow-hidden">
            <button onClick={() => setColumnFilter('all')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${columnFilter === 'all' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Все</button>
            <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
            <button onClick={() => setColumnFilter('main')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${columnFilter === 'main' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Осн</button>
            <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
            <button onClick={() => setColumnFilter('custom')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${columnFilter === 'custom' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Своє</button>
          </span>
          {columnFilter === 'custom' && (
            <>
              <span className="text-dark-700 text-[9px]">|</span>
              {hasStartData && (
                <button
                  onClick={() => toggleCustomCol('start')}
                  className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                    visibleCols.has('start') ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
                  }`}
                >
                  Start
                </button>
              )}
              {customState.order.filter(c => !START_GROUP_SET.has(c) && !(RACE_ONLY_COLS.has(c) && sortMode !== 'race')).map(col => (
                <button
                  key={col}
                  draggable
                  onDragStart={() => handleDragStart(col)}
                  onDragOver={(e) => handleDragOver(e, col)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggleCustomCol(col)}
                  className={`px-1.5 py-0.5 rounded text-[9px] transition-colors cursor-grab active:cursor-grabbing ${
                    dragCol === col ? 'ring-1 ring-primary-400 opacity-60' : ''
                  } ${
                    visibleCols.has(col) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
                  }`}
                >
                  {COL_LABELS[col] || '↔'}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table-fixed text-xs [&_th]:px-2.5 [&_th]:py-1 [&_td]:px-2.5 [&_td]:py-1">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-6">#</th>
              {visibleColList.map(col => {
                if (col === 'change' && sortMode !== 'race') return null;
                if (col === 'points' && (hidePoints || !(sortMode === 'race' && raceGroup))) return null;
                if (col === 'arrows') return <th key={col} className="table-cell" style={{ width: arrowW }} />;
                const align = col === 'pilot' || col === 'start' ? 'text-left' : 'text-center';
                const extra = (col === 'change' || col === 'points') ? ' text-dark-500' : '';
                const pad = col === 'change' ? ' px-0.5' : '';
                return <th key={col} className={`table-cell ${align}${extra}${pad} ${COL_WIDTHS[col]}`}>{COL_LABELS[col]}</th>;
              })}
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {entries.map((e, rowIdx) => {
              const notStarted = e.lapNumber < 0;
              const lapColor = notStarted ? 'none' as TimeColor : getTimeColor(e.lastLap, e.bestLap, overallBestLap);
              const s1Color = notStarted ? 'none' as TimeColor : getTimeColor(e.s1, e.bestS1, overallBestS1);
              const s2Color = notStarted ? 'none' as TimeColor : getTimeColor(e.s2, e.bestS2, overallBestS2);
              const bestLapColor = notStarted ? 'none' as TimeColor : getTimeColor(e.bestLap, e.bestLap, overallBestLap);
              const bestS1Color = notStarted ? 'none' as TimeColor : getTimeColor(e.bestS1, e.bestS1, overallBestS1);
              const bestS2Color = notStarted ? 'none' as TimeColor : getTimeColor(e.bestS2, e.bestS2, overallBestS2);

              const cellMap: Record<ColId, React.ReactNode> = {
                start: hasStartData ? (
                  <td key="start" className="table-cell text-left text-dark-400 whitespace-nowrap text-[11px]">
                    {notStarted ? '' : (() => {
                      const startPilot = startGrid?.get(e.position);
                      return startPilot ? shortName(startPilot) : '—';
                    })()}
                  </td>
                ) : null,
                arrows: (showArrowsCol && rowIdx === 0 && !notStarted) ? (
                  <td key="arrows" rowSpan={n} className="p-0 relative" style={{ minWidth: 100, width: 100 }}>
                    {tbodyH > 0 && (
                      <svg width={arrowW} height={tbodyH} className="absolute top-0 left-0 block">
                        {arrows.map((a, j) => (
                          <g key={j}>
                            <path d={a.d} fill="none" stroke={a.col} strokeWidth="1.5" strokeLinecap="round" />
                            <path d={a.tip} fill="none" stroke={a.col} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </g>
                        ))}
                      </svg>
                    )}
                  </td>
                ) : (showArrowsCol && rowIdx > 0) ? null : null,
                change: sortMode === 'race' ? (
                  <td key="change" className="table-cell text-center font-mono text-[10px] px-0.5">{(() => {
                    if (notStarted) return '';
                    const st = e.currentLapSec;
                    if (st == null) return '—';
                    const diff = st - e.position;
                    if (diff > 0) return <span className="text-green-400">↑{diff}</span>;
                    if (diff < 0) return <span className="text-red-400">↓{Math.abs(diff)}</span>;
                    return <span className="text-dark-600">0</span>;
                  })()}</td>
                ) : null,
                pilot: (
                  <td key="pilot" className="table-cell text-left py-1.5">
                    <div className={`font-medium text-[13px] leading-tight ${notStarted ? 'text-dark-500' : ''}`}>
                      <Link to={`/pilots/${encodeURIComponent(e.pilot)}`} className={`${notStarted ? 'text-dark-500' : 'text-white hover:text-primary-400'} transition-colors`}>
                        {shortName(e.pilot)}
                      </Link>
                      {pilotSuffix?.has(e.pilot) && (
                        <span className="text-yellow-400/70 text-[10px] ml-1">{pilotSuffix.get(e.pilot)}</span>
                      )}
                    </div>
                    <div className="mt-0.5 h-[2px] rounded-full overflow-hidden border border-dark-600/50">
                      <div
                        className="h-full rounded-full transition-all duration-[50ms] ease-linear bg-yellow-500/60"
                        style={{ width: `${!notStarted && e.progress !== null ? Math.round(e.progress * 100) : 0}%` }}
                      />
                    </div>
                  </td>
                ),
                points: (sortMode === 'race' && raceGroup && scoringData && !hidePoints) ? (
                  <td key="points" className="table-cell text-center font-mono text-[10px] text-green-400/70">{(() => {
                    if (notStarted) return '';
                    const st = e.currentLapSec;
                    if (st == null) return '—';
                    const finishPos = e.position;
                    const groupLabel = raceGroup === 1 ? 'I' : raceGroup === 2 ? 'II' : 'III';
                    const total = totalQualifiedPilots || 0;
                    const table = (competitionFormat === 'champions_league' && scoringData.positionPoints_CL) ? scoringData.positionPoints_CL : scoringData.positionPoints;
                    const cat = table?.find((c: any) => total >= c.minPilots && total <= c.maxPilots);
                    const posArr = cat?.groups?.[groupLabel];
                    const posPoints = posArr && finishPos >= 1 && finishPos <= posArr.length ? posArr[finishPos - 1] : 0;
                    let overtakePoints = 0;
                    for (let pos = st; pos > finishPos; pos--) {
                      if (raceGroup === 3) overtakePoints += scoringData.overtakePoints?.groupIII ?? 0;
                      else if (raceGroup === 2) overtakePoints += scoringData.overtakePoints?.groupII ?? 0;
                      else {
                        const rule = scoringData.overtakePoints?.groupI?.find((r: any) => pos >= r.startPosMin && pos <= r.startPosMax);
                        overtakePoints += rule?.perOvertake ?? 0;
                      }
                    }
                    const total_pts = Math.round((posPoints + overtakePoints) * 10) / 10;
                    return total_pts || '—';
                  })()}</td>
                ) : null,
                kart: <td key="kart" className={`table-cell text-center font-mono ${KART_COLOR}`}>{notStarted ? '' : (e.kart || '—')}</td>,
                gap: sortMode === 'race' ? (
                  <td key="gap" className="table-cell text-center font-mono text-[11px] text-dark-400 whitespace-nowrap">{notStarted ? '' : (gapMap.get(e.pilot) ?? '—')}</td>
                ) : null,
                last: <td key="last" className={`table-cell text-center font-mono font-semibold ${notStarted ? '' : COLOR_CLASSES[lapColor]}`}>{notStarted ? '' : (e.lastLap ? toSeconds(e.lastLap) : '—')}</td>,
                s1: <td key="s1" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[s1Color]}`}>{notStarted ? '' : (e.s1 && (parseTime(e.s1) ?? 0) >= 10 ? toHundredths(e.s1) : '—')}</td>,
                s2: <td key="s2" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[s2Color]}`}>{notStarted ? '' : (e.s2 && (parseTime(e.s2) ?? 0) >= 10 ? toHundredths(e.s2) : '—')}</td>,
                best: <td key="best" className={`table-cell text-center font-mono font-semibold ${notStarted ? '' : COLOR_CLASSES[bestLapColor]}`}>{notStarted ? '' : (e.bestLap ? toSeconds(e.bestLap) : '—')}</td>,
                bestS1: <td key="bestS1" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[bestS1Color]}`}>{notStarted ? '' : (e.bestS1 && (parseTime(e.bestS1) ?? 0) >= 10 ? toHundredths(e.bestS1) : '—')}</td>,
                bestS2: <td key="bestS2" className={`table-cell text-center font-mono text-[11px] ${notStarted ? '' : COLOR_CLASSES[bestS2Color]}`}>{notStarted ? '' : (e.bestS2 && (parseTime(e.bestS2) ?? 0) >= 10 ? toHundredths(e.bestS2) : '—')}</td>,
                tb: <td key="tb" className="table-cell text-center font-mono text-[11px] text-dark-400 whitespace-nowrap">{(() => {
                  if (notStarted) return '';
                  const s1v = parseTime(e.bestS1);
                  const s2v = parseTime(e.bestS2);
                  if (s1v === null || s1v < 10 || s2v === null || s2v < 10) return '—';
                  const tb = s1v + s2v;
                  return tb.toFixed(3);
                })()}</td>,
                loss: <td key="loss" className="table-cell text-center font-mono text-[11px] text-dark-500 whitespace-nowrap">{(() => {
                  if (notStarted) return '';
                  const s1v = parseTime(e.bestS1);
                  const s2v = parseTime(e.bestS2);
                  if (s1v === null || s1v < 10 || s2v === null || s2v < 10) return '—';
                  const tb = s1v + s2v;
                  const bestLapV = parseTime(e.bestLap);
                  if (bestLapV === null) return '—';
                  const diff = bestLapV - tb;
                  return `${diff >= 0 ? '+' : ''}${diff.toFixed(3)}`;
                })()}</td>,
                laps: <td key="laps" className="table-cell text-center font-mono text-dark-500">{notStarted ? '' : e.lapNumber}</td>,
              };

              return (
                <tr key={e.pilot} className="table-row">
                  <td className="table-cell text-center font-mono font-bold text-dark-400">
                    {notStarted ? '—' : e.position}
                  </td>
                  {visibleColList.map(col => cellMap[col])}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
