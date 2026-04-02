import { useMemo, Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { toSeconds } from '../../utils/timing';
import { useViewPrefs } from '../../services/viewPrefs';
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
  const { prefs, toggle } = useViewPrefs();
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
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(saved?.hiddenCols || []));
  const toggleGroup = (g: string) => setHiddenGroups(prev => {
    const n = new Set(prev);
    n.has(g) ? n.delete(g) : n.add(g);
    saveSettings({ hiddenGroups: [...n] });
    return n;
  });
  const isCustomMode = hiddenGroups.has('__custom');
  const toggleCol = (colId: string) => {
    if (!isCustomMode) return;
    setHiddenCols(prev => {
      const n = new Set(prev);
      n.has(colId) ? n.delete(colId) : n.add(colId);
      saveSettings({ hiddenCols: [...n], customCols: [...n] });
      return n;
    });
  };
  const toggleGroupCols = (groupPrefix: string, subCols: string[]) => {
    if (!isCustomMode) return;
    setHiddenCols(prev => {
      const n = new Set(prev);
      const allHidden = subCols.every(c => n.has(c));
      subCols.forEach(c => allHidden ? n.delete(c) : n.add(c));
      saveSettings({ hiddenCols: [...n], customCols: [...n] });
      return n;
    });
  };

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
  const showCustom = hiddenGroups.has('__custom');
  const showQuali = !hiddenGroups.has('quali');
  const showRace = (n: number) => !hiddenGroups.has(`race_${n}`);
  const QUALI_COLS = ['q_kart', 'q_time', 'q_speed'] as const;
  const RACE_COLS = ['kart', 'time', 'speed', 'group', 'start', 'finish', 'pos_pts', 'overtake', 'penalties', 'sum'] as const;
  const raceColId = (raceNum: number, col: string) => `r${raceNum}_${col}`;
  const allRaceCols = (raceNum: number) => RACE_COLS.map(c => raceColId(raceNum, c));

  const PRESET_COLS: Record<string, { quali: string[]; race: string[] }> = {
    all: { quali: [...QUALI_COLS], race: [...RACE_COLS] },
    points: { quali: ['q_speed'], race: ['speed', 'pos_pts', 'overtake', 'penalties', 'sum'] },
    time: { quali: ['q_kart', 'q_time'], race: ['kart', 'time'] },
    positions: { quali: [], race: ['start', 'finish', 'penalties', 'sum'] },
  };

  const activeMode = showAll ? 'all' : showPointsOnly ? 'points' : showTimeOnly ? 'time' : showEditsOnly ? 'positions' : showCustom ? 'custom' : null;
  const effectiveHidden = (() => {
    if (showCustom) return hiddenCols;
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
    if (activeMode && !showCustom) return PRESET_COLS[activeMode]?.quali.length > 0;
    if (!showCustom) return showQuali;
    return QUALI_COLS.some(c => colVisible(c));
  };
  const raceVisible = (n: number) => {
    if (activeMode) return RACE_COLS.some(c => colVisible(raceColId(n, c)));
    return showRace(n);
  };
  const thClick = (colId: string) => isCustomMode ? () => toggleCol(colId) : undefined;
  const thGroupClick = (prefix: string, cols: string[]) => isCustomMode ? () => toggleGroupCols(prefix, cols) : undefined;
  const thClass = (base: string, colId?: string) =>
    `${base}${isCustomMode ? ' cursor-pointer hover:bg-dark-600/30' : ''}`;

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
      } else if (mode === 'custom') {
        n.delete('quali');
        for (let i = 1; i <= raceCount; i++) n.delete(`race_${i}`);
        n.add('__custom');
        const savedCustom = loadSettings()?.customCols;
        setHiddenCols(new Set(savedCustom || []));
      }
      saveSettings({ hiddenGroups: [...n] });
      return n;
    });
  };

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {prefs.showLeaguePoints ? (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-dark-800 space-y-1.5 overflow-x-auto">
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => toggle('showLeaguePoints')} className="text-white font-semibold text-sm hover:text-dark-300 transition-colors">Таблиця балів ▾</button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-dark-500 text-[9px]">Сорт:</span>
              <SortBtn k="total" label="Сума" />
              <SortBtn k="quali_time" label="Квала" fixedDir="asc" />
              {Array.from({ length: raceCount }, (_, i) => (
                <SortBtn key={i} k={`race_${i + 1}_time` as SortKey} label={`Г${i + 1} час`} fixedDir="asc" />
              ))}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-dark-500 text-[9px]">Вид:</span>
              <span className="flex rounded overflow-hidden">
                <button onClick={() => setViewMode(showAll ? '' : 'all')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showAll ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Все</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showPointsOnly ? '' : 'points')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showPointsOnly ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Бали</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showTimeOnly ? '' : 'time')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showTimeOnly ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Час</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showEditsOnly ? '' : 'positions')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showEditsOnly ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Поз</button>
                <span className="text-dark-700 text-[9px] bg-dark-800 flex items-center">/</span>
                <button onClick={() => setViewMode(showCustom ? '' : 'custom')} className={`px-1.5 py-0.5 text-[9px] transition-colors ${showCustom ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Ост</button>
              </span>
              <button onClick={() => {
                if (showCustom) { toggleGroupCols('quali', [...QUALI_COLS]); }
                else { setViewMode(''); toggleGroup('quali'); }
              }} className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                qualiVisible() ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
              }`}>Квала</button>
              {Array.from({ length: raceCount }, (_, i) => (
                <button key={i} onClick={() => {
                  if (showCustom) { toggleGroupCols(`race_${i+1}`, allRaceCols(i+1)); }
                  else { setViewMode(''); toggleGroup(`race_${i + 1}`); }
                }} className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                  raceVisible(i+1) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
                }`}>Г{i + 1}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="text-[10px] border-collapse" style={{ tableLayout: 'auto', width: 'auto' }}>
              <thead>
                <tr className="bg-dark-800/50">
                  <th rowSpan={3} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-6">#</th>
                  <th rowSpan={3} className="px-2 py-1 text-left text-dark-300 font-semibold border-r border-dark-700 min-w-[100px]">Пілот</th>
                  <th rowSpan={3} className="px-1 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-10"><span className={TH_R}>Сума</span></th>
                  {qualiVisible() && (() => {
                    const visCount = QUALI_COLS.filter(c => colVisible(c)).length;
                    if (visCount === 0) return null;
                    return <th colSpan={visCount} className={thClass("px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700")}
                      onClick={thGroupClick('quali', [...QUALI_COLS])}>Квала</th>;
                  })()}
                  {Array.from({ length: raceCount }, (_, i) => {
                    const rn = i + 1;
                    if (!raceVisible(rn)) return null;
                    const visCount = RACE_COLS.filter(c => colVisible(raceColId(rn, c))).length;
                    if (visCount === 0) return null;
                    return <th key={i} colSpan={visCount} className={thClass("px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700")}
                      onClick={thGroupClick(`race_${rn}`, allRaceCols(rn))}>Гонка {rn}</th>;
                  })}
                </tr>
                <tr className="bg-dark-800/30">
                  {qualiVisible() && <>
                    {colVisible('q_kart') && <th rowSpan={2} className={thClass(TH_V, 'q_kart')} onClick={thClick('q_kart')}><span className={TH_R}>Карт</span></th>}
                    {colVisible('q_time') && <th rowSpan={2} className={thClass(TH_V, 'q_time')} onClick={thClick('q_time')}><span className={TH_R}>Час</span></th>}
                    {colVisible('q_speed') && <th rowSpan={2} className={thClass(TH_V, 'q_speed')} onClick={thClick('q_speed')}><span className={TH_R}>Швидк.</span></th>}
                  </>}
                  {Array.from({ length: raceCount }, (_, i) => {
                    const rn = i + 1;
                    if (!raceVisible(rn)) return null;
                    const subCols = ['pos_pts', 'overtake', 'penalties', 'sum'] as const;
                    const visibleSubCols = subCols.filter(c => colVisible(raceColId(rn, c)));
                    return (
                      <Fragment key={i}>
                        {colVisible(raceColId(rn, 'kart')) && <th rowSpan={2} className={thClass(TH_V, raceColId(rn, 'kart'))} onClick={thClick(raceColId(rn, 'kart'))}><span className={TH_R}>Карт</span></th>}
                        {colVisible(raceColId(rn, 'time')) && <th rowSpan={2} className={thClass(TH_V, raceColId(rn, 'time'))} onClick={thClick(raceColId(rn, 'time'))}><span className={TH_R}>Час</span></th>}
                        {colVisible(raceColId(rn, 'speed')) && <th rowSpan={2} className={thClass(TH_V, raceColId(rn, 'speed'))} onClick={thClick(raceColId(rn, 'speed'))}><span className={TH_R}>Швидк.</span></th>}
                        {colVisible(raceColId(rn, 'group')) && <th rowSpan={2} className={thClass(TH_V, raceColId(rn, 'group'))} onClick={thClick(raceColId(rn, 'group'))}><span className={TH_R}>Група</span></th>}
                        {colVisible(raceColId(rn, 'start')) && <th rowSpan={2} className={thClass(TH_V, raceColId(rn, 'start'))} onClick={thClick(raceColId(rn, 'start'))}><span className={TH_R}>Старт</span></th>}
                        {colVisible(raceColId(rn, 'finish')) && <th rowSpan={2} className={thClass(TH_V, raceColId(rn, 'finish'))} onClick={thClick(raceColId(rn, 'finish'))}><span className={TH_R}>Фініш</span></th>}
                        {visibleSubCols.length > 0 && (
                          <th colSpan={visibleSubCols.length}
                            className={`px-1 py-0.5 text-center text-dark-500 text-[9px] border-r border-dark-700/30 border-b border-dark-700/30${isCustomMode ? ' cursor-pointer hover:bg-dark-600/30' : ''}`}
                            onClick={thGroupClick(`r${rn}_pts`, subCols.map(c => raceColId(rn, c)))}>Бали</th>
                        )}
                      </Fragment>
                    );
                  })}
                </tr>
                <tr className="bg-dark-800/20">
                  {Array.from({ length: raceCount }, (_, i) => {
                    const rn = i + 1;
                    if (!raceVisible(rn)) return null;
                    const subCols = ['pos_pts', 'overtake', 'penalties', 'sum'] as const;
                    const anyVisible = subCols.some(c => colVisible(raceColId(rn, c)));
                    if (!anyVisible) return null;
                    return (
                      <Fragment key={i}>
                        {colVisible(raceColId(rn, 'pos_pts')) && <th className={thClass(TH_V, raceColId(rn, 'pos_pts'))} onClick={thClick(raceColId(rn, 'pos_pts'))}><span className={TH_R}>Позиція</span></th>}
                        {colVisible(raceColId(rn, 'overtake')) && <th className={thClass(TH_V, raceColId(rn, 'overtake'))} onClick={thClick(raceColId(rn, 'overtake'))}><span className={TH_R}>Обгони</span></th>}
                        {colVisible(raceColId(rn, 'penalties')) && <th className={thClass(TH_V, raceColId(rn, 'penalties'))} onClick={thClick(raceColId(rn, 'penalties'))}><span className={TH_R}>Штрафи</span></th>}
                        {colVisible(raceColId(rn, 'sum')) && <th className={thClass(TH_V, raceColId(rn, 'sum'))} onClick={thClick(raceColId(rn, 'sum'))}><span className={TH_R}>Сума</span></th>}
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                  {sortedData.map((row, i) => {
                    const isExcluded = excludedPilots.has(row.pilot);
                    const isOnTrack = livePilots?.includes(row.pilot);
                    // Check if next row is in a different group (for group separator line)
                    const nextRow = i + 1 < sortedData.length ? sortedData[i + 1] : null;
                    const currentGroup = row.races[0]?.group || 0;
                    const nextGroup = nextRow?.races[0]?.group || 0;
                    const isGroupEnd = currentGroup > 0 && currentGroup !== nextGroup;
                    return (
                    <tr key={row.pilot} onClick={() => setSelectedPilot(prev => prev === row.pilot ? null : row.pilot)}
                      className={`border-b ${isGroupEnd ? 'border-b-2 border-dark-600' : 'border-dark-800/50'} ${isExcluded ? 'opacity-30' : isOnTrack ? 'bg-green-500/5' : selectedPilot === row.pilot ? 'bg-dark-700/40' : 'hover:bg-dark-700/30'}`}>
                      <td className="px-2 py-1 text-center font-mono text-white font-bold border-r border-dark-700">{isExcluded ? '—' : i + 1}</td>
                      <td className="px-2 py-1 text-left border-r border-dark-700 whitespace-nowrap">
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
                    <td className="px-1 py-1 text-center font-mono text-green-400 font-bold border-r border-dark-700">{row.totalPoints || '—'}</td>
                    {qualiVisible() && <>
                      {colVisible('q_kart') && <td className="px-1 py-1 text-center font-mono text-blue-400/70 border-r border-dark-700/30">{row.quali?.kart || '—'}</td>}
                      {colVisible('q_time') && <td className="px-1 py-1 text-center font-mono text-yellow-300/70 border-r border-dark-700/30">{row.quali ? toSeconds(row.quali.bestTimeStr) : '—'}</td>}
                      {colVisible('q_speed') && <td className="px-1 py-1 text-center font-mono border-r border-dark-700">{row.quali?.speedPoints ? <span className="text-green-400/80">{row.quali.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>}
                    </>}
                    {row.races.map((race, ri) => {
                      const rn = ri + 1;
                      if (!raceVisible(rn)) return null;
                      const cv = (c: string) => colVisible(raceColId(rn, c));
                      const posChange = race && race.startPos > 0 && race.finishPos > 0 ? race.startPos - race.finishPos : 0;
                      return (
                        <Fragment key={ri}>
                          {cv('kart') && <td className="px-1 py-1 text-center font-mono text-blue-400/70 border-r border-dark-700/30">{race?.kart || '—'}</td>}
                          {cv('time') && <td className="px-1 py-1 text-center font-mono text-yellow-300/70 border-r border-dark-700/30">{race ? toSeconds(race.bestTimeStr) : '—'}</td>}
                          {cv('speed') && <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.speedPoints ? <span className="text-green-400/80">{race.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>}
                          {cv('group') && <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.group || '—'}</td>}
                          {cv('start') && <td className="px-1 py-1 text-center font-mono text-dark-400 border-r border-dark-700/30">
                            {race ? (race.startPos === -1 ? <span className="text-red-400">X</span> : canManage ? <EditableCell editingRef={editingRef} value={race.startPos} onChange={v => setEdit(row.pilot, rn, 'startPos', v)} /> : <span>{race.startPos}</span>) : '—'}
                          </td>}
                          {cv('finish') && <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30">
                            {race ? (
                              <span className="inline-flex items-center gap-0.5">
                                {canManage ? <EditableCell editingRef={editingRef} value={race.finishPos} onChange={v => setEdit(row.pilot, rn, 'finishPos', v)} /> : <span>{race.finishPos}</span>}
                                {posChange !== 0 && <span className={`text-[8px] ${posChange > 0 ? 'text-green-400' : 'text-red-400'}`}>{posChange > 0 ? `▲${posChange}` : `▼${Math.abs(posChange)}`}</span>}
                              </span>
                            ) : '—'}
                          </td>}
                          {cv('pos_pts') && <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.positionPoints ? <span className="text-green-400/60">{race.positionPoints}</span> : <span className="text-dark-700">—</span>}</td>}
                          {cv('overtake') && <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.overtakePoints ? <span className="text-green-400/60">{race.overtakePoints}</span> : <span className="text-dark-700">—</span>}</td>}
                          {cv('penalties') && <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">
                            {race ? (canManage ? <EditableCell editingRef={editingRef} value={race.penalties} onChange={v => setEdit(row.pilot, rn, 'penalties', v)} colorClass={race.penalties ? 'text-red-400' : 'text-dark-300'} prefix="-" /> : race.penalties ? <span className="text-red-400">-{race.penalties}</span> : <span className="text-dark-700">—</span>) : '—'}
                          </td>}
                          {cv('sum') && <td className="px-1 py-1 text-center font-mono font-bold border-r border-dark-700">{race?.totalRacePoints ? <span className="text-green-400/80">{race.totalRacePoints}</span> : <span className="text-dark-700">—</span>}</td>}
                        </Fragment>
                      );
                    })}
                  </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <button onClick={() => toggle('showLeaguePoints')} className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-dark-800 text-dark-500 hover:text-white transition-colors">Таблиця балів ▸</button>
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
