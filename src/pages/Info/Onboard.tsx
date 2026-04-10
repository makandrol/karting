import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTimingPoller } from '../../services/timingPoller';
import { COLLECTOR_URL } from '../../services/config';
import { parseTime, toSeconds, getTimeColor, COLOR_CLASSES } from '../../utils/timing';
import { COMPETITION_CONFIGS, getPhaseShortLabel } from '../../data/competitions';
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

  // ── View toggles ──
  const [showSectors, setShowSectors] = useState(true);
  const [modeOverride, setModeOverride] = useState<OnboardMode | null>(null);
  const [showPosition, setShowPosition] = useState<boolean | null>(null);
  const [showTimeGroup, setShowTimeGroup] = useState(false);
  const [showTimeGlobal, setShowTimeGlobal] = useState(false);
  const [showPoints, setShowPoints] = useState(false);
  const [showFinalPos, setShowFinalPos] = useState(false);
  const [showGap, setShowGap] = useState(false);

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

  const kartIdx = kart !== null ? ALL_KARTS.indexOf(kart) : -1;
  const prevKart = kartIdx > 0 ? ALL_KARTS[kartIdx - 1] : ALL_KARTS[ALL_KARTS.length - 1];
  const nextKart = kartIdx < ALL_KARTS.length - 1 ? ALL_KARTS[kartIdx + 1] : ALL_KARTS[0];

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

  // Position in current race (finishPos) + gain/loss vs startPos
  const positionData = useMemo(() => {
    if (!pilot) return null;
    if (pilotRow && currentRaceIndex >= 0) {
      const race = pilotRow.races[currentRaceIndex];
      if (race && race.finishPos > 0) {
        const delta = race.startPos > 0 ? race.startPos - race.finishPos : null;
        return { pos: race.finishPos, total: standings!.sorted.filter(r => r.races[currentRaceIndex]?.finishPos).length, delta };
      }
    }
    // Fallback: best lap ranking from live entries
    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap) }))
      .filter(e => e.best !== null && e.best! >= 38) as { pilot: string; best: number }[];
    withBest.sort((a, b) => a.best - b.best);
    const idx = withBest.findIndex(e => e.pilot === pilot);
    return { pos: idx >= 0 ? idx + 1 : null, total: withBest.length, delta: null };
  }, [pilot, pilotRow, currentRaceIndex, standings, entries]);

  // Time rank in group: best lap in current session among group pilots
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
    // Qualifying: rank among all qualifying pilots
    if (pilotRow && compInfo.phase?.startsWith('qualifying') && standings) {
      const withQuali = standings.sorted
        .filter(r => r.quali && r.quali.bestTime < Infinity)
        .sort((a, b) => a.quali!.bestTime - b.quali!.bestTime);
      const idx = withQuali.findIndex(r => r.pilot === pilot);
      return { pos: idx >= 0 ? idx + 1 : null, total: withQuali.length };
    }
    // Fallback
    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap) }))
      .filter(e => e.best !== null && e.best! >= 38) as { pilot: string; best: number }[];
    withBest.sort((a, b) => a.best - b.best);
    const idx = withBest.findIndex(e => e.pilot === pilot);
    return { pos: idx >= 0 ? idx + 1 : null, total: withBest.length };
  }, [pilot, pilotRow, currentRaceIndex, standings, compInfo.phase, entries]);

  // Time rank global: best lap across all sessions of same phase type
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

  // Gap to pilot ahead/behind (by best lap in current session)
  const gapData = useMemo(() => {
    if (!pilot || !entry) return null;
    const myBest = parseTime(entry.bestLap);
    if (myBest === null || myBest < 38) return null;

    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap) }))
      .filter(e => e.best !== null && e.best! >= 38) as { pilot: string; best: number }[];
    withBest.sort((a, b) => a.best - b.best);
    const myIdx = withBest.findIndex(e => e.pilot === pilot);
    if (myIdx < 0) return null;

    const ahead = myIdx > 0 ? Math.round((myBest - withBest[myIdx - 1].best) * 1000) / 1000 : null;
    const behind = myIdx < withBest.length - 1 ? Math.round((myBest - withBest[myIdx + 1].best) * 1000) / 1000 : null;
    return { ahead, behind };
  }, [pilot, entry, entries]);

  // Mini-leaderboard for "Рез": pilot above, current, pilot below — with point diffs
  const leaderboardData = useMemo(() => {
    if (!pilot || !standings) return null;
    const sorted = standings.sorted;
    const idx = sorted.findIndex(r => r.pilot === pilot);
    if (idx < 0) return null;

    const myPts = sorted[idx].totalPoints;
    const prev = idx > 0 ? { pilot: sorted[idx - 1].pilot, pts: sorted[idx - 1].totalPoints, diff: Math.round((sorted[idx - 1].totalPoints - myPts) * 10) / 10 } : null;
    const next = idx < sorted.length - 1 ? { pilot: sorted[idx + 1].pilot, pts: sorted[idx + 1].totalPoints, diff: Math.round((sorted[idx + 1].totalPoints - myPts) * 10) / 10 } : null;
    return { pos: idx + 1, total: sorted.length, myPts, prev, next };
  }, [pilot, standings]);

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

  const isLive = isReplay ? entries.length > 0 : (poller.mode === 'live' && entries.length > 0);

  // ── View toggle pill helper ──
  const Pill = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
        active ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
      }`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-dark-950 flex flex-col z-50 select-none">
      {/* Top bar */}
      <div className="flex items-center px-3 py-2 bg-dark-900/90 border-b border-dark-800 shrink-0 gap-2">
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

        {sessionLabel && (
          <span className={`text-xs font-medium shrink-0 ${compInfo.competitionId ? 'text-purple-400' : 'text-dark-500'}`}>
            {sessionLabel}
          </span>
        )}

        <div className="flex-1" />

        <button onClick={() => setLocked(l => !l)}
          className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            locked ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
          }`}
          title={locked ? 'Розблокувати обертання' : 'Заблокувати обертання'}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

        <div ref={selectorRef} className="relative">
          <button
            onClick={() => setSelectorOpen(o => !o)}
            className="flex items-center gap-1.5 bg-dark-800 border border-dark-700 text-white text-lg font-bold rounded-lg px-3 py-1 hover:border-primary-500 transition-colors"
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
      </div>

      {/* Scrubber slot (replay mode) */}
      {scrubberSlot && (
        <div className="shrink-0">
          {scrubberSlot}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {prevKart !== null && (
          <button onClick={() => goToKart(prevKart)}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-12 h-24 flex items-center justify-center text-dark-600 hover:text-white active:text-primary-400 transition-colors z-10">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {nextKart !== null && (
          <button onClick={() => goToKart(nextKart)}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-12 h-24 flex items-center justify-center text-dark-600 hover:text-white active:text-primary-400 transition-colors z-10">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Lap number — top right */}
        {entry && (
          <div className="absolute top-3 right-14 text-dark-500 font-mono z-10"
               style={{ fontSize: 'clamp(1rem, 3vw, 1.5rem)' }}>
            L{entry.lapNumber}
          </div>
        )}

        {/* Position + time + gap displays — top center */}
        {entry && (effectiveShowPos || showTimeGroup || showTimeGlobal || showGap) && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-4 z-10">
            {effectiveShowPos && positionData?.pos != null && (
              <div className="flex items-center gap-1">
                {showGap && gapData?.ahead != null && (
                  <span className="font-mono text-green-400/70 mr-1" style={{ fontSize: 'clamp(0.7rem, 2vw, 1rem)' }}>
                    +{gapData.ahead.toFixed(2)}
                  </span>
                )}
                <span className="font-mono font-bold text-white" style={{ fontSize: 'clamp(1.2rem, 4vw, 2rem)' }}>
                  P{positionData.pos}
                </span>
                {positionData.delta != null && positionData.delta !== 0 && (
                  <span className={`font-mono font-bold ${positionData.delta > 0 ? 'text-green-400' : 'text-red-400'}`}
                    style={{ fontSize: 'clamp(0.8rem, 2.5vw, 1.2rem)' }}>
                    {positionData.delta > 0 ? '▲' : '▼'}{Math.abs(positionData.delta)}
                  </span>
                )}
                {showGap && gapData?.behind != null && (
                  <span className="font-mono text-red-400/70 ml-1" style={{ fontSize: 'clamp(0.7rem, 2vw, 1rem)' }}>
                    {gapData.behind.toFixed(2)}
                  </span>
                )}
              </div>
            )}
            {!effectiveShowPos && showGap && gapData && (
              <div className="flex items-center gap-2">
                {gapData.ahead != null && (
                  <span className="font-mono text-green-400/70" style={{ fontSize: 'clamp(0.7rem, 2vw, 1rem)' }}>
                    +{gapData.ahead.toFixed(2)}
                  </span>
                )}
                {gapData.behind != null && (
                  <span className="font-mono text-red-400/70" style={{ fontSize: 'clamp(0.7rem, 2vw, 1rem)' }}>
                    {gapData.behind.toFixed(2)}
                  </span>
                )}
              </div>
            )}
            {showTimeGroup && timeGroupData?.pos != null && (
              <span className="font-mono text-dark-400" style={{ fontSize: 'clamp(0.9rem, 2.5vw, 1.3rem)' }}>
                T={timeGroupData.pos}/{timeGroupData.total}
              </span>
            )}
            {showTimeGlobal && timeGlobalData?.pos != null && (
              <span className="font-mono text-dark-500" style={{ fontSize: 'clamp(0.9rem, 2.5vw, 1.3rem)' }}>
                Tgl={timeGlobalData.pos}/{timeGlobalData.total}
              </span>
            )}
          </div>
        )}

        {!isLive ? (
          <div className="text-center">
            <p className="text-dark-500 text-sm">Очікування заїзду...</p>
          </div>
        ) : !entry ? (
          <div className="text-center">
            <p className="text-dark-400 text-lg font-medium">Карт {kart ?? '—'}</p>
            <p className="text-dark-600 text-sm mt-1">Не бере участі в цьому заїзді</p>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center px-16">
            {/* Center: lap time + sectors */}
            <div className="flex flex-col justify-center items-center">
              <div className={`font-mono font-bold leading-none mb-4 ${COLOR_CLASSES[lapColor]}`}
                   style={{ fontSize: 'clamp(4rem, 15vw, 10rem)' }}>
                {entry.lastLap ? toSeconds(entry.lastLap) : '—'}
              </div>

              {showSectors && (
              <div className="flex items-center justify-center gap-8">
                <div className={`font-mono font-bold ${COLOR_CLASSES[s1Color]}`}
                     style={{ fontSize: 'clamp(1.5rem, 5vw, 3.5rem)' }}>
                  {entry.s1 && (parseTime(entry.s1) ?? 0) >= 10 ? toSeconds(entry.s1) : '—'}
                </div>
                <div className="w-px h-10 bg-dark-800" />
                <div className={`font-mono font-bold ${COLOR_CLASSES[s2Color]}`}
                     style={{ fontSize: 'clamp(1.5rem, 5vw, 3.5rem)' }}>
                  {entry.s2 && (parseTime(entry.s2) ?? 0) >= 10 ? toSeconds(entry.s2) : '—'}
                </div>
              </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Рез — mini-leaderboard, bottom left */}
      {entry && showFinalPos && leaderboardData && (
        <div className="absolute bottom-3 left-3 z-10 font-mono text-[11px] leading-snug bg-dark-900/80 border border-dark-700 rounded-lg px-2 py-1.5">
          {leaderboardData.prev && (
            <div className="text-dark-500">
              {leaderboardData.pos - 1}. {leaderboardData.prev.pilot}{' '}
              <span className="text-dark-400">{leaderboardData.prev.pts}</span>{' '}
              <span className="text-green-400/70">+{leaderboardData.prev.diff}</span>
            </div>
          )}
          <div className="text-white font-bold">
            {leaderboardData.pos}. {pilot}{' '}
            <span className="text-green-400">{leaderboardData.myPts}</span>
          </div>
          {leaderboardData.next && (
            <div className="text-dark-500">
              {leaderboardData.pos + 1}. {leaderboardData.next.pilot}{' '}
              <span className="text-dark-400">{leaderboardData.next.pts}</span>{' '}
              <span className="text-red-400/70">{leaderboardData.next.diff}</span>
            </div>
          )}
        </div>
      )}

      {/* Бали — bottom center */}
      {entry && showPoints && pointsData && pointsData.total > 0 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
          <span className="font-mono text-green-400/80" style={{ fontSize: 'clamp(0.8rem, 2vw, 1.1rem)' }}>
            P = {pointsData.total} = {pointsData.posPoints} + {pointsData.overtakePoints}
          </span>
        </div>
      )}

      {/* View toggle — bottom right */}
      <div ref={viewRef} className="absolute bottom-3 right-3 z-20">
        <button onClick={() => setViewOpen(v => !v)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-medium transition-colors ${
            viewOpen ? 'border-primary-500 text-primary-400' : 'border-dark-700 bg-dark-900/80 text-dark-500 hover:text-dark-300'
          }`}>
          <span>Вид:</span>
          {viewOpen && (
            <>
              <button onClick={(e) => { e.stopPropagation(); setModeOverride(effectiveMode === 'quali' ? 'race' : 'quali'); }}
                className="px-1.5 py-0.5 rounded text-[9px] bg-dark-700 text-dark-300 transition-colors">
                {effectiveMode === 'quali' ? 'Квала' : 'Гонка'}
              </button>
              <Pill label="Сект." active={showSectors} onClick={() => setShowSectors(v => !v)} />
              <Pill label="Поз" active={effectiveShowPos} onClick={() => setShowPosition(v => v === null ? (effectiveMode !== 'race') : !v)} />
              <Pill label="Gap" active={showGap} onClick={() => setShowGap(v => !v)} />
              <Pill label="Час" active={showTimeGroup} onClick={() => setShowTimeGroup(v => !v)} />
              <Pill label="Час гл" active={showTimeGlobal} onClick={() => setShowTimeGlobal(v => !v)} />
              <Pill label="Бали" active={showPoints} onClick={() => setShowPoints(v => !v)} />
              <Pill label="Рез" active={showFinalPos} onClick={() => setShowFinalPos(v => !v)} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
