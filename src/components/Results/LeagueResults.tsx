import { useMemo, Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { toSeconds } from '../../utils/timing';
import { PHASE_CONFIGS, splitIntoGroups } from '../../data/competitions';
import { useViewPrefs } from '../../services/viewPrefs';
import { useAuth } from '../../services/auth';
import { COLLECTOR_URL } from '../../services/config';

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

interface SessionLap {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  position: number | null;
  ts: number;
}

interface CompSession {
  sessionId: string;
  phase: string | null;
}

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

interface ScoringData {
  positionPoints: { label: string; minPilots: number; maxPilots: number; groups: Record<string, number[]> }[];
  overtakePoints: { groupI_LL: { startPosMin: number; startPosMax: number; perOvertake: number }[]; groupI_CL: { startPosMin: number; startPosMax: number; perOvertake: number }[]; groupII: number; groupIII: number };
  speedPoints: number[];
}

function parseLapSec(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+\.\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  const s = t.match(/^\d+\.\d+$/);
  if (s) return parseFloat(t);
  return null;
}

interface PilotQualiData { bestTime: number; bestTimeStr: string; kart: number; speedPoints: number }
interface PilotRaceData {
  kart: number; bestTime: number; bestTimeStr: string;
  group: number; startPos: number; finishPos: number;
  positionPoints: number; overtakePoints: number; speedPoints: number; penalties: number; totalRacePoints: number;
}
interface PilotRow {
  pilot: string; quali: PilotQualiData | null; races: (PilotRaceData | null)[];
  totalPoints: number;
}

type ManualEdits = Record<string, { startPos?: number; finishPos?: number; penalties?: number }>;

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

function getOvertakeRate(scoring: ScoringData, group: number, pos: number, isCL: boolean): number {
  if (group === 3) return scoring.overtakePoints.groupIII;
  if (group === 2) return scoring.overtakePoints.groupII;
  const rules = isCL ? scoring.overtakePoints.groupI_CL : scoring.overtakePoints.groupI_LL;
  for (const rule of rules) {
    if (pos >= rule.startPosMin && pos <= rule.startPosMax) return rule.perOvertake;
  }
  return 0;
}

function calcOvertakePoints(scoring: ScoringData, group: number, startPos: number, finishPos: number, isCL: boolean): number {
  if (startPos <= finishPos) return 0;
  let total = 0;
  for (let pos = startPos; pos > finishPos; pos--) {
    total += getOvertakeRate(scoring, group, pos, isCL);
  }
  return Math.round(total * 10) / 10;
}

function getPositionPoints(scoring: ScoringData, totalPilots: number, group: string, finishPos: number): number {
  const cat = scoring.positionPoints.find(c => totalPilots >= c.minPilots && totalPilots <= c.maxPilots);
  if (!cat) return 0;
  const pts = cat.groups[group];
  if (!pts || finishPos < 1 || finishPos > pts.length) return 0;
  return pts[finishPos - 1];
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

  const getRaceSessions = (raceNum: number) => sessions.filter(s => s.phase?.startsWith(`race_${raceNum}_`));

  const data = useMemo(() => {
    if (!scoring) return [];

    // 1. Qualifying: best time per pilot
    const qualiData = new Map<string, PilotQualiData>();
    for (const qs of qualiSessions) {
      for (const l of (effectiveLaps.get(qs.sessionId) || [])) {
        const sec = parseLapSec(l.lap_time);
        if (sec === null || sec < 38) continue;
        const ex = qualiData.get(l.pilot);
        if (!ex || sec < ex.bestTime) qualiData.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart, speedPoints: 0 });
      }
    }

    // Sort by qualifying time
    const qualiSorted = [...qualiData.entries()]
      .filter(([p]) => !excludedPilots.has(p))
      .sort((a, b) => a[1].bestTime - b[1].bestTime);
    const maxQualified = format === 'champions_league' ? 24 : 36;
    const qualifiedPilots = qualiSorted.slice(0, maxQualified).map(([p]) => p);
    const disqualifiedPilots = new Set(qualiSorted.slice(maxQualified).map(([p]) => p));
    const autoTotalPilots = qualifiedPilots.length;
    const totalPilots = (pilotsLocked && pilotsOverride !== null) ? pilotsOverride : autoTotalPilots;

    // Qualifying speed points (top 5 fastest)
    qualiSorted.slice(0, 5).forEach(([pilot], i) => {
      const q = qualiData.get(pilot)!;
      q.speedPoints = scoring.speedPoints[i] || 0;
    });

    // 2. Determine groups from qualifying (reverse order: best = group 1 last position)
    const groups = splitIntoGroups(qualifiedPilots, maxGroups);
    const pilotGroup = new Map<string, { group: number; posInGroup: number }>();
    groups.forEach((g, gi) => {
      const groupNum = gi + 1; // group 1 = best (fastest from qualifying)
      g.pilots.forEach((p, pi) => {
        pilotGroup.set(p, { group: groupNum, posInGroup: g.pilots.length - pi }); // reverse: best gets highest pos
      });
    });

    // 3. Build race data
    let prevRaceTimes: { pilot: string; time: number }[] = qualiSorted.map(([p, d]) => ({ pilot: p, time: d.bestTime }));

    // Determine active phase from liveSessionId or livePhase (for scrubbing)
    let activePhase: string | null = null;
    if (liveSessionId) {
      const liveSession = sessions.find(s => s.sessionId === liveSessionId);
      activePhase = liveSession?.phase || null;
    } else if (livePhase) {
      // Use livePhase when scrubbing between sessions
      activePhase = livePhase;
    }

    const raceResults: Map<string, PilotRaceData>[] = [];
    for (let r = 1; r <= raceCount; r++) {
      const rData = new Map<string, PilotRaceData>();
      const rSessions = getRaceSessions(r);

      // Determine start positions from previous race/quali times (reverse order per group)
      const prevSorted = [...prevRaceTimes]
        .filter(p => !excludedPilots.has(p.pilot) && !disqualifiedPilots.has(p.pilot))
        .sort((a, b) => a.time - b.time)
        .slice(0, maxQualified);
      const rGroups = splitIntoGroups(prevSorted.map(p => p.pilot), maxGroups);
      const startPositions = new Map<string, { group: number; startPos: number }>();
      rGroups.forEach((g, gi) => {
        const gNum = gi + 1;
        g.pilots.forEach((p, pi) => {
          startPositions.set(p, { group: gNum, startPos: g.pilots.length - pi });
        });
      });

      // Only show start positions for the next race after active phase
      // If qualifying is active: show start positions for race 1
      // If race N is active: show start positions for race N+1
      let shouldShowStartPositions = false;
      if (activePhase?.startsWith('qualifying')) {
        shouldShowStartPositions = r === 1;
      } else if (activePhase?.startsWith('race_')) {
        const activeRaceMatch = activePhase.match(/race_(\d+)_/);
        if (activeRaceMatch) {
          const activeRaceNum = parseInt(activeRaceMatch[1]);
          shouldShowStartPositions = r === activeRaceNum + 1;
        }
      } else {
        // No active phase: show start positions for all races (default behavior)
        shouldShowStartPositions = true;
      }

      // Get finish positions from timing data (use position from last lap — set by timing system)
      const raceTimes: { pilot: string; time: number }[] = [];
      for (const rs of rSessions) {
        const groupMatch = rs.phase?.match(/group_(\d+)/);
        const groupNum = groupMatch ? parseInt(groupMatch[1]) : 0;
        const laps = effectiveLaps.get(rs.sessionId) || [];
        const pilotStats = new Map<string, { bestTime: number; bestTimeStr: string; kart: number; lapCount: number; lastTs: number; lastPosition: number }>();
        for (const l of laps) {
          const sec = parseLapSec(l.lap_time);
          if (sec === null || sec < 38) continue;
          const ex = pilotStats.get(l.pilot);
          if (!ex) {
            pilotStats.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart, lapCount: 1, lastTs: l.ts, lastPosition: l.position ?? 99 });
          } else {
            ex.lapCount++;
            if (l.ts > ex.lastTs) { ex.lastTs = l.ts; ex.lastPosition = l.position ?? 99; }
            if (sec < ex.bestTime) { ex.bestTime = sec; ex.bestTimeStr = l.lap_time!; }
          }
        }
        // Override positions with live timing data if this is the active session
        const isActiveSession = rs.sessionId === liveSessionId && livePositions && livePositions.length > 0;
        if (isActiveSession) {
          for (const lp of livePositions!) {
            const ps = pilotStats.get(lp.pilot);
            if (ps) ps.lastPosition = lp.position;
          }
        }

        // Race finish: by position from timing system
        const sorted = [...pilotStats.entries()]
          .filter(([p]) => !excludedPilots.has(p))
          .sort((a, b) => {
            if (a[1].lapCount !== b[1].lapCount) return b[1].lapCount - a[1].lapCount;
            if (a[1].lastPosition !== b[1].lastPosition) return a[1].lastPosition - b[1].lastPosition;
            return a[1].lastTs - b[1].lastTs;
          });
        const excludedEntries = [...pilotStats.entries()].filter(([p]) => excludedPilots.has(p));
        sorted.forEach(([pilot, pData], i) => {
          const editKey = `${pilot}|${r}`;
          const edit = edits[editKey];
          const sp = startPositions.get(pilot);
          const isDisqualified = disqualifiedPilots.has(pilot);
          const startPos = isDisqualified ? -1 : (edit?.startPos ?? sp?.startPos ?? 0);
          const finishPos = edit?.finishPos ?? (i + 1);
          const group = isDisqualified ? 0 : (sp?.group ?? groupNum);
          const penalties = edit?.penalties ?? 0;

          const overtakePoints = isDisqualified ? 0 : calcOvertakePoints(scoring, group, startPos, finishPos, format === 'champions_league');
          const groupLabel = group === 1 ? 'I' : group === 2 ? 'II' : 'III';
          const posPoints = getPositionPoints(scoring, totalPilots, groupLabel, finishPos);

          rData.set(pilot, {
            kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
            group, startPos, finishPos,
            positionPoints: posPoints, overtakePoints, speedPoints: 0, penalties,
            totalRacePoints: Math.round((posPoints + overtakePoints - penalties) * 10) / 10,
          });
          raceTimes.push({ pilot, time: pData.bestTime });
        });
        excludedEntries.forEach(([pilot, pData]) => {
          rData.set(pilot, {
            kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
            group: 0, startPos: 0, finishPos: 0,
            positionPoints: 0, overtakePoints: 0, speedPoints: 0, penalties: 0, totalRacePoints: 0,
          });
        });
      }

      // Speed points for this race (top 5 by time across all groups)
      raceTimes.sort((a, b) => a.time - b.time);
      raceTimes.filter(r => !excludedPilots.has(r.pilot)).slice(0, 5).forEach(({ pilot }, i) => {
        const rd = rData.get(pilot);
        if (rd) {
          rd.speedPoints = scoring.speedPoints[i] || 0;
          rd.totalRacePoints = Math.round((rd.positionPoints + rd.overtakePoints + rd.speedPoints - rd.penalties) * 10) / 10;
        }
      });

      raceResults.push(rData);
      if (raceTimes.length > 0) prevRaceTimes = raceTimes.filter(r => !excludedPilots.has(r.pilot));

      // Fill start positions for pilots without race data yet (race hasn't started or pilot not in this race's groups yet)
      // Only fill if this race should show start positions
      if (shouldShowStartPositions) {
        for (const [pilot, sp] of startPositions) {
          if (!rData.has(pilot) && !excludedPilots.has(pilot)) {
            rData.set(pilot, {
              kart: 0, bestTime: Infinity, bestTimeStr: '',
              group: sp.group, startPos: sp.startPos, finishPos: 0,
              positionPoints: 0, overtakePoints: 0, speedPoints: 0, penalties: 0, totalRacePoints: 0,
            });
          }
        }
      }
    }

    // 4. Build rows
    const allPilots = new Set<string>([...qualiData.keys()]);
    for (const rd of raceResults) for (const p of rd.keys()) allPilots.add(p);

    const rows: PilotRow[] = [...allPilots].map(pilot => {
      const q = qualiData.get(pilot) || null;
      const races = raceResults.map(rd => rd.get(pilot) || null);
      const qualiPts = q?.speedPoints ?? 0;
      const racePts = races.reduce((s, r) => s + (r?.totalRacePoints ?? 0), 0);
      return { pilot, quali: q, races, totalPoints: Math.round((qualiPts + racePts) * 10) / 10 };
    });

    return rows;
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
  const showQuali = !hiddenGroups.has('quali');
  const showRace = (n: number) => !hiddenGroups.has(`race_${n}`);
  const rc = showEditsOnly ? 4 : showPointsOnly ? 5 : showTimeOnly ? 2 : 10;

  const autoTotalPilots = sortedData.filter(r => !excludedPilots.has(r.pilot) && r.quali).length;
  Promise.resolve().then(() => { onPilotCount?.(autoTotalPilots); onAutoGroups?.(autoGroupsByQuali); });

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
      }
      saveSettings({ hiddenGroups: [...n] });
      return n;
    });
  };

  return (
    <div className="space-y-4">
      {prefs.showLeaguePoints ? (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-dark-800 space-y-1.5">
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
              </span>
              <button onClick={() => { setViewMode(''); toggleGroup('quali'); }} className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${showAll || showPointsOnly || showTimeOnly || (!showEditsOnly && showQuali) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Квала</button>
              {Array.from({ length: raceCount }, (_, i) => (
                <button key={i} onClick={() => { setViewMode(''); toggleGroup(`race_${i + 1}`); }} className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${showAll || showEditsOnly || showPointsOnly || showTimeOnly || showRace(i + 1) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Г{i + 1}</button>
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
                  {(showAll || showPointsOnly || (!showEditsOnly && showQuali)) && <th colSpan={showPointsOnly ? 1 : showTimeOnly ? 2 : 3} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700">Квала</th>}
                  {Array.from({ length: raceCount }, (_, i) => {
                    const visible = showAll || showEditsOnly || showPointsOnly || showTimeOnly || showRace(i + 1);
                    if (!visible) return null;
                    return <th key={i} colSpan={rc} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700">Гонка {i + 1}</th>;
                  })}
                </tr>
                <tr className="bg-dark-800/30">
                  {(showAll || showPointsOnly || (!showEditsOnly && showQuali)) && (<>
                    {!showPointsOnly && <th rowSpan={2} className={TH_V}><span className={TH_R}>Карт</span></th>}
                    {!showPointsOnly && <th rowSpan={2} className={TH_V}><span className={TH_R}>Час</span></th>}
                    {!showTimeOnly && !showPointsOnly && <th rowSpan={2} className={TH_V}><span className={TH_R}>Бали</span></th>}
                  </>)}
                  {Array.from({ length: raceCount }, (_, i) => {
                    const visible = showAll || showEditsOnly || showPointsOnly || showTimeOnly || showRace(i + 1);
                    if (!visible) return null;
                      if (showEditsOnly) return (
                        <Fragment key={i}>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Старт</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Фініш</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Штрафи</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Сума</span></th>
                        </Fragment>
                      );
                      if (showPointsOnly) return (
                        <Fragment key={i}>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Швидк.</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Позиція</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Обгони</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Штрафи</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Сума</span></th>
                        </Fragment>
                      );
                      if (showTimeOnly) return (
                        <Fragment key={i}>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Карт</span></th>
                          <th rowSpan={2} className={TH_V}><span className={TH_R}>Час</span></th>
                        </Fragment>
                      );
                    return (
                      <Fragment key={i}>
                        <th rowSpan={2} className={TH_V}><span className={TH_R}>Карт</span></th>
                        <th rowSpan={2} className={TH_V}><span className={TH_R}>Час</span></th>
                        <th rowSpan={2} className={TH_V}><span className={TH_R}>Швидк.</span></th>
                        <th rowSpan={2} className={TH_V}><span className={TH_R}>Група</span></th>
                        <th rowSpan={2} className={TH_V}><span className={TH_R}>Старт</span></th>
                        <th rowSpan={2} className={TH_V}><span className={TH_R}>Фініш</span></th>
                        <th colSpan={4} className="px-1 py-0.5 text-center text-dark-500 text-[9px] border-r border-dark-700/30 border-b border-dark-700/30">Бали</th>
                      </Fragment>
                    );
                  })}
                </tr>
                <tr className="bg-dark-800/20">
                  {Array.from({ length: raceCount }, (_, i) => {
                    const visible = showAll || showEditsOnly || showPointsOnly || showTimeOnly || showRace(i + 1);
                    if (!visible || showEditsOnly || showPointsOnly || showTimeOnly) return null;
                    return (
                      <Fragment key={i}>
                        <th className={TH_V}><span className={TH_R}>Позиція</span></th>
                        <th className={TH_V}><span className={TH_R}>Обгони</span></th>
                        <th className={TH_V}><span className={TH_R}>Штрафи</span></th>
                        <th className={TH_V}><span className={TH_R}>Сума</span></th>
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
                    <tr key={row.pilot} className={`border-b ${isGroupEnd ? 'border-b-2 border-dark-600' : 'border-dark-800/50'} ${isExcluded ? 'opacity-30' : isOnTrack ? 'bg-green-500/5' : 'hover:bg-dark-700/30'}`}>
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
                    {(showAll || showPointsOnly || (!showEditsOnly && showQuali)) && (<>
                      {!showPointsOnly && <td className="px-1 py-1 text-center font-mono text-blue-400/70 border-r border-dark-700/30">{row.quali?.kart || '—'}</td>}
                      {!showPointsOnly && <td className="px-1 py-1 text-center font-mono text-yellow-300/70 border-r border-dark-700/30">{row.quali ? toSeconds(row.quali.bestTimeStr) : '—'}</td>}
                      {!showTimeOnly && <td className="px-1 py-1 text-center font-mono border-r border-dark-700">{row.quali?.speedPoints ? <span className="text-green-400/80">{row.quali.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>}
                    </>)}
                    {row.races.map((race, ri) => {
                      const visible = showAll || showEditsOnly || showPointsOnly || showTimeOnly || showRace(ri + 1);
                      if (!visible) return null;
                      const posChange = race && race.startPos > 0 && race.finishPos > 0 ? race.startPos - race.finishPos : 0;
                      if (showEditsOnly) return (
                        <Fragment key={ri}>
                          <td className="px-1 py-1 text-center font-mono text-dark-400 border-r border-dark-700/30">
                            {race ? (race.startPos === -1 ? <span className="text-red-400">X</span> : canManage ? <EditableCell editingRef={editingRef} value={race.startPos} onChange={v => setEdit(row.pilot, ri + 1, 'startPos', v)} /> : <span>{race.startPos}</span>) : '—'}
                          </td>
                          <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30">
                            {race ? (
                              <span className="inline-flex items-center gap-0.5">
                                {canManage ? <EditableCell editingRef={editingRef} value={race.finishPos} onChange={v => setEdit(row.pilot, ri + 1, 'finishPos', v)} /> : <span>{race.finishPos}</span>}
                                {posChange !== 0 && <span className={`text-[8px] ${posChange > 0 ? 'text-green-400' : 'text-red-400'}`}>{posChange > 0 ? `▲${posChange}` : `▼${Math.abs(posChange)}`}</span>}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">
                            {race ? (canManage ? <EditableCell editingRef={editingRef} value={race.penalties} onChange={v => setEdit(row.pilot, ri + 1, 'penalties', v)} colorClass={race.penalties ? 'text-red-400' : 'text-dark-300'} prefix="-" /> : race.penalties ? <span className="text-red-400">-{race.penalties}</span> : <span className="text-dark-700">—</span>) : '—'}
                          </td>
                          <td className="px-1 py-1 text-center font-mono font-bold border-r border-dark-700">{race?.totalRacePoints ? <span className="text-green-400/80">{race.totalRacePoints}</span> : <span className="text-dark-700">—</span>}</td>
                        </Fragment>
                      );
                      if (showPointsOnly) return (
                        <Fragment key={ri}>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.speedPoints ? <span className="text-green-400/80">{race.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.positionPoints ? <span className="text-green-400/60">{race.positionPoints}</span> : <span className="text-dark-700">—</span>}</td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.overtakePoints ? <span className="text-green-400/60">{race.overtakePoints}</span> : <span className="text-dark-700">—</span>}</td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.penalties ? <span className="text-red-400">-{race.penalties}</span> : <span className="text-dark-700">—</span>}</td>
                          <td className="px-1 py-1 text-center font-mono font-bold border-r border-dark-700">{race?.totalRacePoints ? <span className="text-green-400/80">{race.totalRacePoints}</span> : <span className="text-dark-700">—</span>}</td>
                        </Fragment>
                      );
                      if (showTimeOnly) return (
                        <Fragment key={ri}>
                          <td className="px-1 py-1 text-center font-mono text-blue-400/70 border-r border-dark-700/30">{race?.kart || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-yellow-300/70 border-r border-dark-700/30">{race ? toSeconds(race.bestTimeStr) : '—'}</td>
                        </Fragment>
                      );
                      return (
                        <Fragment key={ri}>
                          <td className="px-1 py-1 text-center font-mono text-blue-400/70 border-r border-dark-700/30">{race?.kart || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-yellow-300/70 border-r border-dark-700/30">{race ? toSeconds(race.bestTimeStr) : '—'}</td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.speedPoints ? <span className="text-green-400/80">{race.speedPoints}</span> : <span className="text-dark-700">—</span>}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.group || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-400 border-r border-dark-700/30">
                            {race ? (race.startPos === -1 ? <span className="text-red-400">X</span> : canManage ? <EditableCell editingRef={editingRef} value={race.startPos} onChange={v => setEdit(row.pilot, ri + 1, 'startPos', v)} /> : <span>{race.startPos}</span>) : '—'}
                          </td>
                          <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30">
                            {race ? (
                              <span className="inline-flex items-center gap-0.5">
                                {canManage ? <EditableCell editingRef={editingRef} value={race.finishPos} onChange={v => setEdit(row.pilot, ri + 1, 'finishPos', v)} /> : <span>{race.finishPos}</span>}
                                {posChange !== 0 && <span className={`text-[8px] ${posChange > 0 ? 'text-green-400' : 'text-red-400'}`}>{posChange > 0 ? `▲${posChange}` : `▼${Math.abs(posChange)}`}</span>}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.positionPoints ? <span className="text-green-400/60">{race.positionPoints}</span> : <span className="text-dark-700">—</span>}</td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">{race?.overtakePoints ? <span className="text-green-400/60">{race.overtakePoints}</span> : <span className="text-dark-700">—</span>}</td>
                          <td className="px-1 py-1 text-center font-mono border-r border-dark-700/30">
                            {race ? (canManage ? <EditableCell editingRef={editingRef} value={race.penalties} onChange={v => setEdit(row.pilot, ri + 1, 'penalties', v)} colorClass={race.penalties ? 'text-red-400' : 'text-dark-300'} prefix="-" /> : race.penalties ? <span className="text-red-400">-{race.penalties}</span> : <span className="text-dark-700">—</span>) : '—'}
                          </td>
                          <td className="px-1 py-1 text-center font-mono font-bold border-r border-dark-700">{race?.totalRacePoints ? <span className="text-green-400/80">{race.totalRacePoints}</span> : <span className="text-dark-700">—</span>}</td>
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
