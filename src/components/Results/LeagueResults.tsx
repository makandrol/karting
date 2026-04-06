import { useMemo, Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { toSeconds } from '../../utils/timing';
import { useLayoutPrefs } from '../../services/layoutPrefs';
import { useAuth } from '../../services/auth';
import { COLLECTOR_URL } from '../../services/config';
import {
  type SessionLap, type CompSession, type ScoringData,
  type PilotQualiData, type PilotRaceData, type PilotRow, type ManualEdits,
  computeStandings, rowsToStandings,
} from '../../utils/scoring';

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

interface LeagueResultsProps {
  format: string;
  competitionId: string;
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
  liveSessionId?: string | null;
  livePhase?: string | null;
  livePositions?: { pilot: string; position: number }[];
  livePilots?: string[];
  liveEnabled?: boolean;
  onToggleLive?: () => void;
  initialExcludedPilots?: string[];
  initialEdits?: ManualEdits;
  initialMergedPilots?: Record<string, string>;
  initialEditLog?: { pilot: string; action: string; detail: string; user: string; ts: number }[];
  excludedLapKeys?: string[];
  allSessionsEnded?: boolean;
  totalPilotsOverride?: number | null;
  totalPilotsLocked?: boolean;
  groupCountOverride?: number | null;
  onSaveResults?: (partial: Record<string, any>) => Promise<void>;
  onPilotCount?: (n: number) => void;
  onAutoGroups?: (n: number) => void;
}

const TH_V = "px-1 py-1 text-center text-dark-500 border-r border-dark-700/30";
const TH_R = "[writing-mode:vertical-lr] rotate-180 text-[9px]";
const SECTION_BORDER = "border-r-2 border-dark-600";

const STICKY_NUM = "sticky left-0 z-10";
const STICKY_PILOT = "sticky left-[28px] z-10 after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:shadow-[2px_0_4px_rgba(0,0,0,0.3)]";

function EditableCell({ value, onChange, colorClass, prefix, editingRef }: {
  value: number; onChange: (v: number) => void; colorClass?: string; prefix?: string;
  editingRef: React.MutableRefObject<boolean>;
}) {
  const display = prefix && value ? `${prefix}${value}` : String(value);
  const [text, setText] = useState(display);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(display); }, [display, focused]);
  const commit = () => { setFocused(false); editingRef.current = false; const v = Math.abs(parseFloat(text.replace(/[^0-9.]/g, ''))); onChange(isNaN(v) ? 0 : v); };
  return (
    <input type="text" inputMode="numeric" value={text}
      onChange={e => setText(e.target.value)}
      onFocus={() => { setFocused(true); editingRef.current = true; }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`w-7 bg-transparent text-center font-mono outline-none border-b border-dark-700 focus:border-primary-500 ${colorClass || 'text-dark-300'}`} />
  );
}

