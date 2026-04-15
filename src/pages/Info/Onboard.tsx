import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTimingPoller } from '../../services/timingPoller';
import { COLLECTOR_URL } from '../../services/config';
import { parseTime, toSeconds, getTimeColor, COLOR_CLASSES, shortName } from '../../utils/timing';
import { COMPETITION_CONFIGS, getPhaseShortLabel, getPhasesForFormat } from '../../data/competitions';
import {
  type SessionLap, type CompSession, type ScoringData, type ManualEdits,
  computeStandings, computeSprintStandings, sprintAwareSort,
} from '../../utils/scoring';
import type { TimingEntry } from '../../types';

export interface OnboardProps {
  replayEntries?: TimingEntry[];
  replaySessionId?: string;
  scrubberSlot?: ReactNode;
  onClose?: () => void;
}

interface CompSessionInfo {
  competitionId: string | null;
  format: string | null;
  phase: string | null;
}

type OnboardMode = 'quali' | 'race';

interface FullCompData {
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
  scoring: ScoringData;
  edits: ManualEdits;
  excludedPilots: Set<string>;
  maxGroups: number;
  pilotsOverride: number | null;
  pilotsLocked: boolean;
  format: string;
  racePilotCount: number | null;
}

const Pill = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
      active ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
    }`}>
    {label}
  </button>
);

type PosEntry = { pilot: string; pos: number; delta: number | null; gapToNext: number | null };
type StEntry = { pilot: string; pos: number; pts: number };

function buildWindow(list: PosEntry[], myIdx: number, myPilot: string) {
  const total = list.length;
  if (total === 0) return null;
  const windowSize = Math.min(4, total);
  let start: number;
  if (total <= 4) { start = 0; }
  else if (myIdx <= 1) { start = 0; }
  else if (myIdx >= total - 2) { start = total - windowSize; }
  else { start = myIdx - 1; }
  return { items: list.slice(start, start + windowSize), myPilot, total };
}

function buildStandingsWindow(list: StEntry[], myIdx: number, myPilot: string) {
  const total = list.length;
  if (total === 0) return null;
  const windowSize = Math.min(3, total);
  let start: number;
  if (total <= 3) { start = 0; }
  else if (myIdx === 0) { start = 0; }
  else if (myIdx >= total - 1) { start = total - windowSize; }
  else { start = myIdx - 1; }
  const myPts = list[myIdx].pts;
  return { items: list.slice(start, start + windowSize), myPilot, myPts, total };
}

export default function Onboard({ replayEntries, replaySessionId, scrubberSlot, onClose }: OnboardProps = {}) {
  const isReplay = replayEntries != null;

  const { kartId } = useParams<{ kartId: string }>();
  const navigate = useNavigate();
  const poller = useTimingPoller({ interval: isReplay ? 999999 : 1000 });
  const [locked, setLocked] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);

  // In replay mode, kart is managed via internal state; in live mode, via URL params
  const [replayKart, setReplayKart] = useState<number | null>(null);

  const entries = isReplay ? replayEntries : poller.entries;
  const sessionId = isReplay ? (replaySessionId || null) : ((poller.collectorStatus as any)?.sessionId || null);

  // ── View toggles (persisted) ──
  const onbViewKey = 'karting_onboard_view';
  const loadOnbView = () => { try { const s = localStorage.getItem(onbViewKey); return s ? JSON.parse(s) : null; } catch { return null; } };
  const savedOnbView = useRef(loadOnbView());

  const [showSectors, setShowSectors] = useState(savedOnbView.current?.showSectors ?? true);
  const [modeOverride, setModeOverride] = useState<OnboardMode | null>(savedOnbView.current?.modeOverride ?? null);
  const [showPosition, setShowPosition] = useState<boolean | null>(savedOnbView.current?.showPosition ?? null);
  const [showTime, setShowTime] = useState(savedOnbView.current?.showTime ?? savedOnbView.current?.showTimeGroup ?? false);
  const [showPoints, setShowPoints] = useState(savedOnbView.current?.showPoints ?? false);

  useEffect(() => {
    localStorage.setItem(onbViewKey, JSON.stringify({ showSectors, modeOverride, showPosition, showTime, showPoints }));
  }, [showSectors, modeOverride, showPosition, showTime, showPoints]);

  const kart = isReplay ? replayKart : (kartId ? parseInt(kartId, 10) : null);
  const entry = kart !== null ? entries.find(e => e.kart === kart) : null;
  const ALL_KARTS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,33,44,55,69,77,88];
  const liveKarts = new Set(entries.map(e => e.kart));

  const goToKart = useCallback((k: number) => {
    if (isReplay) {
      setReplayKart(k);
    } else {
      navigate(`/onboard/${k}`, { replace: true });
    }
    setSelectorOpen(false);
  }, [isReplay, navigate]);


  useEffect(() => {
    if (isReplay) {
      if (replayKart === null && entries.length > 0) setReplayKart(entries[0].kart);
    } else {
      if (!kartId) goToKart(ALL_KARTS[0]);
    }
  }, [kartId, isReplay, entries.length]);

  useEffect(() => {
    if (!locked) return;
    try { (screen.orientation as any).lock?.('landscape').catch(() => {}); }
    catch { /* not supported */ }
    return () => { try { screen.orientation.unlock(); } catch { /* */ } };
  }, [locked]);

  useEffect(() => {
    if (!selectorOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) setSelectorOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [selectorOpen]);

  useEffect(() => {
    if (!viewOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (viewRef.current && !viewRef.current.contains(e.target as Node)) setViewOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [viewOpen]);

  // ── Competition data ──

  const [compInfo, setCompInfo] = useState<CompSessionInfo>({ competitionId: null, format: null, phase: null });
  const [raceNumber, setRaceNumber] = useState<number | null>(null);
  const [fullComp, setFullComp] = useState<FullCompData | null>(null);

  useEffect(() => {
    if (!sessionId) { setCompInfo({ competitionId: null, format: null, phase: null }); setRaceNumber(null); return; }
    fetch(`${COLLECTOR_URL}/db/session-competition?session=${sessionId}`)
      .then(r => r.json())
      .then(d => setCompInfo({ competitionId: d.competitionId || null, format: d.format || null, phase: d.phase || null }))
      .catch(() => setCompInfo({ competitionId: null, format: null, phase: null }));
    const ts = parseInt(sessionId.replace('session-', ''));
    if (!isNaN(ts)) {
      const date = new Date(ts).toISOString().slice(0, 10);
      fetch(`${COLLECTOR_URL}/db/sessions?date=${date}`)
        .then(r => r.json())
        .then((sessions: any[]) => {
          const s = sessions.find((s: any) => s.id === sessionId || s.merged_session_ids?.includes(sessionId));
          setRaceNumber(s?.race_number ?? null);
        })
        .catch(() => setRaceNumber(null));
    }
  }, [sessionId]);

  // Auto-detect mode
  const autoMode: OnboardMode = useMemo(() => {
    if (!compInfo.phase) return 'quali';
    if (compInfo.phase.startsWith('qualifying')) return 'quali';
    if (compInfo.phase.startsWith('race_') || compInfo.phase.startsWith('round_') || compInfo.phase.startsWith('final_')) return 'race';
    return 'quali';
  }, [compInfo.phase]);

  const effectiveMode = modeOverride ?? autoMode;
  const effectiveShowPos = showPosition ?? (effectiveMode === 'race');

  const sessionLabel = useMemo(() => {
    if (!sessionId) return null;
    if (compInfo.format && compInfo.phase) {
      const cfg = COMPETITION_CONFIGS[compInfo.format as keyof typeof COMPETITION_CONFIGS];
      const shortName = cfg?.shortName || compInfo.format;
      const phaseLabel = getPhaseShortLabel(compInfo.format, compInfo.phase);
      return `${shortName} · ${phaseLabel}`;
    }
    if (compInfo.format) {
      const cfg = COMPETITION_CONFIGS[compInfo.format as keyof typeof COMPETITION_CONFIGS];
      return cfg?.shortName || compInfo.format;
    }
    return `Прокат${raceNumber != null ? ` ${raceNumber}` : ''}`;
  }, [sessionId, compInfo.format, compInfo.phase, raceNumber]);

  // ── Fetch full competition data for shared scoring ──

  useEffect(() => {
    if (!compInfo.competitionId || !compInfo.format) { setFullComp(null); return; }
    let active = true;

    const fetchFull = async () => {
      try {
        const [compRes, scoringRes] = await Promise.all([
          fetch(`${COLLECTOR_URL}/competitions/${compInfo.competitionId}`),
          fetch(`${COLLECTOR_URL}/scoring`).then(r => r.ok ? r.json() : fetch('/data/scoring.json').then(r2 => r2.json())),
        ]);
        const comp = await compRes.json();
        const sessions: CompSession[] = typeof comp.sessions === 'string' ? JSON.parse(comp.sessions) : (comp.sessions || []);
        const results = typeof comp.results === 'string' ? JSON.parse(comp.results) : (comp.results || {});

        const sessionLaps = new Map<string, SessionLap[]>();
        for (const s of sessions) {
          const laps = await fetch(`${COLLECTOR_URL}/db/laps?session=${s.sessionId}`).then(r => r.json()).catch(() => []);
          sessionLaps.set(s.sessionId, laps);
        }

        const formatMaxGroups = compInfo.format === 'champions_league' ? 2 : 3;
        const isSprint = compInfo.format === 'sprint';
        const qualiSessions = sessions.filter(s => s.phase?.startsWith('qualifying'));
        const qualiWithData = qualiSessions.filter(s => (sessionLaps.get(s.sessionId) || []).length > 0);
        let autoGroups: number;
        if (isSprint) {
          const q1Groups = new Set(qualiWithData
            .filter(s => s.phase?.startsWith('qualifying_1_group_'))
            .map(s => s.phase?.match(/group_(\d+)/)?.[1])
            .filter(Boolean));
          autoGroups = Math.min(Math.max(q1Groups.size, 1), formatMaxGroups);
        } else {
          autoGroups = Math.min(Math.max(qualiWithData.length, 1), formatMaxGroups);
        }

        if (!active) return;
        setFullComp({
          sessions,
          sessionLaps,
          scoring: scoringRes,
          edits: results.edits || {},
          excludedPilots: new Set(results.excludedPilots || []),
          maxGroups: results.groupCountOverride ?? results.autoDetectedGroups ?? autoGroups,
          pilotsOverride: results.totalPilotsOverride ?? null,
          pilotsLocked: results.totalPilotsLocked ?? false,
          format: compInfo.format!,
          racePilotCount: results.racePilotCount ?? null,
        });
      } catch {
        if (active) setFullComp(null);
      }
    };

    fetchFull();
    if (!isReplay) {
      const timer = setInterval(fetchFull, 5000);
      return () => { active = false; clearInterval(timer); };
    }
    return () => { active = false; };
  }, [compInfo.competitionId, compInfo.format, isReplay]);

  // ── Compute standings using shared scoring functions ──

  const livePositions = useMemo(() =>
    entries.map(e => ({ pilot: e.pilot, position: e.position ?? 99 })),
    [entries]
  );

  const standings = useMemo(() => {
    if (!fullComp || !compInfo.phase) return null;
    const computeFn = fullComp.format === 'sprint' ? computeSprintStandings : computeStandings;
    const rows = computeFn({
      format: fullComp.format,
      sessions: fullComp.sessions,
      sessionLaps: fullComp.sessionLaps,
      scoring: fullComp.scoring,
      edits: fullComp.edits,
      excludedPilots: fullComp.excludedPilots,
      maxGroups: fullComp.maxGroups,
      pilotsOverride: fullComp.pilotsOverride,
      pilotsLocked: fullComp.pilotsLocked,
      racePilotCount: fullComp.racePilotCount,
      liveSessionId: sessionId,
      livePhase: compInfo.phase,
      livePositions,
    });
    const included = rows.filter(r => !fullComp.excludedPilots.has(r.pilot));
    included.sort((a, b) => sprintAwareSort(a, b, fullComp.format));
    return { rows, sorted: included };
  }, [fullComp, compInfo.phase, sessionId, livePositions]);

  // Find which race index the current phase corresponds to
  const currentRaceIndex = useMemo(() => {
    if (!compInfo.phase) return -1;
    if (compInfo.phase.startsWith('qualifying')) return -1;
    const m = compInfo.phase.match(/^race_(\d+)_/) || compInfo.phase.match(/^final_/);
    if (m) {
      if (compInfo.phase.startsWith('final_')) return fullComp?.format === 'sprint' ? 2 : -1;
      return parseInt(m[1]) - 1;
    }
    return -1;
  }, [compInfo.phase, fullComp?.format]);

  // ── Computed displays ──

  const pilot = entry?.pilot ?? null;

  const pilotRow = useMemo(() => {
    if (!pilot || !standings) return null;
    return standings.rows.find(r => r.pilot === pilot) ?? null;
  }, [pilot, standings]);

  // Time rank in group (T1)
  const timeGroupData = useMemo(() => {
    if (!pilot) return null;
    if (pilotRow && currentRaceIndex >= 0) {
      const raceData = pilotRow.races[currentRaceIndex];
      if (raceData && raceData.group > 0 && standings) {
        const groupPilots = standings.sorted
          .filter(r => r.races[currentRaceIndex]?.group === raceData.group && r.races[currentRaceIndex]?.bestTime && r.races[currentRaceIndex]!.bestTime < Infinity)
          .sort((a, b) => a.races[currentRaceIndex]!.bestTime - b.races[currentRaceIndex]!.bestTime);
        const idx = groupPilots.findIndex(r => r.pilot === pilot);
        return { pos: idx >= 0 ? idx + 1 : null, total: groupPilots.length };
      }
    }
    if (pilotRow && compInfo.phase?.startsWith('qualifying') && standings) {
      const withQuali = standings.sorted
        .filter(r => r.quali && r.quali.bestTime < Infinity)
        .sort((a, b) => a.quali!.bestTime - b.quali!.bestTime);
      const idx = withQuali.findIndex(r => r.pilot === pilot);
      return { pos: idx >= 0 ? idx + 1 : null, total: withQuali.length };
    }
    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap) }))
      .filter(e => e.best !== null && e.best! >= 38) as { pilot: string; best: number }[];
    withBest.sort((a, b) => a.best - b.best);
    const idx = withBest.findIndex(e => e.pilot === pilot);
    return { pos: idx >= 0 ? idx + 1 : null, total: withBest.length };
  }, [pilot, pilotRow, currentRaceIndex, standings, compInfo.phase, entries]);

  // Time rank global (T2)
  const timeGlobalData = useMemo(() => {
    if (!pilot || !standings || currentRaceIndex < 0) return null;
    const allWithTime = standings.sorted
      .filter(r => r.races[currentRaceIndex]?.bestTime && r.races[currentRaceIndex]!.bestTime < Infinity)
      .sort((a, b) => a.races[currentRaceIndex]!.bestTime - b.races[currentRaceIndex]!.bestTime);
    const idx = allWithTime.findIndex(r => r.pilot === pilot);
    return { pos: idx >= 0 ? idx + 1 : null, total: allWithTime.length };
  }, [pilot, standings, currentRaceIndex]);

  // Points for current race
  const pointsData = useMemo(() => {
    if (!pilotRow || currentRaceIndex < 0) return null;
    const race = pilotRow.races[currentRaceIndex];
    if (!race) return null;
    const posOvertake = Math.round((race.positionPoints + race.overtakePoints) * 10) / 10;
    return { total: race.totalRacePoints, posPoints: race.positionPoints, overtakePoints: race.overtakePoints, posOvertake };
  }, [pilotRow, currentRaceIndex]);

  // 5-pilot position leaderboard
  const positionLeaderboard = useMemo(() => {
    if (!pilot || !entry) return null;
    type PilotPosEntry = { pilot: string; pos: number; delta: number | null; gapToNext: number | null };

    if (effectiveMode === 'race' && pilotRow && currentRaceIndex >= 0 && standings) {
      const racePilots = standings.sorted
        .filter(r => r.races[currentRaceIndex]?.finishPos && r.races[currentRaceIndex]!.finishPos > 0)
        .sort((a, b) => a.races[currentRaceIndex]!.finishPos - b.races[currentRaceIndex]!.finishPos);
      if (racePilots.length === 0) return null;
      const myIdx = racePilots.findIndex(r => r.pilot === pilot);
      if (myIdx < 0) return null;

      const list: PilotPosEntry[] = racePilots.map((r, i) => {
        const race = r.races[currentRaceIndex]!;
        const d = race.startPos > 0 ? race.startPos - race.finishPos : null;
        return { pilot: r.pilot, pos: race.finishPos, delta: d, gapToNext: null };
      });
      return buildWindow(list, myIdx, pilot);
    }

    // Fallback: best lap ranking
    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap) }))
      .filter(e => e.best !== null && e.best! >= 38) as { pilot: string; best: number }[];
    withBest.sort((a, b) => a.best - b.best);
    const myIdx = withBest.findIndex(e => e.pilot === pilot);
    if (myIdx < 0) return null;
    const list: PilotPosEntry[] = withBest.map((e, i) => {
      const gap = i > 0 ? Math.round((e.best - withBest[i - 1].best) * 1000) / 1000 : null;
      return { pilot: e.pilot, pos: i + 1, delta: null, gapToNext: gap };
    });
    return buildWindow(list, myIdx, pilot);
  }, [pilot, entry, pilotRow, currentRaceIndex, standings, entries, effectiveMode]);

  // Standings leaderboard for Бали (5-pilot list)
  const standingsLeaderboard = useMemo(() => {
    if (!pilot || !standings) return null;
    const sorted = standings.sorted;
    const idx = sorted.findIndex(r => r.pilot === pilot);
    if (idx < 0) return null;

    const list = sorted.map((r, i) => ({
      pilot: r.pilot,
      pos: i + 1,
      pts: Math.round(r.totalPoints * 10) / 10,
    }));
    return buildStandingsWindow(list, idx, pilot);
  }, [pilot, standings]);

  // Next session label
  const nextSessionLabel = useMemo(() => {
    if (!compInfo.format || !compInfo.phase || !fullComp) return null;
    const phases = getPhasesForFormat(compInfo.format, fullComp.maxGroups);
    const currentIdx = phases.findIndex(p => p.id === compInfo.phase);
    if (currentIdx < 0 || currentIdx >= phases.length - 1) return null;
    const next = phases[currentIdx + 1];
    return next.shortLabel || next.label;
  }, [compInfo.format, compInfo.phase, fullComp]);

  // ── Color calculations ──

  const overallBestLap = entries.reduce((best, e) => {
    const v = parseTime(e.bestLap);
    return v !== null && (best === null || v < best) ? v : best;
  }, null as number | null);

  const overallBestS1 = entries.reduce((best, e) => {
    const v = parseTime(e.bestS1);
    return v !== null && v >= 10 && (best === null || v < best) ? v : best;
  }, null as number | null);

  const overallBestS2 = entries.reduce((best, e) => {
    const v = parseTime(e.bestS2);
    return v !== null && v >= 10 && (best === null || v < best) ? v : best;
  }, null as number | null);

  const lapColor = entry ? getTimeColor(entry.lastLap, entry.bestLap, overallBestLap) : 'none';
  const s1Color = entry ? getTimeColor(entry.s1, entry.bestS1, overallBestS1) : 'none';
  const s2Color = entry ? getTimeColor(entry.s2, entry.bestS2, overallBestS2) : 'none';

  // Sector diffs: diff to best S1/S2 in session
  const sectorDiffs = useMemo(() => {
    if (!entry) return { s1: null, s2: null, lap: null };
    const myS1 = parseTime(entry.bestS1);
    const myS2 = parseTime(entry.bestS2);
    const myBest = parseTime(entry.bestLap);

    const allS1 = entries.map(e => parseTime(e.bestS1)).filter((v): v is number => v !== null && v >= 10).sort((a, b) => a - b);
    const allS2 = entries.map(e => parseTime(e.bestS2)).filter((v): v is number => v !== null && v >= 10).sort((a, b) => a - b);
    const allBest = entries.map(e => parseTime(e.bestLap)).filter((v): v is number => v !== null && v >= 38).sort((a, b) => a - b);

    const diffFor = (my: number | null, sorted: number[]) => {
      if (my === null || sorted.length === 0) return null;
      const best = sorted[0];
      if (Math.abs(my - best) < 0.001) {
        const nextBest = sorted.find(v => v > best + 0.001);
        return nextBest != null ? -(nextBest - my) : null;
      }
      return my - best;
    };

    return { s1: diffFor(myS1, allS1), s2: diffFor(myS2, allS2), lap: diffFor(myBest, allBest) };
  }, [entry, entries]);

  const isLive = isReplay ? entries.length > 0 : (poller.mode === 'live' && entries.length > 0);

  return (
    <div className="fixed inset-0 bg-dark-950 flex flex-col z-50 select-none">
      {/* Top bar */}
      <div className="flex items-center px-2 py-1.5 bg-dark-900/90 border-b border-dark-800 shrink-0 gap-1.5">
        {/* Left: back/close + lock + session label + view */}
        {onClose ? (
          <button onClick={onClose} className="text-dark-400 hover:text-white px-1.5 py-1 rounded-lg hover:bg-dark-800 transition-colors shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <Link to="/" className="text-dark-400 hover:text-white px-1.5 py-1 rounded-lg hover:bg-dark-800 transition-colors shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        )}

        <button onClick={() => setLocked(l => !l)}
          className={`px-2.5 py-2 rounded-lg transition-colors shrink-0 ${
            locked ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
          }`}
          title={locked ? 'Розблокувати обертання' : 'Заблокувати обертання'}>
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="11" width="8" height="7" rx="1" />
            {locked
              ? <path d="M10 11V8a2 2 0 1 1 4 0v3" />
              : <path d="M14 11V8a2 2 0 0 0-4 0" />
            }
            <path d="M12 21a9 9 0 0 0 9-9h-2" />
            <path d="M19 10l2 2 2-2" />
            <path d="M12 3a9 9 0 0 0-9 9h2" />
            <path d="M5 14l-2-2-2 2" />
          </svg>
        </button>

        {sessionLabel && (
          <span className={`text-sm font-semibold shrink-0 ${compInfo.competitionId ? 'text-purple-400' : 'text-dark-400'}`}>
            {sessionLabel}
          </span>
        )}

        {/* View toggles inline */}
        <div ref={viewRef} className="flex items-center gap-1 shrink-0 ml-1">
          <button onClick={() => setViewOpen(v => !v)}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              viewOpen ? 'text-primary-400' : 'text-dark-500 hover:text-dark-300'
            }`}>
            Вид
          </button>
          {viewOpen && (
            <>
              <div className="flex items-center rounded overflow-hidden text-[11px]">
                <button onClick={() => setModeOverride('quali')}
                  className={`px-2 py-1 transition-colors ${effectiveMode === 'quali' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>
                  Квала
                </button>
                <button onClick={() => setModeOverride('race')}
                  className={`px-2 py-1 transition-colors ${effectiveMode === 'race' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>
                  Гонка
                </button>
              </div>
              <Pill label="Сект." active={showSectors} onClick={() => setShowSectors((v: boolean) => !v)} />
              <Pill label="Поз" active={effectiveShowPos} onClick={() => setShowPosition((v: boolean | null) => v === null ? (effectiveMode !== 'race') : !v)} />
              <Pill label="Час" active={showTime} onClick={() => setShowTime((v: boolean) => !v)} />
              <Pill label="Бали" active={showPoints} onClick={() => setShowPoints((v: boolean) => !v)} />
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Right: pilot, kart, lap */}
        <div className="flex items-center gap-2 shrink-0">
          {pilot && (
            <span className="text-sm font-medium text-white truncate max-w-[130px]">
              {shortName(pilot)}
            </span>
          )}

          <div ref={selectorRef} className="relative">
            <button
              onClick={() => setSelectorOpen(o => !o)}
              className="flex items-center gap-1 bg-dark-800 border border-dark-700 text-white text-xl font-bold rounded-lg px-3 py-1 hover:border-primary-500 transition-colors"
            >
              {kart ?? '—'}
              <svg className={`w-3.5 h-3.5 text-dark-400 transition-transform ${selectorOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {selectorOpen && (
              <div className="absolute top-full right-0 mt-1 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1 z-50 min-w-[140px] max-h-64 overflow-y-auto">
                {ALL_KARTS.map(k => {
                  const en = entries.find(e => e.kart === k);
                  const live = liveKarts.has(k);
                  return (
                    <button key={k} onClick={() => goToKart(k)}
                      className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                        k === kart ? 'text-primary-400 bg-primary-500/10' : live ? 'text-dark-300 hover:text-white hover:bg-dark-800' : 'text-dark-600 hover:text-dark-400 hover:bg-dark-800'
                      }`}>
                      <span className="font-bold">{k}</span>
                      {en && <span className="text-dark-500 ml-2">{en.pilot}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {entry && (
            <span className="text-white font-mono font-semibold text-base">
              L{entry.lapNumber}
            </span>
          )}
        </div>
      </div>

      {/* Scrubber slot (replay mode) */}
      {scrubberSlot && (
        <div className="shrink-0">
          {scrubberSlot}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">

        {/* Time ranks — top right */}
        {entry && showTime && (timeGroupData?.pos != null || timeGlobalData?.pos != null) && (
          <div className="absolute top-3 right-4 z-10 text-right">
            {timeGroupData?.pos != null && (
              <div className="font-mono text-dark-300 font-semibold" style={{ fontSize: 'clamp(1rem, 3vw, 1.4rem)' }}>
                T1={timeGroupData.pos}/{timeGroupData.total}
              </div>
            )}
            {timeGlobalData?.pos != null && (
              <div className="font-mono text-dark-400" style={{ fontSize: 'clamp(1rem, 3vw, 1.4rem)' }}>
                T2={timeGlobalData.pos}/{timeGlobalData.total}
              </div>
            )}
          </div>
        )}

        {/* Position leaderboard — top left */}
        {entry && effectiveShowPos && positionLeaderboard && (
          <div className="absolute top-2 left-2 z-10 font-mono bg-dark-900/80 border border-dark-700 rounded-lg px-2.5 py-1.5"
               style={{ fontSize: 'clamp(0.75rem, 2.2vw, 1rem)' }}>
            {positionLeaderboard.items.map((item) => {
              const isMe = item.pilot === positionLeaderboard.myPilot;
              const name = shortName(item.pilot);
              const clipped = name.length > 7 ? name.slice(0, 7) + '.' : name;
              return (
                <div key={item.pilot} className={`flex items-center gap-1.5 leading-snug ${isMe ? 'text-white font-bold' : 'text-dark-400'}`}>
                  <span className={isMe ? 'text-lg' : ''} style={isMe ? { fontSize: 'clamp(1rem, 3vw, 1.4rem)' } : {}}>P{item.pos}</span>
                  {item.delta != null && item.delta !== 0 && (
                    <span className={`text-[0.7em] ${item.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {item.delta > 0 ? '\u25B2' : '\u25BC'}{Math.abs(item.delta)}
                    </span>
                  )}
                  <span>{clipped}</span>
                  {item.gapToNext != null && (
                    <span className="text-dark-600 text-[0.8em]">+{item.gapToNext.toFixed(2)}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!isLive ? (
          <div className="text-center">
            <p className="text-dark-500 text-sm">
              {nextSessionLabel ? `\u041e\u0447\u0456\u043a\u0443\u0432\u0430\u043d\u043d\u044f: ${nextSessionLabel}` : '\u041e\u0447\u0456\u043a\u0443\u0432\u0430\u043d\u043d\u044f \u0437\u0430\u0457\u0437\u0434\u0443...'}
            </p>
          </div>
        ) : !entry ? (
          <div className="text-center">
            <p className="text-dark-400 text-lg font-medium">\u041a\u0430\u0440\u0442 {kart ?? '\u2014'}</p>
            <p className="text-dark-600 text-sm mt-1">\u041d\u0435 \u0431\u0435\u0440\u0435 \u0443\u0447\u0430\u0441\u0442\u0456 \u0432 \u0446\u044c\u043e\u043c\u0443 \u0437\u0430\u0457\u0437\u0434\u0456</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-end pr-8 pl-4">
            <div className="flex flex-col justify-center items-center">
              <div className={`font-mono font-bold leading-none ${COLOR_CLASSES[lapColor]}`}
                   style={{ fontSize: 'clamp(4rem, 15vw, 10rem)' }}>
                {entry.lastLap ? toSeconds(entry.lastLap) : '\u2014'}
              </div>

              {showSectors && sectorDiffs.lap != null && (
                <span className={`font-mono font-bold mb-2 ${sectorDiffs.lap <= 0 ? 'text-green-400' : 'text-red-400/70'}`}
                      style={{ fontSize: 'clamp(1.2rem, 3.5vw, 2rem)' }}>
                  {sectorDiffs.lap <= 0 ? '\u2212' : '+'}{Math.abs(sectorDiffs.lap).toFixed(3)}
                </span>
              )}

              {showSectors && (
              <div className="flex items-center justify-center gap-8 mt-2">
                <div className="flex flex-col items-center">
                  <div className={`font-mono font-bold ${COLOR_CLASSES[s1Color]}`}
                       style={{ fontSize: 'clamp(1.5rem, 5vw, 3.5rem)' }}>
                    {entry.s1 && (parseTime(entry.s1) ?? 0) >= 10 ? toSeconds(entry.s1) : '\u2014'}
                  </div>
                  {sectorDiffs.s1 != null && (
                    <span className={`font-mono ${sectorDiffs.s1 <= 0 ? 'text-green-400' : 'text-red-400/70'}`}
                          style={{ fontSize: 'clamp(0.85rem, 2.5vw, 1.2rem)' }}>
                      {sectorDiffs.s1 <= 0 ? '\u2212' : '+'}{Math.abs(sectorDiffs.s1).toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="w-px h-10 bg-dark-800" />
                <div className="flex flex-col items-center">
                  <div className={`font-mono font-bold ${COLOR_CLASSES[s2Color]}`}
                       style={{ fontSize: 'clamp(1.5rem, 5vw, 3.5rem)' }}>
                    {entry.s2 && (parseTime(entry.s2) ?? 0) >= 10 ? toSeconds(entry.s2) : '\u2014'}
                  </div>
                  {sectorDiffs.s2 != null && (
                    <span className={`font-mono ${sectorDiffs.s2 <= 0 ? 'text-green-400' : 'text-red-400/70'}`}
                          style={{ fontSize: 'clamp(0.85rem, 2.5vw, 1.2rem)' }}>
                      {sectorDiffs.s2 <= 0 ? '\u2212' : '+'}{Math.abs(sectorDiffs.s2).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Бали — standings leaderboard + race points, bottom left */}
      {entry && showPoints && standingsLeaderboard && (
        <div className="absolute bottom-3 left-3 z-10 font-mono bg-dark-900/80 border border-dark-700 rounded-lg px-3 py-2"
             style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.1rem)' }}>
          {standingsLeaderboard.items.map((item) => {
            const isMe = item.pilot === standingsLeaderboard.myPilot;
            const diff = Math.round((item.pts - standingsLeaderboard.myPts) * 10) / 10;
            return (
              <div key={item.pilot} className={`flex items-center gap-2 leading-snug ${isMe ? 'text-white font-bold' : 'text-dark-400'}`}>
                <span className="w-5 text-right">{item.pos}.</span>
                <span className="truncate max-w-[100px]">{shortName(item.pilot)}</span>
                <span className={`ml-auto tabular-nums ${isMe ? 'text-green-400' : 'text-dark-500'}`}>{item.pts}</span>
                {!isMe && diff !== 0 && (
                  <span className={`text-[0.8em] ${diff > 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
                    {diff > 0 ? '+' : ''}{diff}
                  </span>
                )}
              </div>
            );
          })}
          {pointsData && pointsData.total > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-dark-700 text-green-400/80 text-center">
              P = {pointsData.total} = {pointsData.posPoints} + {pointsData.overtakePoints}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