export default function LeagueResults({ format, competitionId, sessions, sessionLaps, liveSessionId, livePhase, livePositions, livePilots, liveEnabled, onToggleLive, initialExcludedPilots, initialEdits, allSessionsEnded, totalPilotsOverride, totalPilotsLocked: initialLocked, groupCountOverride, onSaveResults, onPilotCount, onAutoGroups, excludedLapKeys }: LeagueResultsProps) {
  const { isSectionVisible, toggleSection } = useLayoutPrefs();
  const showLeaguePoints = isSectionVisible('competition', 'leaguePoints');
  const { isOwner, hasPermission, user } = useAuth();
  const canManage = isOwner || hasPermission('manage_results');
  const raceCount = format === 'champions_league' ? 3 : 2;
  const excludedLapSet = useMemo(() => new Set(excludedLapKeys || []), [excludedLapKeys]);
  const effectiveLaps = useMemo(() => {
    if (excludedLapSet.size === 0) return sessionLaps;
    const filtered = new Map<string, SessionLap[]>();
    for (const [sid, laps] of sessionLaps) {
      filtered.set(sid, laps.filter(l => !excludedLapSet.has(`${sid}|${l.pilot}|${l.ts}`)));
    }
    return filtered;
  }, [sessionLaps, excludedLapSet]);
  const formatMaxGroups = format === 'champions_league' ? 2 : 3;
  const qualiSessions = sessions.filter(s => s.phase?.startsWith('qualifying'));
  const qualiSessionsWithData = qualiSessions.filter(s => (effectiveLaps.get(s.sessionId) || []).length > 0);
  const autoGroupsByQuali = Math.min(Math.max(qualiSessionsWithData.length, 1), formatMaxGroups);
  const maxGroups = groupCountOverride ?? autoGroupsByQuali;
  const sessionsWithData = new Set(sessions.filter(s => (effectiveLaps.get(s.sessionId) || []).length > 0).map(s => s.sessionId));
  const [renamingPilot, setRenamingPilot] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const editingRef = useRef(false);
  const lastStandingsJsonRef = useRef('');
  const lastStandingsPushTsRef = useRef(0);
  const [selectedPilot, setSelectedPilot] = useState<string | null>(null);

  const [pilotsOverride, setPilotsOverride] = useState<number | null>(totalPilotsOverride ?? null);
  const [pilotsLocked, setPilotsLocked] = useState(initialLocked ?? false);

  const [scoring, setScoring] = useState<ScoringData | null>(null);
  useEffect(() => {
    fetch(`${COLLECTOR_URL}/scoring`).then(r => r.ok ? r.json() : fetch('/data/scoring.json').then(r2 => r2.json())).then(setScoring).catch(() => {
      fetch('/data/scoring.json').then(r => r.json()).then(setScoring).catch(() => {});
    });
  }, []);

  // --- Persist view settings per user+competition ---
  const settingsKey = `karting_league_${competitionId}_${user?.email || 'anon'}`;
  const loadSettings = () => {
    try {
      const raw = localStorage.getItem(settingsKey);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  };
  const saveSettings = useCallback((partial: Record<string, any>) => {
    try {
      const cur = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      localStorage.setItem(settingsKey, JSON.stringify({ ...cur, ...partial }));
    } catch {}
  }, [settingsKey]);

  const saved = loadSettings();
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => new Set(saved?.hiddenGroups || []));
  const toggleGroup = (g: string) => setHiddenGroups(prev => {
    const n = new Set(prev);
    n.has(g) ? n.delete(g) : n.add(g);
    saveSettings({ hiddenGroups: [...n] });
    return n;
  });

  const [edits, setEdits] = useState<ManualEdits>(initialEdits || {});
  const setEdit = useCallback((pilot: string, raceNum: number, field: string, value: number) => {
    setEdits(prev => {
      const key = `${pilot}|${raceNum}`;
      const oldValue = prev[key]?.[field as keyof typeof prev[typeof key]];
      const next = { ...prev, [key]: { ...prev[key], [field]: value } };
      saveToServer({ edits: next }, { pilot, action: 'edit', detail: `Г${raceNum} ${field}: ${oldValue ?? '—'} → ${value}` });
      return next;
    });
  }, [competitionId]);

  const [excludedPilots, setExcludedPilots] = useState<Set<string>>(new Set(initialExcludedPilots || []));
  const toggleExclude = useCallback((pilot: string) => {
    setExcludedPilots(prev => {
      const next = new Set(prev);
      const wasExcluded = next.has(pilot);
      wasExcluded ? next.delete(pilot) : next.add(pilot);
      saveToServer({ excludedPilots: [...next] }, { pilot, action: wasExcluded ? 'include' : 'exclude', detail: wasExcluded ? 'Повернуто' : 'Виключено' });
      return next;
    });
  }, [competitionId]);

  const saveToServer = useCallback(async (partial: { excludedPilots?: string[]; edits?: ManualEdits }, logEntry?: { pilot: string; action: string; detail: string }) => {
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competitionId)}`);
      if (!res.ok) return;
      const comp = await res.json();
      const currentResults = comp.results || {};
      const editLog = currentResults.editLog || [];
      if (logEntry) {
        editLog.push({ ...logEntry, user: user?.email || 'anon', ts: Date.now() });
      }
      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competitionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ results: { ...currentResults, ...partial, editLog } }),
      });
    } catch {}
  }, [competitionId, user]);

  type SortKey = 'total' | 'quali_time' | `race_${number}_time` | `race_${number}_points`;
  const [sortKey, setSortKey] = useState<SortKey>(() => saved?.sortKey || 'total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => saved?.sortDir || 'desc');
  const toggleSort = (key: SortKey, fixedDir?: 'asc' | 'desc') => {
    let newKey = key;
    let newDir: 'asc' | 'desc';
    if (fixedDir) { newDir = fixedDir; }
    else if (sortKey === key) { newDir = sortDir === 'asc' ? 'desc' : 'asc'; }
    else { newDir = 'desc'; }
    setSortKey(newKey); setSortDir(newDir);
    saveSettings({ sortKey: newKey, sortDir: newDir });
  };


  const data = useMemo(() => {
    if (!scoring) return [];
    return computeStandings({
      format, sessions, sessionLaps: effectiveLaps, scoring, edits,
      excludedPilots, maxGroups, pilotsOverride, pilotsLocked,
      liveSessionId, livePhase, livePositions,
    });
  }, [sessions, effectiveLaps, scoring, edits, raceCount, maxGroups, excludedPilots, liveSessionId, livePhase, livePositions, pilotsOverride, pilotsLocked]);

  const sortedDataRef = useRef<PilotRow[]>([]);
  const sortedData = useMemo(() => {
    if (editingRef.current) return sortedDataRef.current;
    const included = data.filter(r => !excludedPilots.has(r.pilot));
    const excluded = data.filter(r => excludedPilots.has(r.pilot));
    const getValue = (row: PilotRow): number => {
      if (sortKey === 'total') return row.totalPoints;
      if (sortKey === 'quali_time') return row.quali?.bestTime ?? Infinity;
      const m = sortKey.match(/^race_(\d+)_(time|points)$/);
      if (m) { const ri = parseInt(m[1]) - 1; const race = row.races[ri]; return m[2] === 'time' ? (race?.bestTime ?? Infinity) : (race?.totalRacePoints ?? 0); }
      return 0;
    };
    included.sort((a, b) => {
      const diff = sortDir === 'asc' ? getValue(a) - getValue(b) : getValue(b) - getValue(a);
      if (diff !== 0) return diff;
      return (a.quali?.bestTime ?? Infinity) - (b.quali?.bestTime ?? Infinity);
    });
    const result = [...included, ...excluded];
    sortedDataRef.current = result;
    return result;
  }, [data, sortKey, sortDir, excludedPilots]);

  const QUALI_COLS_H = ['q_kart', 'q_time', 'q_speed'] as const;
  const RACE_COLS_H = ['group', 'start', 'finish', 'kart', 'time', 'speed', 'pos_pts', 'overtake', 'penalties', 'sum'] as const;

  type TopGrpId = string;
  const SUB_GROUPS = [
    { id: 'pos', label: 'Поз', cols: ['group', 'start', 'finish'] },
    { id: 'time', label: 'Час', cols: ['kart', 'time', 'speed'] },
    { id: 'pts', label: 'Бали', cols: ['pos_pts', 'overtake', 'penalties', 'sum'] },
  ] as const;
  const TOP_GROUPS = useMemo(() => {
    const groups: { id: TopGrpId; label: string; allCols: string[] }[] = [
      { id: 'quali', label: 'Квала', allCols: [...QUALI_COLS_H] },
    ];
    for (let r = 1; r <= raceCount; r++) {
      groups.push({
        id: `r${r}`,
        label: `Г${r}`,
        allCols: RACE_COLS_H.map(c => `r${r}_${c}`),
      });
    }
    return groups;
  }, [raceCount]);
  const DEFAULT_TOP_ORDER = useMemo(() => TOP_GROUPS.map(g => g.id), [TOP_GROUPS]);
  const topById = useMemo(() => new Map(TOP_GROUPS.map(g => [g.id, g])), [TOP_GROUPS]);

  const [customTopOrder, setCustomTopOrder] = useState<TopGrpId[]>(() => {
    const saved = loadSettings()?.customGrpOrder;
    if (saved && Array.isArray(saved)) {
      const validSet = new Set(DEFAULT_TOP_ORDER);
      const ordered = saved.filter((g: string) => validSet.has(g));
      const missing = DEFAULT_TOP_ORDER.filter(g => !ordered.includes(g));
      return [...ordered, ...missing];
    }
    return [...DEFAULT_TOP_ORDER];
  });
  const [hiddenTopGrps, setHiddenTopGrps] = useState<Set<TopGrpId>>(() => new Set(loadSettings()?.hiddenGrps || []));
  const [hiddenSubGrps, setHiddenSubGrps] = useState<Set<string>>(() => new Set(loadSettings()?.hiddenSubGrps || []));
  useEffect(() => {
    const validSet = new Set(DEFAULT_TOP_ORDER);
    setCustomTopOrder(prev => {
      const ordered = prev.filter(g => validSet.has(g));
      const missing = DEFAULT_TOP_ORDER.filter(g => !ordered.includes(g));
      return ordered.length === DEFAULT_TOP_ORDER.length && missing.length === 0 ? prev : [...ordered, ...missing];
    });
  }, [DEFAULT_TOP_ORDER]);

  const toggleTopGrp = useCallback((gid: TopGrpId) => {
    const isRace = gid !== 'quali';
    if (isRace) {
      const allSubsHidden = SUB_GROUPS.every(sg => hiddenSubGrps.has(`${gid}_${sg.id}`));
      if (allSubsHidden) {
        setHiddenSubGrps(prev => {
          const n = new Set(prev);
          SUB_GROUPS.forEach(sg => n.delete(`${gid}_${sg.id}`));
          saveSettings({ hiddenSubGrps: [...n] });
          return n;
        });
        return;
      }
    }
    setHiddenTopGrps(prev => {
      const n = new Set(prev);
      n.has(gid) ? n.delete(gid) : n.add(gid);
      saveSettings({ hiddenGrps: [...n] });
      return n;
    });
  }, [saveSettings, hiddenSubGrps]);
  const toggleSubGrp = useCallback((raceId: string, subId: string) => {
    const key = `${raceId}_${subId}`;
    setHiddenSubGrps(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      saveSettings({ hiddenSubGrps: [...n] });
      return n;
    });
  }, [saveSettings]);

  const [dragTopGrp, setDragTopGrp] = useState<TopGrpId | null>(null);
  const handleTopDragStart = useCallback((gid: TopGrpId) => { setDragTopGrp(gid); }, []);
  const handleTopDragOver = useCallback((e: React.DragEvent, target: TopGrpId) => {
    e.preventDefault();
    if (!dragTopGrp || dragTopGrp === target) return;
    setCustomTopOrder(prev => {
      const order = [...prev];
      const fi = order.indexOf(dragTopGrp), ti = order.indexOf(target);
      if (fi === -1 || ti === -1) return prev;
      order.splice(fi, 1);
      order.splice(ti, 0, dragTopGrp);
      saveSettings({ customGrpOrder: order });
      return order;
    });
  }, [dragTopGrp, saveSettings]);
  const handleTopDragEnd = useCallback(() => { setDragTopGrp(null); }, []);

  const customVisibleCols = useMemo(() => {
    const s = new Set<string>();
    for (const gid of customTopOrder) {
      if (hiddenTopGrps.has(gid)) continue;
      const g = topById.get(gid);
      if (!g) continue;
      if (gid === 'quali') {
        g.allCols.forEach(c => s.add(c));
      } else {
        for (const sg of SUB_GROUPS) {
          if (hiddenSubGrps.has(`${gid}_${sg.id}`)) continue;
          sg.cols.forEach(c => s.add(`${gid}_${c}`));
        }
      }
    }
    return s;
  }, [customTopOrder, hiddenTopGrps, hiddenSubGrps, topById]);

  if (!scoring) return <div className="card text-center py-6 text-dark-500">Завантаження балів...</div>;
  if (sortedData.length === 0) return <div className="card text-center py-12 text-dark-500">Немає даних</div>;

  const SortBtn = ({ k, label, fixedDir }: { k: SortKey; label: string; fixedDir?: 'asc' | 'desc' }) => (
    <button onClick={() => toggleSort(k, fixedDir)}
      className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${sortKey === k ? 'bg-primary-600/30 text-primary-400' : 'bg-dark-800 text-dark-600 hover:text-dark-400'}`}>
      {label} {fixedDir ? (fixedDir === 'asc' ? '↑' : '↓') : (sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '')}
    </button>
  );

  const showAll = hiddenGroups.has('__show_all');
  const showEditsOnly = hiddenGroups.has('__positions_only');
  const showPointsOnly = hiddenGroups.has('__points_only');
  const showTimeOnly = hiddenGroups.has('__time_only');
  const showEditMode = hiddenGroups.has('__edit');
  const showCustom = hiddenGroups.has('__custom');
  const showQuali = !hiddenGroups.has('quali');
  const showRace = (n: number) => !hiddenGroups.has(`race_${n}`);
  const QUALI_COLS = ['q_kart', 'q_time', 'q_speed'] as const;
  const RACE_COLS = ['group', 'start', 'finish', 'kart', 'time', 'speed', 'pos_pts', 'overtake', 'penalties', 'sum'] as const;
  const raceColId = (raceNum: number, col: string) => `r${raceNum}_${col}`;

  const PRESET_COLS: Record<string, { quali: string[]; race: string[] }> = {
    all: { quali: [...QUALI_COLS], race: [...RACE_COLS] },
    positions: { quali: [], race: ['group', 'start', 'finish'] },
    time: { quali: ['q_kart', 'q_time'], race: ['kart', 'time', 'speed'] },
    points: { quali: ['q_speed'], race: ['pos_pts', 'overtake', 'penalties', 'sum'] },
    edit: { quali: [], race: ['start', 'finish', 'penalties', 'sum'] },
  };

  const activeMode = showAll ? 'all' : showPointsOnly ? 'points' : showTimeOnly ? 'time' : showEditsOnly ? 'positions' : showEditMode ? 'edit' : showCustom ? 'custom' : null;

  const effectiveHidden = (() => {
    if (showCustom) {
      const hidden = new Set<string>();
      for (const g of TOP_GROUPS) g.allCols.forEach(c => { if (!customVisibleCols.has(c)) hidden.add(c); });
      return hidden;
    }
    const preset = PRESET_COLS[activeMode || 'all'] || PRESET_COLS.all;
    const hidden = new Set<string>();
    QUALI_COLS.forEach(c => { if (!preset.quali.includes(c)) hidden.add(c); });
    for (let r = 1; r <= raceCount; r++) {
      RACE_COLS.forEach(c => { if (!preset.race.includes(c)) hidden.add(raceColId(r, c)); });
    }
    return hidden;
  })();

  const colVisible = (colId: string) => !effectiveHidden.has(colId);
  const qualiVisible = () => {
    if (showCustom) return !hiddenTopGrps.has('quali');
    if (activeMode) return PRESET_COLS[activeMode]?.quali.length > 0;
    return showQuali;
  };
  const raceVisible = (n: number) => {
    if (showCustom) {
      const gid = `r${n}`;
      if (hiddenTopGrps.has(gid)) return false;
      return !SUB_GROUPS.every(sg => hiddenSubGrps.has(`${gid}_${sg.id}`));
    }
    if (activeMode) return RACE_COLS.some(c => colVisible(raceColId(n, c)));
    return showRace(n);
  };
  const thClass = (base: string, _colId?: string) => base;

  const topOrder = showCustom ? customTopOrder : DEFAULT_TOP_ORDER;

  const autoTotalPilots = sortedData.filter(r => !excludedPilots.has(r.pilot) && r.quali).length;
  Promise.resolve().then(() => {
    onPilotCount?.(autoTotalPilots);
    onAutoGroups?.(autoGroupsByQuali);

    if (data.length > 0 && onSaveResults) {
      const standings = rowsToStandings(data, excludedPilots);
      const json = JSON.stringify(standings.pilots);
      const now = Date.now();
      if (json !== lastStandingsJsonRef.current && now - lastStandingsPushTsRef.current > 10_000) {
        lastStandingsJsonRef.current = json;
        lastStandingsPushTsRef.current = now;
        onSaveResults({ standings });
      }
    }
  });

  const handlePilotsOverrideChange = (val: number) => {
    setPilotsOverride(val);
    setPilotsLocked(true);
    onSaveResults?.({ totalPilotsOverride: val, totalPilotsLocked: true });
  };
  const handlePilotsUnlock = () => {
    setPilotsLocked(false);
    setPilotsOverride(null);
    onSaveResults?.({ totalPilotsOverride: null, totalPilotsLocked: false });
  };

  const setViewMode = (mode: string) => {
    setHiddenGroups(prev => {
      const n = new Set(prev);
      n.delete('__show_all');
      n.delete('__positions_only');
      n.delete('__points_only');
      n.delete('__time_only');
      n.delete('__edit');
      n.delete('__custom');
      if (mode === 'all') {
        n.delete('quali');
        for (let i = 1; i <= raceCount; i++) n.delete(`race_${i}`);
        n.add('__show_all');
      } else if (mode === 'positions') {
        n.delete('quali');
        for (let i = 1; i <= raceCount; i++) n.delete(`race_${i}`);
        n.add('__positions_only');
      } else if (mode === 'points') {
        n.delete('quali');
        for (let i = 1; i <= raceCount; i++) n.delete(`race_${i}`);
        n.add('__points_only');
      } else if (mode === 'time') {
        n.delete('quali');
        for (let i = 1; i <= raceCount; i++) n.delete(`race_${i}`);
        n.add('__time_only');
      } else if (mode === 'edit') {
        n.delete('quali');
        for (let i = 1; i <= raceCount; i++) n.delete(`race_${i}`);
        n.add('__edit');
      } else if (mode === 'custom') {
        n.delete('quali');
        for (let i = 1; i <= raceCount; i++) n.delete(`race_${i}`);
        n.add('__custom');
      }
      saveSettings({ hiddenGroups: [...n] });
      return n;
    });
  };

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {showLeaguePoints ? (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-dark-800 space-y-1.5 overflow-x-auto">
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => toggleSection('competition', 'leaguePoints')} className="text-white font-semibold text-sm hover:text-dark-300 transition-colors">Таблиця балів ▾</button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap border border-dark-700 rounded-lg px-2.5 py-1">
              <span className="text-dark-500 text-[9px]">Сорт:</span>
              <SortBtn k="total" label="Сума" />
              <SortBtn k="quali_time" label="Квала" fixedDir="asc" />
              {Array.from({ length: raceCount }, (_, i) => (
                <SortBtn key={i} k={`race_${i + 1}_time` as SortKey} label={`Г${i + 1} час`} fixedDir="asc" />
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap border border-dark-700 rounded-lg px-2.5 py-1">
              <span className="text-dark-500 text-[9px]">Вид:</span>
              <span className="flex rounded overflow-hidden">
                <button onClick={() => setViewMode(showAll ? '' : 'all')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showAll ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Все</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showEditsOnly ? '' : 'positions')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showEditsOnly ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Поз</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showTimeOnly ? '' : 'time')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showTimeOnly ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Час</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showPointsOnly ? '' : 'points')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showPointsOnly ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Бали</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showEditMode ? '' : 'edit')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showEditMode ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Ред</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showCustom ? '' : 'custom')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showCustom ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Своє</button>
              </span>
              {showCustom && (
                <>
                  <span className="text-dark-700 text-[9px]">|</span>
                  {customTopOrder.map(gid => {
                    const g = topById.get(gid);
                    if (!g) return null;
                    const topHidden = hiddenTopGrps.has(gid);
                    const isRace = gid !== 'quali';
                    const allSubsHidden = isRace && SUB_GROUPS.every(sg => hiddenSubGrps.has(`${gid}_${sg.id}`));
                    const visible = !topHidden && !allSubsHidden;
                    return (
                      <span key={gid} className="inline-flex items-center border border-dark-700 rounded-lg overflow-hidden"
                        draggable
                        onDragStart={() => handleTopDragStart(gid)}
                        onDragOver={(e) => handleTopDragOver(e, gid)}
                        onDragEnd={handleTopDragEnd}
                      >
                        <button
                          onClick={() => toggleTopGrp(gid)}
                          className={`px-1.5 py-0.5 text-[9px] font-semibold transition-colors cursor-grab active:cursor-grabbing ${
                            dragTopGrp === gid ? 'ring-1 ring-primary-400 opacity-60' : ''
                          } ${visible ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}
                        >
                          {g.label}
                        </button>
                        {isRace && visible && <>
                          <span className="text-dark-700 text-[9px] flex items-center px-0.5">|</span>
                          {SUB_GROUPS.map((sg) => {
                          const subKey = `${gid}_${sg.id}`;
                          const subVis = !hiddenSubGrps.has(subKey);
                          return (
                              <button
                                key={sg.id}
                                onClick={() => toggleSubGrp(gid, sg.id)}
                                className={`px-1 py-0.5 text-[9px] transition-colors ${
                                  subVis ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
                                }`}
                              >
                                {sg.label}
                              </button>
                          );
                        })}
                        </>}
                      </span>
                    );
                  })}
                </>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-[10px] border-separate border-spacing-0" style={{ tableLayout: 'auto', width: 'auto' }}>
              {showCustom ? (() => {
                const visTop = topOrder.filter(gid => !hiddenTopGrps.has(gid));
                const cv = (colId: string) => customVisibleCols.has(colId);
                return <>
                  <thead>
                    <tr className="bg-dark-800/50">
                      <th rowSpan={3} className={`px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-[28px] bg-dark-900 ${STICKY_NUM} z-20`}>#</th>
                      <th rowSpan={3} className={`px-2 py-1 text-left text-dark-300 font-semibold border-r border-dark-700 min-w-[100px] bg-dark-900 ${STICKY_PILOT} z-20`}>Пілот</th>
                      <th rowSpan={3} className="px-1 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-10"><span className={TH_R}>Сума</span></th>
                      {visTop.map(gid => {
                        if (gid === 'quali') {
                          const cnt = QUALI_COLS.filter(c => cv(c)).length;
                          return cnt > 0 ? <th key={gid} colSpan={cnt} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700">Квала</th> : null;
                        }
                        const rn = parseInt(gid.replace('r', ''));
                        const cnt = RACE_COLS.filter(c => cv(raceColId(rn, c))).length;
                        return cnt > 0 ? <th key={gid} colSpan={cnt} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700">Гонка {rn}</th> : null;
                      })}
                    </tr>
                    <tr className="bg-dark-800/30">
                      {visTop.map(gid => {
                        if (gid === 'quali') return <Fragment key={gid}>
                          {cv('q_kart') && <th rowSpan={2} className={TH_V}><span className={TH_R}>Карт</span></th>}
                          {cv('q_time') && <th rowSpan={2} className={TH_V}><span className={TH_R}>Час</span></th>}
                          {cv('q_speed') && <th rowSpan={2} className={TH_V}><span className={TH_R}>Швидк.</span></th>}
                        </Fragment>;
                        const rn = parseInt(gid.replace('r', ''));
                        const posCols = ['group', 'start', 'finish'] as const;
                        const timeCols = ['kart', 'time', 'speed'] as const;
                        const ptsCols = ['pos_pts', 'overtake', 'penalties', 'sum'] as const;
                        const visPos = posCols.filter(c => cv(raceColId(rn, c)));
                        const visTime = timeCols.filter(c => cv(raceColId(rn, c)));
                        const visPts = ptsCols.filter(c => cv(raceColId(rn, c)));
                        const subHdr = "px-1 py-0.5 text-center text-dark-500 text-[9px] border-r border-dark-700/30 border-b border-dark-700/30";
                        return <Fragment key={gid}>
                          {visPos.length > 0 && <th colSpan={visPos.length} className={subHdr}>Позиція</th>}
                          {visTime.length > 0 && <th colSpan={visTime.length} className={subHdr}>Час</th>}
                          {visPts.length > 0 && <th colSpan={visPts.length} className={subHdr}>Бали</th>}
                        </Fragment>;
                      })}
                    </tr>
                    <tr className="bg-dark-800/20">
                      {visTop.map(gid => {
                        if (gid === 'quali') return null;
                        const rn = parseInt(gid.replace('r', ''));
                        const allSubCols = [
                          { col: 'group', label: 'Група' }, { col: 'start', label: 'Старт' }, { col: 'finish', label: 'Фініш' },
                          { col: 'kart', label: 'Карт' }, { col: 'time', label: 'Час' }, { col: 'speed', label: 'Швидк.' },
                          { col: 'pos_pts', label: 'Позиція' }, { col: 'overtake', label: 'Обгони' }, { col: 'penalties', label: 'Штрафи' }, { col: 'sum', label: 'Сума' },
                        ];
                        const visible = allSubCols.filter(sc => cv(raceColId(rn, sc.col)));
                        if (visible.length === 0) return null;
                        return <Fragment key={gid}>
                          {visible.map(sc => <th key={sc.col} className={TH_V}><span className={TH_R}>{sc.label}</span></th>)}
                        </Fragment>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const includedCount = sortedData.filter(r => !excludedPilots.has(r.pilot)).length;
                      const groupSeparators = new Set<number>();
                      if (maxGroups > 1 && includedCount > 1) {
                        const base = Math.floor(includedCount / maxGroups);
                        let rem = includedCount % maxGroups;
                        let pos = 0;
                        for (let g = 0; g < maxGroups - 1; g++) {
                          pos += base + (rem > 0 ? 1 : 0);
                          if (rem > 0) rem--;
                          groupSeparators.add(pos - 1);
                        }
                      }
                      let includedIdx = 0;
                      return sortedData.map((row, i) => {
                        const isExcluded = excludedPilots.has(row.pilot);
                        const isOnTrack = livePilots?.includes(row.pilot);
                        const currentIncIdx = isExcluded ? -1 : includedIdx++;
                        const isGroupEnd = currentIncIdx >= 0 && groupSeparators.has(currentIncIdx);
                        const stickyBg = isOnTrack ? 'bg-green-500/5' : selectedPilot === row.pilot ? 'bg-dark-700/40' : 'bg-dark-900';
                        const cellForCol = (col: string): React.ReactNode => {
                          if (col === 'q_kart') return <td key={col} className={`px-1 py-1 text-center font-mono text-blue-400/70 border-r border-dark-700/30`}>{row.quali?.kart || '—'}</td>;
                          if (col === 'q_time') return <td key={col} className={`px-1 py-1 text-center font-mono text-yellow-300/70 border-r border-dark-700/30`}>{row.quali ? toSeconds(row.quali.bestTimeStr) : '—'}</td>;
                          if (col === 'q_speed') return <td key={col} className={`px-1 py-1 text-center font-mono border-r border-dark-700/30`}>{row.quali?.speedPoints ? <span className="text-green-400/80">{row.quali.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>;
                          const m = col.match(/^r(\d+)_(.+)$/);
                          if (!m) return <td key={col} className="px-1 py-1 text-center border-r border-dark-700/30">—</td>;
                          const rn = parseInt(m[1]), base = m[2];
                          const race = row.races[rn - 1];
                          const posChange = race && race.startPos > 0 && race.finishPos > 0 ? race.startPos - race.finishPos : 0;
                          if (base === 'kart') return <td key={col} className={`px-1 py-1 text-center font-mono text-blue-400/70 border-r border-dark-700/30`}>{race?.kart || '—'}</td>;
                          if (base === 'time') return <td key={col} className={`px-1 py-1 text-center font-mono text-yellow-300/70 border-r border-dark-700/30`}>{race ? toSeconds(race.bestTimeStr) : '—'}</td>;
                          if (base === 'speed') return <td key={col} className={`px-1 py-1 text-center font-mono border-r border-dark-700/30`}>{race?.speedPoints ? <span className="text-green-400/80">{race.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>;
                          if (base === 'group') return <td key={col} className={`px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30`}>{race?.group || '—'}</td>;
                          if (base === 'start') return <td key={col} className={`px-1 py-1 text-center font-mono text-dark-400 border-r border-dark-700/30`}>{race ? (race.startPos === -1 ? <span className="text-red-400">X</span> : canManage ? <EditableCell editingRef={editingRef} value={race.startPos} onChange={v => setEdit(row.pilot, rn, 'startPos', v)} /> : <span>{race.startPos}</span>) : '—'}</td>;
                          if (base === 'finish') return <td key={col} className={`px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30`}>{race ? (<span className="inline-flex items-center gap-0.5">{canManage ? <EditableCell editingRef={editingRef} value={race.finishPos} onChange={v => setEdit(row.pilot, rn, 'finishPos', v)} /> : <span>{race.finishPos}</span>}{posChange !== 0 && <span className={`text-[8px] ${posChange > 0 ? 'text-green-400' : 'text-red-400'}`}>{posChange > 0 ? `▲${posChange}` : `▼${Math.abs(posChange)}`}</span>}</span>) : '—'}</td>;
                          if (base === 'pos_pts') return <td key={col} className={`px-1 py-1 text-center font-mono border-r border-dark-700/30`}>{race?.positionPoints ? <span className="text-green-400/60">{race.positionPoints}</span> : <span className="text-dark-700">—</span>}</td>;
                          if (base === 'overtake') return <td key={col} className={`px-1 py-1 text-center font-mono border-r border-dark-700/30`}>{race?.overtakePoints ? <span className="text-green-400/60">{race.overtakePoints}</span> : <span className="text-dark-700">—</span>}</td>;
                          if (base === 'penalties') return <td key={col} className={`px-1 py-1 text-center font-mono border-r border-dark-700/30`}>{race ? (canManage ? <EditableCell editingRef={editingRef} value={race.penalties} onChange={v => setEdit(row.pilot, rn, 'penalties', v)} colorClass={race.penalties ? 'text-red-400' : 'text-dark-300'} prefix="-" /> : race.penalties ? <span className="text-red-400">-{race.penalties}</span> : <span className="text-dark-700">—</span>) : '—'}</td>;
                          if (base === 'sum') return <td key={col} className={`px-1 py-1 text-center font-mono font-bold border-r border-dark-700/30`}>{race?.totalRacePoints ? <span className="text-green-400/80">{race.totalRacePoints}</span> : <span className="text-dark-700">—</span>}</td>;
                          return <td key={col} className="px-1 py-1 text-center border-r border-dark-700/30">—</td>;
                        };
                        return (
                          <tr key={row.pilot} onClick={() => setSelectedPilot(prev => prev === row.pilot ? null : row.pilot)}
                            className={`border-b ${isGroupEnd ? 'border-b-2 border-dark-600' : 'border-dark-800/50'} ${isExcluded ? 'opacity-30' : isOnTrack ? 'bg-green-500/5' : selectedPilot === row.pilot ? 'bg-dark-700/40' : 'hover:bg-dark-700/30'}`}>
                            <td className={`px-2 py-1 text-center font-mono text-white font-bold border-r border-dark-700 ${stickyBg} ${STICKY_NUM}`}>{isExcluded ? '—' : i + 1}</td>
                            <td className={`px-2 py-1 text-left border-r border-dark-700 whitespace-nowrap ${stickyBg} ${STICKY_PILOT}`}>
                              {renamingPilot === row.pilot ? (
                                <form onSubmit={(e) => {
                                  e.preventDefault();
                                  const newName = renameValue.trim();
                                  if (newName && newName !== row.pilot) {
                                    setRenamingPilot(null);
                                    (async () => {
                                      for (const s of sessions) {
                                        await fetch(`${COLLECTOR_URL}/db/rename-pilot`, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
                                          body: JSON.stringify({ sessionId: s.sessionId, oldName: row.pilot, newName }),
                                        }).catch(() => {});
                                      }
                                      window.location.reload();
                                    })();
                                  } else {
                                    setRenamingPilot(null);
                                  }
                                }} className="flex items-center gap-1">
                                  <input autoFocus type="text" value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Escape') setRenamingPilot(null); }}
                                    className="w-32 bg-dark-800 border border-primary-500 text-white text-[10px] rounded px-1.5 py-0.5 outline-none" />
                                </form>
                              ) : (
                                <>
                                  <span className="text-white">{row.pilot}</span>
                                  {canManage && (
                                    <>
                                      <button onClick={() => { setRenamingPilot(row.pilot); setRenameValue(row.pilot); }}
                                        className="ml-1 text-[9px] px-0.5 rounded text-dark-600 hover:text-primary-400 transition-colors">✎</button>
                                      <button onClick={() => toggleExclude(row.pilot)}
                                        className={`text-[9px] px-0.5 rounded transition-colors ${isExcluded ? 'text-green-400/60 hover:text-green-400' : 'text-dark-600 hover:text-red-400'}`}>
                                        {isExcluded ? '↩' : '✕'}
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </td>
                            <td className={`px-1 py-1 text-center font-mono text-green-400 font-bold ${SECTION_BORDER}`}>{row.totalPoints || '—'}</td>
                            {visTop.flatMap(gid => {
                              const g = topById.get(gid);
                              if (!g) return [];
                              return g.allCols.filter(c => cv(c)).map(col => cellForCol(col));
                            })}
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </>;
              })() : (<>
              <thead>
                <tr className="bg-dark-800/50">
                  <th rowSpan={3} className={`px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-[28px] bg-dark-900 ${STICKY_NUM} z-20`}>#</th>
                  <th rowSpan={3} className={`px-2 py-1 text-left text-dark-300 font-semibold border-r border-dark-700 min-w-[100px] bg-dark-900 ${STICKY_PILOT} z-20`}>Пілот</th>
                  <th rowSpan={3} className="px-1 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-10"><span className={TH_R}>Сума</span></th>
                  {qualiVisible() && (() => {
                    const visCount = QUALI_COLS.filter(c => colVisible(c)).length;
                    if (visCount === 0) return null;
                    return <th colSpan={visCount} className={thClass("px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700")}>Квала</th>;
                  })()}
                  {Array.from({ length: raceCount }, (_, i) => {
                    const rn = i + 1;
                    if (!raceVisible(rn)) return null;
                    const raceColId_ = (c: string) => `r${rn}_${c}`;
                    const visCount = RACE_COLS.filter(c => colVisible(raceColId_(c))).length;
                    if (visCount === 0) return null;
                    return <th key={i} colSpan={visCount} className={thClass("px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700")}>Гонка {rn}</th>;
                  })}
                </tr>
                <tr className="bg-dark-800/30">
                  {qualiVisible() && <>
                    {colVisible('q_kart') && <th rowSpan={2} className={thClass(TH_V)}><span className={TH_R}>Карт</span></th>}
                    {colVisible('q_time') && <th rowSpan={2} className={thClass(TH_V)}><span className={TH_R}>Час</span></th>}
                    {colVisible('q_speed') && <th rowSpan={2} className={thClass(TH_V)}><span className={TH_R}>Швидк.</span></th>}
                  </>}
                  {Array.from({ length: raceCount }, (_, i) => {
                    const rn = i + 1;
                    if (!raceVisible(rn)) return null;
                    const posCols = ['group', 'start', 'finish'] as const;
                    const timeCols = ['kart', 'time', 'speed'] as const;
                    const ptsCols = ['pos_pts', 'overtake', 'penalties', 'sum'] as const;
                    const visPos = posCols.filter(c => colVisible(raceColId(rn, c)));
                    const visTime = timeCols.filter(c => colVisible(raceColId(rn, c)));
                    const visPts = ptsCols.filter(c => colVisible(raceColId(rn, c)));
                    const subHdr = "px-1 py-0.5 text-center text-dark-500 text-[9px] border-r border-dark-700/30 border-b border-dark-700/30";
                    return (
                      <Fragment key={i}>
                        {visPos.length > 0 && <th colSpan={visPos.length} className={subHdr}>Позиція</th>}
                        {visTime.length > 0 && <th colSpan={visTime.length} className={subHdr}>Час</th>}
                        {visPts.length > 0 && <th colSpan={visPts.length} className={subHdr}>Бали</th>}
                      </Fragment>
                    );
                  })}
                </tr>
                <tr className="bg-dark-800/20">
                  {Array.from({ length: raceCount }, (_, i) => {
                    const rn = i + 1;
                    if (!raceVisible(rn)) return null;
                    return (
                      <Fragment key={i}>
                        {colVisible(raceColId(rn, 'group')) && <th className={thClass(TH_V)}><span className={TH_R}>Група</span></th>}
                        {colVisible(raceColId(rn, 'start')) && <th className={thClass(TH_V)}><span className={TH_R}>Старт</span></th>}
                        {colVisible(raceColId(rn, 'finish')) && <th className={thClass(TH_V)}><span className={TH_R}>Фініш</span></th>}
                        {colVisible(raceColId(rn, 'kart')) && <th className={thClass(TH_V)}><span className={TH_R}>Карт</span></th>}
                        {colVisible(raceColId(rn, 'time')) && <th className={thClass(TH_V)}><span className={TH_R}>Час</span></th>}
                        {colVisible(raceColId(rn, 'speed')) && <th className={thClass(TH_V)}><span className={TH_R}>Швидк.</span></th>}
                        {colVisible(raceColId(rn, 'pos_pts')) && <th className={thClass(TH_V)}><span className={TH_R}>Позиція</span></th>}
                        {colVisible(raceColId(rn, 'overtake')) && <th className={thClass(TH_V)}><span className={TH_R}>Обгони</span></th>}
                        {colVisible(raceColId(rn, 'penalties')) && <th className={thClass(TH_V)}><span className={TH_R}>Штрафи</span></th>}
                        {colVisible(raceColId(rn, 'sum')) && <th className={thClass(TH_V)}><span className={TH_R}>Сума</span></th>}
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                  {(() => {
                    const includedCount = sortedData.filter(r => !excludedPilots.has(r.pilot)).length;
                    const groupSeparators = new Set<number>();
                    if (maxGroups > 1 && includedCount > 1) {
                      const base = Math.floor(includedCount / maxGroups);
                      let rem = includedCount % maxGroups;
                      let pos = 0;
                      for (let g = 0; g < maxGroups - 1; g++) {
                        pos += base + (rem > 0 ? 1 : 0);
                        if (rem > 0) rem--;
                        groupSeparators.add(pos - 1);
                      }
                    }
                    let includedIdx = 0;
                    return sortedData.map((row, i) => {
                    const isExcluded = excludedPilots.has(row.pilot);
                    const isOnTrack = livePilots?.includes(row.pilot);
                    const currentIncIdx = isExcluded ? -1 : includedIdx++;
                    const isGroupEnd = currentIncIdx >= 0 && groupSeparators.has(currentIncIdx);
                    const stickyBg = isOnTrack ? 'bg-green-500/5' : selectedPilot === row.pilot ? 'bg-dark-700/40' : 'bg-dark-900';
                    return (
                    <tr key={row.pilot} onClick={() => setSelectedPilot(prev => prev === row.pilot ? null : row.pilot)}
                      className={`border-b ${isGroupEnd ? 'border-b-2 border-dark-600' : 'border-dark-800/50'} ${isExcluded ? 'opacity-30' : isOnTrack ? 'bg-green-500/5' : selectedPilot === row.pilot ? 'bg-dark-700/40' : 'hover:bg-dark-700/30'}`}>
                      <td className={`px-2 py-1 text-center font-mono text-white font-bold border-r border-dark-700 ${stickyBg} ${STICKY_NUM}`}>{isExcluded ? '—' : i + 1}</td>
                      <td className={`px-2 py-1 text-left border-r border-dark-700 whitespace-nowrap ${stickyBg} ${STICKY_PILOT}`}>
                        {renamingPilot === row.pilot ? (
                          <form onSubmit={(e) => {
                            e.preventDefault();
                            const newName = renameValue.trim();
                            if (newName && newName !== row.pilot) {
                              setRenamingPilot(null);
                              (async () => {
                                for (const s of sessions) {
                                  await fetch(`${COLLECTOR_URL}/db/rename-pilot`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
                                    body: JSON.stringify({ sessionId: s.sessionId, oldName: row.pilot, newName }),
                                  }).catch(() => {});
                                }
                                window.location.reload();
                              })();
                            } else {
                              setRenamingPilot(null);
                            }
                          }} className="flex items-center gap-1">
                            <input autoFocus type="text" value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Escape') setRenamingPilot(null); }}
                              className="w-32 bg-dark-800 border border-primary-500 text-white text-[10px] rounded px-1.5 py-0.5 outline-none" />
                          </form>
                        ) : (
                          <>
                            <span className="text-white">{row.pilot}</span>
                            {canManage && (
                              <>
                                <button onClick={() => { setRenamingPilot(row.pilot); setRenameValue(row.pilot); }}
                                  className="ml-1 text-[9px] px-0.5 rounded text-dark-600 hover:text-primary-400 transition-colors">✎</button>
                                <button onClick={() => toggleExclude(row.pilot)}
                                  className={`text-[9px] px-0.5 rounded transition-colors ${isExcluded ? 'text-green-400/60 hover:text-green-400' : 'text-dark-600 hover:text-red-400'}`}>
                                  {isExcluded ? '↩' : '✕'}
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </td>
                    <td className={`px-1 py-1 text-center font-mono text-green-400 font-bold ${SECTION_BORDER}`}>{row.totalPoints || '—'}</td>
                    {qualiVisible() && (() => {
                      const visCols = QUALI_COLS.filter(c => colVisible(c));
                      const lastCol = visCols[visCols.length - 1];
                      const qBorder = (c: string) => c === lastCol ? SECTION_BORDER : 'border-r border-dark-700/30';
                      return <>
                        {colVisible('q_kart') && <td className={`px-1 py-1 text-center font-mono text-blue-400/70 ${qBorder('q_kart')}`}>{row.quali?.kart || '—'}</td>}
                        {colVisible('q_time') && <td className={`px-1 py-1 text-center font-mono text-yellow-300/70 ${qBorder('q_time')}`}>{row.quali ? toSeconds(row.quali.bestTimeStr) : '—'}</td>}
                        {colVisible('q_speed') && <td className={`px-1 py-1 text-center font-mono ${qBorder('q_speed')}`}>{row.quali?.speedPoints ? <span className="text-green-400/80">{row.quali.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>}
                      </>;
                    })()}
                    {row.races.map((race, ri) => {
                      const rn = ri + 1;
                      if (!raceVisible(rn)) return null;
                      const cv = (c: string) => colVisible(raceColId(rn, c));
                      const posChange = race && race.startPos > 0 && race.finishPos > 0 ? race.startPos - race.finishPos : 0;
                      const visRaceCols = RACE_COLS.filter(c => cv(c));
                      const lastRaceCol = visRaceCols[visRaceCols.length - 1];
                      const rBorder = (c: string) => c === lastRaceCol ? SECTION_BORDER : 'border-r border-dark-700/30';
                      return (
                        <Fragment key={ri}>
                          {cv('group') && <td className={`px-1 py-1 text-center font-mono text-dark-500 ${rBorder('group')}`}>{race?.group || '—'}</td>}
                          {cv('start') && <td className={`px-1 py-1 text-center font-mono text-dark-400 ${rBorder('start')}`}>
                            {race ? (race.startPos === -1 ? <span className="text-red-400">X</span> : canManage ? <EditableCell editingRef={editingRef} value={race.startPos} onChange={v => setEdit(row.pilot, rn, 'startPos', v)} /> : <span>{race.startPos}</span>) : '—'}
                          </td>}
                          {cv('finish') && <td className={`px-1 py-1 text-center font-mono text-dark-300 ${rBorder('finish')}`}>
                            {race ? (
                              <span className="inline-flex items-center gap-0.5">
                                {canManage ? <EditableCell editingRef={editingRef} value={race.finishPos} onChange={v => setEdit(row.pilot, rn, 'finishPos', v)} /> : <span>{race.finishPos}</span>}
                                {posChange !== 0 && <span className={`text-[8px] ${posChange > 0 ? 'text-green-400' : 'text-red-400'}`}>{posChange > 0 ? `▲${posChange}` : `▼${Math.abs(posChange)}`}</span>}
                              </span>
                            ) : '—'}
                          </td>}
                          {cv('kart') && <td className={`px-1 py-1 text-center font-mono text-blue-400/70 ${rBorder('kart')}`}>{race?.kart || '—'}</td>}
                          {cv('time') && <td className={`px-1 py-1 text-center font-mono text-yellow-300/70 ${rBorder('time')}`}>{race ? toSeconds(race.bestTimeStr) : '—'}</td>}
                          {cv('speed') && <td className={`px-1 py-1 text-center font-mono ${rBorder('speed')}`}>{race?.speedPoints ? <span className="text-green-400/80">{race.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>}
                          {cv('pos_pts') && <td className={`px-1 py-1 text-center font-mono ${rBorder('pos_pts')}`}>{race?.positionPoints ? <span className="text-green-400/60">{race.positionPoints}</span> : <span className="text-dark-700">—</span>}</td>}
                          {cv('overtake') && <td className={`px-1 py-1 text-center font-mono ${rBorder('overtake')}`}>{race?.overtakePoints ? <span className="text-green-400/60">{race.overtakePoints}</span> : <span className="text-dark-700">—</span>}</td>}
                          {cv('penalties') && <td className={`px-1 py-1 text-center font-mono ${rBorder('penalties')}`}>
                            {race ? (canManage ? <EditableCell editingRef={editingRef} value={race.penalties} onChange={v => setEdit(row.pilot, rn, 'penalties', v)} colorClass={race.penalties ? 'text-red-400' : 'text-dark-300'} prefix="-" /> : race.penalties ? <span className="text-red-400">-{race.penalties}</span> : <span className="text-dark-700">—</span>) : '—'}
                          </td>}
                          {cv('sum') && <td className={`px-1 py-1 text-center font-mono font-bold ${rBorder('sum')}`}>{race?.totalRacePoints ? <span className="text-green-400/80">{race.totalRacePoints}</span> : <span className="text-dark-700">—</span>}</td>}
                        </Fragment>
                      );
                    })}
                  </tr>
                    );
                  });
                  })()}
              </tbody>
              </>)}
            </table>
          </div>
        </div>
      ) : (
        <button onClick={() => toggleSection('competition', 'leaguePoints')} className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-dark-800 text-dark-500 hover:text-white transition-colors">Таблиця балів ▸</button>
      )}

      {canManage && (
        <EditLog competitionId={competitionId} />
      )}
    </div>
  );
}

function EditLog({ competitionId }: { competitionId: string }) {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<{ pilot: string; action: string; detail: string; user: string; ts: number }[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competitionId)}`)
      .then(r => r.json())
      .then(c => {
        const results = typeof c.results === 'string' ? JSON.parse(c.results) : (c.results || {});
        setLog((results.editLog || []).slice().reverse());
      })
      .catch(() => {});
  }, [open, competitionId]);

  return (
    <div>
      <button onClick={() => setOpen(v => !v)} className="px-2 py-0.5 rounded text-[9px] bg-dark-800 text-dark-600 hover:text-dark-400 transition-colors">
        {open ? 'Сховати журнал ▾' : 'Журнал змін ▸'}
      </button>
      {open && (
        <div className="mt-2 card p-0 overflow-hidden max-h-60 overflow-y-auto">
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
      )}
    </div>
  );
}
