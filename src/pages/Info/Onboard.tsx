import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTimingPoller } from '../../services/timingPoller';
import { COLLECTOR_URL } from '../../services/config';
import { parseTime, toSeconds, getTimeColor, COLOR_CLASSES, shortName } from '../../utils/timing';
import { COMPETITION_CONFIGS, getPhaseShortLabel, getPhasesForFormat, buildGonzalesRotation, getGonzalesKartForRound } from '../../data/competitions';
import {
  type SessionLap, type CompSession, type ScoringData, type ManualEdits,
  type GonzalesStandingsData, type ComputeGonzalesParams,
  computeStandings, computeSprintStandings, sprintAwareSort, computeGonzalesStandings,
} from '../../utils/scoring';
import { trackDisplayId } from '../../data/tracks';
import type { TimingEntry } from '../../types';

export interface OnboardProps {
  replayEntries?: TimingEntry[];
  replaySessionId?: string;
  scrubberSlot?: ReactNode;
  onClose?: () => void;
  embedded?: boolean;
  scrubTime?: number | null;
}

interface CompSessionInfo {
  competitionId: string | null;
  format: string | null;
  phase: string | null;
}

type OnboardMode = 'quali' | 'race' | 'gonzales';

interface GonzalesConfigData {
  pilotStartSlots: Record<string, number>;
  kartList: number[];
  slotOrder?: (number | null)[];
  scoringLaps?: number[];
  kartReplacements?: Record<number, number>;
  excludedKarts?: number[];
}

interface FullCompData {
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
  sessionStartTimes: Map<string, number>;
  scoring: ScoringData;
  edits: ManualEdits;
  excludedPilots: Set<string>;
  maxGroups: number;
  pilotsOverride: number | null;
  pilotsLocked: boolean;
  format: string;
  racePilotCount: number | null;
  gonzalesConfig?: GonzalesConfigData;
}

const Pill = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
      active ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
    }`}>
    {label}
  </button>
);

type PosEntry = { pilot: string; pos: number; delta: number | null; gapToNext: number | null; bestTime: string | null };
type StEntry = { pilot: string; pos: number; pts: number };

interface PosWindow {
  top: PosEntry[];
  hasEllipsis: boolean;
  around: PosEntry[];
  myPilot: string;
  total: number;
}

function buildRaceWindow(list: PosEntry[], myIdx: number, myPilot: string, expanded: boolean): PosWindow | null {
  const total = list.length;
  if (total === 0) return null;

  const topCount = expanded ? 2 : 1;
  const aroundSize = expanded ? 6 : 4;

  if (total <= topCount + aroundSize) {
    return { top: [], hasEllipsis: false, around: list, myPilot, total };
  }

  const top = list.slice(0, topCount);
  const halfBefore = expanded ? 3 : 2;
  const halfAfter = expanded ? 2 : 1;

  let aroundStart: number;
  if (myIdx <= topCount + halfBefore - 1) {
    aroundStart = topCount;
  } else if (myIdx >= total - halfAfter - 1) {
    aroundStart = total - aroundSize;
  } else {
    aroundStart = myIdx - halfBefore;
  }
  aroundStart = Math.max(aroundStart, topCount);
  const around = list.slice(aroundStart, aroundStart + aroundSize);

  if (aroundStart <= topCount) {
    return { top: [], hasEllipsis: false, around: list.slice(0, topCount + aroundSize), myPilot, total };
  }

  return { top, hasEllipsis: true, around, myPilot, total };
}

function buildQualiWindow(list: PosEntry[], myIdx: number, myPilot: string, expanded: boolean): PosWindow | null {
  const total = list.length;
  if (total === 0) return null;

  const topCount = expanded ? 2 : 1;
  const aroundSize = expanded ? 6 : 4;

  if (total <= topCount + aroundSize) {
    return { top: [], hasEllipsis: false, around: list, myPilot, total };
  }

  const top = list.slice(0, topCount);
  const halfBefore = expanded ? 3 : 2;
  const halfAfter = expanded ? 2 : 1;

  let aroundStart: number;
  if (myIdx <= topCount + halfBefore - 1) {
    aroundStart = topCount;
  } else if (myIdx >= total - halfAfter - 1) {
    aroundStart = total - aroundSize;
  } else {
    aroundStart = myIdx - halfBefore;
  }
  aroundStart = Math.max(aroundStart, topCount);
  const around = list.slice(aroundStart, aroundStart + aroundSize);

  if (aroundStart <= topCount) {
    return { top: [], hasEllipsis: false, around: list.slice(0, topCount + aroundSize), myPilot, total };
  }

  return { top, hasEllipsis: true, around, myPilot, total };
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

export default function Onboard({ replayEntries, replaySessionId, scrubberSlot, onClose, embedded, scrubTime: propScrubTime }: OnboardProps = {}) {
  const isReplay = replayEntries != null;

  const { kartId } = useParams<{ kartId: string }>();
  const navigate = useNavigate();
  const poller = useTimingPoller({ interval: isReplay ? 999999 : 1000 });
  const [locked, setLocked] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const [pilotSelectorOpen, setPilotSelectorOpen] = useState(false);
  const pilotSelectorRef = useRef<HTMLDivElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);

  // Lock mode: 'kart' = follow a kart (pilot changes), 'pilot' = follow a pilot (kart changes)
  type LockMode = 'kart' | 'pilot';
  const [lockMode, setLockMode] = useState<LockMode>('kart');
  const [lockedPilot, setLockedPilot] = useState<string | null>(null);

  // In replay mode, kart is managed via internal state; in live mode, via URL params
  const [replayKart, setReplayKart] = useState<number | null>(null);

  const entries = isReplay ? replayEntries : poller.entries;
  const sessionId = isReplay ? (replaySessionId || null) : ((poller.collectorStatus as any)?.sessionId || null);

  // ── View toggles (persisted) ──
  // null = use contextual default; true/false = explicit user override
  const onbViewKey = 'karting_onboard_view';
  const loadOnbView = () => { try { const s = localStorage.getItem(onbViewKey); return s ? JSON.parse(s) : null; } catch { return null; } };
  const savedOnbView = useRef(loadOnbView());

  const [showSectors, setShowSectors] = useState<boolean | null>(savedOnbView.current?.showSectors ?? null);
  const [modeOverride, setModeOverride] = useState<OnboardMode | null>(savedOnbView.current?.modeOverride ?? null);
  const [showPosition, setShowPosition] = useState<boolean | null>(savedOnbView.current?.showPosition ?? null);
  const [showTime, setShowTime] = useState<boolean | null>(savedOnbView.current?.showTime ?? null);
  const [showPoints, setShowPoints] = useState<boolean | null>(savedOnbView.current?.showPoints ?? null);

  useEffect(() => {
    localStorage.setItem(onbViewKey, JSON.stringify({ showSectors, modeOverride, showPosition, showTime, showPoints }));
  }, [showSectors, modeOverride, showPosition, showTime, showPoints]);

  const kartFromUrl = isReplay ? replayKart : (kartId ? parseInt(kartId, 10) : null);

  // ── Competition data (state declarations hoisted for kart derivation) ──
  const [compInfo, setCompInfo] = useState<CompSessionInfo>({ competitionId: null, format: null, phase: null });
  const [raceNumber, setRaceNumber] = useState<number | null>(null);
  const [fullComp, setFullComp] = useState<FullCompData | null>(null);

  // kart and entry resolved based on lock mode + gonzales state
  const [gonzalesLockedKart, setGonzalesLockedKart] = useState<number | null>(null);

  const isGonzales = compInfo.format === 'gonzales';
  const isRoundPhase = !!(compInfo.phase && /^round_\d+/.test(compInfo.phase));
  const isQualiPhase = !!(compInfo.phase && compInfo.phase.startsWith('qualifying'));

  // Derive kart and entry
  const kart = useMemo(() => {
    if (lockMode === 'kart') return kartFromUrl;
    if (!lockedPilot) return kartFromUrl;
    if (isGonzales && isRoundPhase) return gonzalesLockedKart;
    if (isGonzales && !isQualiPhase) return null; // idle
    return entries.find(e => e.pilot === lockedPilot)?.kart ?? kartFromUrl;
  }, [lockMode, lockedPilot, kartFromUrl, isGonzales, isRoundPhase, isQualiPhase, gonzalesLockedKart, entries]);

  const entry = useMemo(() => {
    if (lockMode === 'kart') return kart !== null ? entries.find(e => e.kart === kart) ?? null : null;
    if (!lockedPilot) return kart !== null ? entries.find(e => e.kart === kart) ?? null : null;
    if (isGonzales && isRoundPhase) return gonzalesLockedKart != null ? entries.find(e => e.kart === gonzalesLockedKart) ?? null : null;
    if (isGonzales && !isQualiPhase) return null; // idle
    return entries.find(e => e.pilot === lockedPilot) ?? null;
  }, [lockMode, lockedPilot, kart, isGonzales, isRoundPhase, isQualiPhase, gonzalesLockedKart, entries]);
  const ALL_KARTS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,33,44,55,69,77,88];
  const liveKarts = new Set(entries.map(e => e.kart));

  // Pilot list: updated by effect when gonzales data is available
  const [gonzalesPilotList, setGonzalesPilotList] = useState<{ pilot: string; kart: number | null }[] | null>(null);
  const pilotList = useMemo((): { pilot: string; kart: number | null }[] => {
    if (gonzalesPilotList) return gonzalesPilotList;
    return [...new Set(entries.map(e => e.pilot))].sort().map(p => ({
      pilot: p,
      kart: entries.find(e => e.pilot === p)?.kart ?? null,
    }));
  }, [entries, gonzalesPilotList]);

  // Kart list for dropdown: in gonzales mode, shows karts with their assigned pilot for this round
  const kartList = useMemo((): { kart: number; pilot: string | null }[] => {
    if (gonzalesPilotList) {
      return gonzalesPilotList
        .filter(p => p.kart !== null)
        .map(p => ({ kart: p.kart!, pilot: p.pilot }))
        .sort((a, b) => a.kart - b.kart);
    }
    return ALL_KARTS.filter(k => liveKarts.has(k)).map(k => ({
      kart: k,
      pilot: entries.find(e => e.kart === k)?.pilot ?? null,
    }));
  }, [entries, gonzalesPilotList, liveKarts]);

  const goToKart = useCallback((k: number) => {
    setLockMode('kart');
    setLockedPilot(null);
    if (isReplay) {
      setReplayKart(k);
    } else {
      navigate(`/onboard/${k}`, { replace: true });
    }
    setSelectorOpen(false);
  }, [isReplay, navigate]);

  const goToPilot = useCallback((p: string) => {
    setLockMode('pilot');
    setLockedPilot(p);
    setPilotSelectorOpen(false);
  }, []);


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
    if (!pilotSelectorOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (pilotSelectorRef.current && !pilotSelectorRef.current.contains(e.target as Node)) setPilotSelectorOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [pilotSelectorOpen]);

  useEffect(() => {
    if (!viewOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (viewRef.current && !viewRef.current.contains(e.target as Node)) setViewOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [viewOpen]);

  // ── Competition data (fetching) ──

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
    if (compInfo.format === 'gonzales' && compInfo.phase.startsWith('round_')) return 'gonzales';
    if (compInfo.phase.startsWith('qualifying')) return 'quali';
    if (compInfo.phase.startsWith('race_') || compInfo.phase.startsWith('round_') || compInfo.phase.startsWith('final_')) return 'race';
    return 'quali';
  }, [compInfo.phase, compInfo.format]);

  const effectiveMode = modeOverride ?? autoMode;

  // Contextual defaults: prokat=квала+сект, comp quali=+поз+час, comp race=гонка+все
  type CtxType = 'prokat' | 'comp_quali' | 'comp_race' | 'comp_gonzales';
  const contextType: CtxType = !compInfo.competitionId ? 'prokat'
    : compInfo.format === 'gonzales' && autoMode === 'gonzales' ? 'comp_gonzales'
    : autoMode === 'race' ? 'comp_race' : 'comp_quali';
  const ctxDefaults: Record<CtxType, { sectors: boolean; position: boolean; time: boolean; points: boolean }> = {
    prokat:         { sectors: true,  position: false, time: false, points: false },
    comp_quali:     { sectors: true,  position: true,  time: true,  points: false },
    comp_race:      { sectors: true,  position: true,  time: true,  points: true },
    comp_gonzales:  { sectors: true,  position: true,  time: false, points: true },
  };
  const defaults = ctxDefaults[contextType];

  const effectiveShowSectors = showSectors ?? defaults.sectors;
  const effectiveShowPos = showPosition ?? defaults.position;
  const effectiveShowTime = effectiveShowPos;
  const effectiveShowPoints = effectiveMode === 'quali' ? false : (showPoints ?? defaults.points);

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
        const sessionStartTimes = new Map<string, number>();
        for (const s of sessions) {
          const laps = await fetch(`${COLLECTOR_URL}/db/laps?session=${s.sessionId}`).then(r => r.json()).catch(() => []);
          sessionLaps.set(s.sessionId, laps);
          const tsMatch = s.sessionId.match(/session-(\d+)/);
          if (tsMatch) sessionStartTimes.set(s.sessionId, parseInt(tsMatch[1]));
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
        const gonzCfg = compInfo.format === 'gonzales' ? {
          pilotStartSlots: results.gonzalesConfig?.pilotStartSlots || {},
          kartList: results.gonzalesConfig?.kartList || [],
          slotOrder: results.gonzalesConfig?.slotOrder,
          scoringLaps: results.gonzalesConfig?.scoringLaps,
          kartReplacements: results.gonzalesConfig?.kartReplacements,
          excludedKarts: results.gonzalesConfig?.excludedKarts,
        } as GonzalesConfigData : undefined;
        setFullComp({
          sessions,
          sessionLaps,
          sessionStartTimes,
          scoring: scoringRes,
          edits: results.edits || {},
          excludedPilots: new Set(results.excludedPilots || []),
          maxGroups: results.groupCountOverride ?? results.autoDetectedGroups ?? autoGroups,
          pilotsOverride: results.totalPilotsOverride ?? null,
          pilotsLocked: results.totalPilotsLocked ?? false,
          format: compInfo.format!,
          racePilotCount: results.racePilotCount ?? null,
          gonzalesConfig: gonzCfg,
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

  // ── Gonzales-specific data ──

  const gonzalesRoundIdx = useMemo(() => {
    if (compInfo.format !== 'gonzales' || !compInfo.phase || !fullComp) return -1;
    if (!compInfo.phase.match(/^round_\d+/)) return -1;
    // Must match scoring's ri: sort round sessions by round number then group number
    const roundSessions = fullComp.sessions
      .filter(s => s.phase && !s.phase.startsWith('qualifying'))
      .sort((a, b) => {
        const ra = a.phase?.match(/round_(\d+)/);
        const rb = b.phase?.match(/round_(\d+)/);
        const na = ra ? parseInt(ra[1]) : 0;
        const nb = rb ? parseInt(rb[1]) : 0;
        if (na !== nb) return na - nb;
        const ga = a.phase?.match(/group_(\d+)/);
        const gb = b.phase?.match(/group_(\d+)/);
        return (ga ? parseInt(ga[1]) : 0) - (gb ? parseInt(gb[1]) : 0);
      });
    return roundSessions.findIndex(s => s.phase === compInfo.phase);
  }, [compInfo.format, compInfo.phase, fullComp]);

  const gonzalesData = useMemo((): GonzalesStandingsData | null => {
    if (!fullComp || fullComp.format !== 'gonzales' || !fullComp.gonzalesConfig) return null;
    const cfg = fullComp.gonzalesConfig;

    let sessions = fullComp.sessions;
    let sessionLapsForGonzales = fullComp.sessionLaps;

    if (propScrubTime != null) {
      sessions = fullComp.sessions.filter(s => {
        const startTime = fullComp.sessionStartTimes.get(s.sessionId);
        return startTime != null && startTime <= propScrubTime;
      });
      sessionLapsForGonzales = new Map();
      for (const s of sessions) {
        const laps = fullComp.sessionLaps.get(s.sessionId) || [];
        sessionLapsForGonzales.set(s.sessionId, laps.filter(l => l.ts <= propScrubTime));
      }
    }

    return computeGonzalesStandings({
      sessions,
      sessionLaps: sessionLapsForGonzales,
      excludedPilots: fullComp.excludedPilots,
      kartList: cfg.kartList.length > 0 ? cfg.kartList : undefined,
      kartReplacements: cfg.kartReplacements,
      excludedKarts: cfg.excludedKarts ? new Set(cfg.excludedKarts) : undefined,
      scoringLaps: cfg.scoringLaps,
      pilotStartSlots: cfg.pilotStartSlots,
      slotOrder: cfg.slotOrder,
    });
  }, [fullComp, propScrubTime]);

  const gonzalesSlots = useMemo(() => {
    if (!gonzalesData || !fullComp?.gonzalesConfig) return null;
    const cfg = fullComp.gonzalesConfig;
    const pilotCount = Object.keys(cfg.pilotStartSlots).length || gonzalesData.rows.length;
    return buildGonzalesRotation(gonzalesData.karts, pilotCount, cfg.slotOrder);
  }, [gonzalesData, fullComp?.gonzalesConfig]);

  // Identify "my pilot" in Gonzales by reverse-lookup: who should be on this kart in this round?
  const [gonzalesPilotId, setGonzalesPilotId] = useState<string | null>(null);

  // Update gonzales pilot list for the dropdown
  useEffect(() => {
    if (!fullComp?.gonzalesConfig || !gonzalesSlots) {
      setGonzalesPilotList(null);
      return;
    }
    const cfg = fullComp.gonzalesConfig;
    if (gonzalesRoundIdx >= 0) {
      // Active round: show rotation-assigned karts
      const list = Object.entries(cfg.pilotStartSlots)
        .map(([p, startSlot]) => ({
          pilot: p,
          kart: getGonzalesKartForRound(gonzalesSlots, startSlot, gonzalesRoundIdx).kart,
        }))
        .sort((a, b) => a.pilot.localeCompare(b.pilot, 'uk'));
      setGonzalesPilotList(list);
    } else if (compInfo.phase && compInfo.phase.startsWith('qualifying')) {
      // Qualifying: show karts from live entries, null for those not in entries
      const entryKart = new Map(entries.map(e => [e.pilot, e.kart]));
      const list = Object.keys(cfg.pilotStartSlots)
        .map(p => ({
          pilot: p,
          kart: entryKart.get(p) ?? null,
        }))
        .sort((a, b) => a.pilot.localeCompare(b.pilot, 'uk'));
      setGonzalesPilotList(list);
    } else {
      // Between sessions (idle): show all pilots with no kart
      const list = Object.keys(cfg.pilotStartSlots)
        .map(p => ({ pilot: p, kart: null as number | null }))
        .sort((a, b) => a.pilot.localeCompare(b.pilot, 'uk'));
      setGonzalesPilotList(list);
    }
  }, [fullComp?.gonzalesConfig, gonzalesSlots, gonzalesRoundIdx, compInfo.phase, entries]);

  // Gonzales pilot-lock: compute kart from rotation
  useEffect(() => {
    if (lockMode !== 'pilot' || !lockedPilot || !gonzalesSlots || !fullComp?.gonzalesConfig || gonzalesRoundIdx < 0) {
      setGonzalesLockedKart(null);
      return;
    }
    const startSlot = fullComp.gonzalesConfig.pilotStartSlots[lockedPilot];
    if (startSlot == null) { setGonzalesLockedKart(null); return; }
    const slot = getGonzalesKartForRound(gonzalesSlots, startSlot, gonzalesRoundIdx);
    setGonzalesLockedKart(slot.kart);
  }, [lockMode, lockedPilot, gonzalesSlots, fullComp?.gonzalesConfig, gonzalesRoundIdx]);

  useEffect(() => {
    if (lockMode === 'pilot' && lockedPilot) {
      setGonzalesPilotId(lockedPilot);
      return;
    }
    // kart-lock: derive which pilot is assigned to the current kart in this round
    if (!fullComp?.gonzalesConfig || kartFromUrl == null) {
      setGonzalesPilotId(null);
      return;
    }
    if (isQualiPhase) {
      // During qualifying: pilot from live entries
      const e = entries.find(e => e.kart === kartFromUrl);
      setGonzalesPilotId(e && fullComp.gonzalesConfig.pilotStartSlots[e.pilot] != null ? e.pilot : null);
      return;
    }
    if (!gonzalesSlots || gonzalesRoundIdx < 0) {
      setGonzalesPilotId(null);
      return;
    }
    // During rounds: reverse-lookup rotation
    const slots = fullComp.gonzalesConfig.pilotStartSlots;
    for (const [p, startSlot] of Object.entries(slots)) {
      const slot = getGonzalesKartForRound(gonzalesSlots, startSlot, gonzalesRoundIdx);
      if (slot.kart === kartFromUrl) {
        setGonzalesPilotId(p);
        return;
      }
    }
    setGonzalesPilotId(null);
  }, [gonzalesSlots, fullComp?.gonzalesConfig, gonzalesRoundIdx, kartFromUrl, lockMode, lockedPilot, isQualiPhase, entries]);

  // Current kart index in gonzalesData.karts
  const gonzalesKartIdx = useMemo(() => {
    if (!gonzalesData || kart == null) return -1;
    return gonzalesData.karts.indexOf(kart);
  }, [gonzalesData, kart]);

  // Best times on current kart across all rounds (for diff reference)
  const gonzalesKartBest = useMemo(() => {
    if (!gonzalesData || gonzalesKartIdx < 0) return { bestLap: null as number | null, bestS1: null as number | null, bestS2: null as number | null };
    let bestLap: number | null = null;
    let bestS1: number | null = null;
    let bestS2: number | null = null;
    for (const row of gonzalesData.rows) {
      const kr = row.kartResults[gonzalesKartIdx];
      if (!kr) continue;
      if (kr.bestTime !== null && (bestLap === null || kr.bestTime < bestLap)) bestLap = kr.bestTime;
      if (kr.bestS1 !== null && (bestS1 === null || kr.bestS1 < bestS1)) bestS1 = kr.bestS1;
      if (kr.bestS2 !== null && (bestS2 === null || kr.bestS2 < bestS2)) bestS2 = kr.bestS2;
    }
    return { bestLap, bestS1, bestS2 };
  }, [gonzalesData, gonzalesKartIdx]);

  const livePositions = useMemo(() =>
    entries.map(e => ({ pilot: e.pilot, position: e.position ?? 99 })),
    [entries]
  );

  const standings = useMemo(() => {
    if (!fullComp || !compInfo.phase) return null;

    let sessions = fullComp.sessions;
    let sessionLapsForStandings = fullComp.sessionLaps;

    if (propScrubTime != null) {
      sessions = fullComp.sessions.filter(s => {
        const startTime = fullComp.sessionStartTimes.get(s.sessionId);
        return startTime != null && startTime <= propScrubTime;
      });
      sessionLapsForStandings = new Map();
      for (const s of sessions) {
        const laps = fullComp.sessionLaps.get(s.sessionId) || [];
        sessionLapsForStandings.set(s.sessionId, laps.filter(l => l.ts <= propScrubTime));
      }
    }

    const computeFn = fullComp.format === 'sprint' ? computeSprintStandings : computeStandings;
    const rows = computeFn({
      format: fullComp.format,
      sessions,
      sessionLaps: sessionLapsForStandings,
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
  }, [fullComp, compInfo.phase, sessionId, livePositions, propScrubTime]);

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

  const pilot = (lockMode === 'pilot' ? lockedPilot : null)
    ?? (isGonzales ? gonzalesPilotId : null)
    ?? entry?.pilot
    ?? null;

  const pilotRow = useMemo(() => {
    if (!pilot || !standings) return null;
    return standings.rows.find(r => r.pilot === pilot) ?? null;
  }, [pilot, standings]);

  // Time rank in session (from entries, same data as position leaderboard)
  const timeGroupData = useMemo(() => {
    if (!pilot) return null;
    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap) }))
      .filter(e => e.best !== null && e.best! >= 38) as { pilot: string; best: number }[];
    withBest.sort((a, b) => a.best - b.best);
    const idx = withBest.findIndex(e => e.pilot === pilot);
    return { pos: idx >= 0 ? idx + 1 : null, total: withBest.length };
  }, [pilot, entries]);

  // Time rank global (T2) — across all groups in race mode
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

  // Position leaderboard
  const posExpandedPos = useMemo(() => {
    if (!effectiveShowPoints) return true;
    if (!pilot) return true;
    if (effectiveMode === 'gonzales' && gonzalesData) {
      return !gonzalesData.rows.some(r => r.pilot === pilot && r.averageTime !== null);
    }
    if (!standings) return true;
    return standings.sorted.findIndex(r => r.pilot === pilot) < 0;
  }, [effectiveShowPoints, pilot, standings, effectiveMode, gonzalesData]);

  const positionLeaderboard = useMemo((): PosWindow | null => {
    if (!pilot) return null;

    // Gonzales mode: per-kart leaderboard from all rounds + live entries
    if (effectiveMode === 'gonzales' && gonzalesData && gonzalesKartIdx >= 0) {
      const myBest = entry ? parseTime(entry.bestLap) : null;
      type KartEntry = { pilot: string; best: number; bestStr: string };
      const kartEntries: KartEntry[] = [];
      const seen = new Set<string>();

      for (const row of gonzalesData.rows) {
        const kr = row.kartResults[gonzalesKartIdx];
        if (!kr || kr.bestTime === null) continue;
        kartEntries.push({ pilot: row.pilot, best: kr.bestTime, bestStr: kr.bestTimeStr! });
        seen.add(row.pilot);
      }

      // Merge live entries — map transponder pilot name to real pilot via gonzalesPilotList
      const kartToPilot = new Map<number, string>();
      if (gonzalesPilotList) {
        for (const p of gonzalesPilotList) {
          if (p.kart != null) kartToPilot.set(p.kart, p.pilot);
        }
      }
      for (const e of entries) {
        const eBest = parseTime(e.bestLap);
        if (eBest === null || eBest < 38 || !e.bestLap) continue;
        const realPilot = kartToPilot.get(e.kart) ?? e.pilot;
        const existing = kartEntries.find(k => k.pilot === realPilot);
        if (existing) {
          if (eBest < existing.best) { existing.best = eBest; existing.bestStr = e.bestLap; }
        } else if (!seen.has(realPilot)) {
          kartEntries.push({ pilot: realPilot, best: eBest, bestStr: e.bestLap });
        }
      }

      kartEntries.sort((a, b) => a.best - b.best);
      const myIdx = kartEntries.findIndex(k => k.pilot === pilot);

      if (kartEntries.length === 0) return null;

      const refBest = myBest ?? (myIdx >= 0 ? kartEntries[myIdx].best : null);
      const list: PosEntry[] = kartEntries.map((k, i) => {
        const isMe = k.pilot === pilot;
        const gap = refBest !== null ? Math.round((k.best - refBest) * 1000) / 1000 : null;
        return { pilot: k.pilot, pos: i + 1, delta: null, gapToNext: gap !== null && gap !== 0 ? gap : null, bestTime: isMe ? k.bestStr : null };
      });
      return buildQualiWindow(list, Math.max(myIdx, 0), pilot, posExpandedPos);
    }

    if (!entry) return null;

    if (effectiveMode === 'race') {
      const myBest = parseTime(entry.bestLap);
      const sorted = [...entries]
        .filter(e => e.lapNumber >= 0)
        .sort((a, b) => a.position - b.position);
      if (sorted.length === 0) return null;
      const myIdx = sorted.findIndex(e => e.pilot === pilot);
      if (myIdx < 0) return null;

      const list: PosEntry[] = sorted.map((e) => {
        const startPos = e.currentLapSec as number | null;
        const d = startPos != null && startPos > 0 ? startPos - e.position : null;
        const eBest = parseTime(e.bestLap);
        const gap = eBest !== null && myBest !== null
          ? Math.round((eBest - myBest) * 1000) / 1000
          : null;
        return { pilot: e.pilot, pos: e.position, delta: d, gapToNext: gap !== 0 ? gap : null, bestTime: null };
      });
      return buildRaceWindow(list, myIdx, pilot, posExpandedPos);
    }

    // Quali / fallback: best lap ranking with gaps relative to my best
    const myBest = parseTime(entry.bestLap);
    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap), bestStr: e.bestLap }))
      .filter(e => e.best !== null && e.best! >= 38) as { pilot: string; best: number; bestStr: string }[];
    withBest.sort((a, b) => a.best - b.best);
    const myIdx = withBest.findIndex(e => e.pilot === pilot);
    if (myIdx < 0 || myBest === null) return null;
    const list: PosEntry[] = withBest.map((e, i) => {
      const isMe = e.pilot === pilot;
      const gap = Math.round((e.best - myBest) * 1000) / 1000;
      return { pilot: e.pilot, pos: i + 1, delta: null, gapToNext: gap !== 0 ? gap : null, bestTime: isMe ? e.bestStr : null };
    });
    return buildQualiWindow(list, myIdx, pilot, posExpandedPos);
  }, [pilot, entry, pilotRow, currentRaceIndex, standings, entries, effectiveMode, posExpandedPos, gonzalesData, gonzalesKartIdx]);

  // Standings leaderboard for Бали (5-pilot list) or Gonzales avg times
  const standingsLeaderboard = useMemo(() => {
    if (!pilot) return null;

    // Gonzales: standings by average time
    if (effectiveMode === 'gonzales' && gonzalesData) {
      const rows = gonzalesData.rows
        .filter(r => r.averageTime !== null)
        .sort((a, b) => a.averageTime! - b.averageTime!);
      const idx = rows.findIndex(r => r.pilot === pilot);
      if (idx < 0) return null;
      const list = rows.map((r, i) => ({
        pilot: r.pilot,
        pos: i + 1,
        pts: r.averageTime!,
      }));
      return buildStandingsWindow(list, idx, pilot);
    }

    if (!standings) return null;
    const sorted = standings.sorted;
    const idx = sorted.findIndex(r => r.pilot === pilot);
    if (idx < 0) return null;

    const list = sorted.map((r, i) => ({
      pilot: r.pilot,
      pos: i + 1,
      pts: Math.round(r.totalPoints * 10) / 10,
    }));
    return buildStandingsWindow(list, idx, pilot);
  }, [pilot, standings, effectiveMode, gonzalesData]);
  const nextSessionLabel = useMemo(() => {
    if (!compInfo.format || !compInfo.phase || !fullComp) return null;
    const phases = getPhasesForFormat(compInfo.format, fullComp.maxGroups);
    const currentIdx = phases.findIndex(p => p.id === compInfo.phase);
    if (currentIdx < 0 || currentIdx >= phases.length - 1) return null;
    const next = phases[currentIdx + 1];
    return next.shortLabel || next.label;
  }, [compInfo.format, compInfo.phase, fullComp]);

  const isLive = isReplay ? entries.length > 0 : (poller.mode === 'live' && entries.length > 0);

  // ── Pilot history for idle/no-entry state ──
  type PilotHistoryEntry = { label: string; kart: number; bestTime: string; position: string };
  type PilotNextInfo = { label: string; startPos: number | null; sessionsUntil: number };

  const pilotHistory = useMemo((): PilotHistoryEntry[] => {
    if (!pilot || !pilotRow || !compInfo.format || !fullComp) return [];
    const result: PilotHistoryEntry[] = [];
    const groupCount = fullComp.maxGroups;

    if (pilotRow.qualis) {
      for (let i = 0; i < pilotRow.qualis.length; i++) {
        const q = pilotRow.qualis[i];
        if (!q) continue;
        const allQualis = standings?.rows.map(r => r.qualis?.[i]).filter(Boolean) as { bestTime: number }[] ?? [];
        allQualis.sort((a, b) => a.bestTime - b.bestTime);
        const pos = allQualis.findIndex(x => x.bestTime === q.bestTime) + 1;
        result.push({
          label: `Кв${i + 1}`,
          kart: q.kart,
          bestTime: q.bestTimeStr,
          position: `P${pos || '?'}`,
        });
      }
    } else if (pilotRow.quali) {
      const q = pilotRow.quali;
      const allQualis = standings?.rows.map(r => r.quali).filter(Boolean) as { bestTime: number }[] ?? [];
      allQualis.sort((a, b) => a.bestTime - b.bestTime);
      const pos = allQualis.findIndex(x => x.bestTime === q.bestTime) + 1;
      result.push({
        label: 'Квала',
        kart: q.kart,
        bestTime: q.bestTimeStr,
        position: `P${pos || '?'}`,
      });
    }

    for (let i = 0; i < pilotRow.races.length; i++) {
      const r = pilotRow.races[i];
      if (!r) continue;
      const raceNum = i + 1;
      const groupLabel = groupCount > 1 ? `-${r.group}` : '';
      result.push({
        label: `Г${raceNum}${groupLabel}`,
        kart: r.kart,
        bestTime: r.bestTimeStr,
        position: `P${r.finishPos}`,
      });
    }
    return result;
  }, [pilot, pilotRow, compInfo.format, fullComp, standings]);

  const pilotNextSession = useMemo((): PilotNextInfo | null => {
    if (!pilot || !compInfo.format || !fullComp || !standings) return null;
    const phases = getPhasesForFormat(compInfo.format, fullComp.maxGroups);
    const currentIdx = compInfo.phase ? phases.findIndex(p => p.id === compInfo.phase) : -1;
    const pilotGroup = pilotRow?.races?.[0]?.group ?? pilotRow?.quali?.kart ? (() => {
      const row = standings.rows.find(r => r.pilot === pilot);
      if (!row?.quali) return 1;
      const allQualis = standings.rows.map(r => r.quali).filter(Boolean) as { bestTime: number }[];
      allQualis.sort((a, b) => a.bestTime - b.bestTime);
      const pos = allQualis.findIndex(x => x.bestTime === row.quali!.bestTime);
      const pilotsPerGroup = Math.ceil(allQualis.length / fullComp.maxGroups);
      return Math.min(Math.floor(pos / pilotsPerGroup) + 1, fullComp.maxGroups);
    })() : 1;

    for (let i = currentIdx + 1; i < phases.length; i++) {
      const ph = phases[i];
      const gm = ph.id.match(/group_(\d+)/);
      const phaseGroup = gm ? parseInt(gm[1]) : 1;
      if (ph.id.startsWith('qualifying') || phaseGroup === pilotGroup) {
        const completedRaces = pilotRow?.races.filter(r => r != null).length ?? 0;
        const raceMatch = ph.id.match(/^race_(\d+)/);
        const startPos = raceMatch ? (() => {
          const raceIdx = parseInt(raceMatch[1]) - 1;
          const race = pilotRow?.races[raceIdx];
          return race?.startPos ?? null;
        })() : null;
        return {
          label: getPhaseShortLabel(compInfo.format!, ph.id, fullComp.maxGroups),
          startPos,
          sessionsUntil: i - currentIdx,
        };
      }
    }
    return null;
  }, [pilot, compInfo.format, compInfo.phase, fullComp, standings, pilotRow]);

  // ── Kart history for idle/no-entry state ──
  type KartHistoryEntry = { type: string; track: string; bestLap: string; bestS1: string | null; bestS2: string | null; time: string; pilot: string };
  const [kartHistory, setKartHistory] = useState<KartHistoryEntry[]>([]);

  useEffect(() => {
    if (lockMode !== 'kart' || kart == null) { setKartHistory([]); return; }
    if (isLive && entry) { setKartHistory([]); return; }
    let cancelled = false;

    const fetchKartHistory = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [sessRes, lapsRes] = await Promise.all([
          fetch(`${COLLECTOR_URL}/db/sessions?date=${today}`).then(r => r.ok ? r.json() : []),
          fetch(`${COLLECTOR_URL}/db/laps?kart=${kart}&from=${today}&to=${today}`).then(r => r.ok ? r.json() : []),
        ]);
        if (cancelled) return;

        const laps: { session_id: string; pilot: string; kart: number; lap_time: string | null; s1: string | null; s2: string | null }[] = lapsRes;
        const sessions: { id: string; track_id: number; is_race: number; competition_phase?: string | null; competition_format?: string | null; start_time: number }[] = sessRes;

        const sessionMap = new Map(sessions.map(s => [s.id, s]));
        const lapsBySession = new Map<string, typeof laps>();
        for (const l of laps) {
          if (!lapsBySession.has(l.session_id)) lapsBySession.set(l.session_id, []);
          lapsBySession.get(l.session_id)!.push(l);
        }

        const history: KartHistoryEntry[] = [];
        const sortedSessionIds = [...lapsBySession.keys()]
          .filter(id => sessionMap.has(id))
          .sort((a, b) => (sessionMap.get(b)?.start_time ?? 0) - (sessionMap.get(a)?.start_time ?? 0));

        for (const sid of sortedSessionIds.slice(0, 5)) {
          const sess = sessionMap.get(sid)!;
          const sLaps = lapsBySession.get(sid)!;
          let bestLap: number | null = null, bestS1: number | null = null, bestS2: number | null = null;
          let bestLapStr = '—';
          let bestPilot = '';
          for (const l of sLaps) {
            const t = parseTime(l.lap_time);
            if (t !== null && t >= 30 && (bestLap === null || t < bestLap)) { bestLap = t; bestLapStr = toSeconds(l.lap_time!); bestPilot = l.pilot; }
            const s1 = parseTime(l.s1);
            if (s1 !== null && s1 >= 10 && (bestS1 === null || s1 < bestS1)) bestS1 = s1;
            const s2 = parseTime(l.s2);
            if (s2 !== null && s2 >= 10 && (bestS2 === null || s2 < bestS2)) bestS2 = s2;
          }

          let typeLabel = 'Прокат';
          if (sess.competition_phase?.startsWith('qualifying')) typeLabel = 'Квала';
          else if (sess.competition_phase?.startsWith('race_') || sess.competition_phase?.startsWith('round_') || sess.competition_phase?.startsWith('final_')) typeLabel = 'Гонка';

          const d = new Date(sess.start_time);
          const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

          history.push({
            type: typeLabel,
            track: trackDisplayId(sess.track_id),
            bestLap: bestLapStr,
            bestS1: bestS1 !== null ? bestS1.toFixed(2) : null,
            bestS2: bestS2 !== null ? bestS2.toFixed(2) : null,
            time: timeStr,
            pilot: bestPilot,
          });
        }
        if (!cancelled) setKartHistory(history);
      } catch { if (!cancelled) setKartHistory([]); }
    };

    fetchKartHistory();
    return () => { cancelled = true; };
  }, [lockMode, kart, isLive, entry]);

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

  // Sector diffs: diff to best S1/S2 in session (or best on kart for Gonzales)
  const sectorDiffs = useMemo(() => {
    if (!entry) return { s1: null, s2: null, lap: null };
    const myS1 = parseTime(entry.bestS1);
    const myS2 = parseTime(entry.bestS2);
    const myBest = parseTime(entry.bestLap);

    // In Gonzales mode, compare against overall best on this kart across all rounds
    if (effectiveMode === 'gonzales' && gonzalesKartBest.bestLap !== null) {
      const diffFor = (my: number | null, kartBest: number | null) => {
        if (my === null || kartBest === null) return null;
        if (Math.abs(my - kartBest) < 0.001) return null;
        return my - kartBest;
      };
      return {
        s1: diffFor(myS1, gonzalesKartBest.bestS1),
        s2: diffFor(myS2, gonzalesKartBest.bestS2),
        lap: diffFor(myBest, gonzalesKartBest.bestLap),
      };
    }

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
  }, [entry, entries, effectiveMode, gonzalesKartBest]);

  const personalDiffs = useMemo(() => {
    if (!entry) return { s1: null, s2: null, lap: null };
    const curLap = parseTime(entry.lastLap);
    const curS1 = parseTime(entry.s1);
    const curS2 = parseTime(entry.s2);
    const myBestLap = parseTime(entry.bestLap);
    const myBestS1 = parseTime(entry.bestS1);
    const myBestS2 = parseTime(entry.bestS2);

    const diff = (cur: number | null, best: number | null) =>
      cur !== null && best !== null ? cur - best : null;

    return {
      lap: diff(curLap, myBestLap),
      s1: diff(curS1, myBestS1),
      s2: diff(curS2, myBestS2),
    };
  }, [entry]);

  return (
    <div className={embedded ? "w-full h-full bg-dark-950 flex flex-col select-none" : "fixed inset-0 bg-dark-950 flex flex-col z-50 select-none"}>
      {/* Top bar */}
      <div className="flex items-center px-3 py-2 bg-dark-900/90 border-b border-dark-800 shrink-0 gap-2">
        {/* Left: back/close + lock + session label + view */}
        {onClose ? (
          <button onClick={onClose} className="text-dark-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-dark-800 transition-colors shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <Link to="/" className="text-dark-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-dark-800 transition-colors shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        )}

        {sessionLabel && (
          <span className={`text-base font-semibold shrink-0 ${compInfo.competitionId ? 'text-purple-400' : 'text-dark-400'}`}>
            {sessionLabel}
          </span>
        )}

        {/* View toggles inline */}
        <div ref={viewRef} className="flex items-center gap-1.5 shrink-0 ml-1">
          <button onClick={() => setViewOpen(v => !v)}
            className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              viewOpen ? 'text-primary-400' : 'text-dark-500 hover:text-dark-300'
            }`}>
            Вид
          </button>
          {viewOpen && (
            <>
              <div className="flex items-center rounded overflow-hidden text-xs">
                <button onClick={() => setModeOverride('quali')}
                  className={`px-2.5 py-1.5 transition-colors ${effectiveMode === 'quali' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>
                  Квала
                </button>
                <button onClick={() => setModeOverride('race')}
                  className={`px-2.5 py-1.5 transition-colors ${effectiveMode === 'race' ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>
                  Гонка
                </button>
              </div>
              <Pill label="S" active={effectiveShowSectors} onClick={() => setShowSectors(v => !(v ?? defaults.sectors))} />
              <Pill label="Pos" active={effectiveShowPos} onClick={() => setShowPosition(v => !(v ?? defaults.position))} />
              {effectiveMode !== 'quali' && (
                <Pill label="Бали" active={effectiveShowPoints} onClick={() => setShowPoints(v => !(v ?? defaults.points))} />
              )}
            </>
          )}
        </div>

        <div className="flex-1" />

        {/* Right: pilot, kart, lap */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Pilot selector */}
          <div ref={pilotSelectorRef} className="relative">
            <button
              onClick={() => setPilotSelectorOpen(o => !o)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-bold transition-colors ${
                lockMode === 'pilot'
                  ? 'bg-purple-600/20 border border-purple-500/50 text-purple-300'
                  : 'bg-dark-800 border border-dark-700 text-dark-300 hover:text-white hover:border-purple-500'
              }`}
            >
              <span className="truncate max-w-[120px]">{pilot ? shortName(pilot) : '—'}</span>
              <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${pilotSelectorOpen ? 'rotate-180' : ''} ${lockMode === 'pilot' ? 'text-purple-400' : 'text-dark-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {pilotSelectorOpen && (
              <div className="absolute top-full right-0 mt-1 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1 z-50 min-w-[170px] max-h-64 overflow-y-auto">
                {pilotList.map(({ pilot: p, kart: k }) => (
                  <button key={p} onClick={() => goToPilot(p)}
                    className={`block w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      p === lockedPilot && lockMode === 'pilot' ? 'text-purple-400 bg-purple-500/10' : 'text-dark-300 hover:text-white hover:bg-dark-800'
                    }`}>
                    <span className="font-medium">{shortName(p)}</span>
                    {k != null ? <span className="text-dark-500 ml-2">К{k}</span> : <span className="text-dark-700 ml-2">—</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Kart selector */}
          <div ref={selectorRef} className="relative">
            <button
              onClick={() => setSelectorOpen(o => !o)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-bold transition-colors ${
                lockMode === 'kart'
                  ? 'bg-primary-600/20 border border-primary-500/50 text-white'
                  : 'bg-dark-800 border border-dark-700 text-dark-300 hover:text-white hover:border-primary-500'
              }`}
            >
              <span className="text-xl">{kart ?? '—'}</span>
              <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${selectorOpen ? 'rotate-180' : ''} ${lockMode === 'kart' ? 'text-primary-400' : 'text-dark-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {selectorOpen && (
              <div className="absolute top-full right-0 mt-1 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1 z-50 min-w-[170px] max-h-64 overflow-y-auto">
                {kartList.map(({ kart: k, pilot: p }) => (
                  <button key={k} onClick={() => goToKart(k)}
                    className={`block w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      k === kart && lockMode === 'kart' ? 'text-primary-400 bg-primary-500/10' : 'text-dark-300 hover:text-white hover:bg-dark-800'
                    }`}>
                    <span className="font-bold">{k}</span>
                    {p && <span className="text-dark-500 ml-2">{shortName(p)}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end shrink-0">
            {entry && (
              <span className="text-white font-mono font-bold" style={{ fontSize: 'clamp(1.5rem, 5vw, 2.5rem)' }}>
                L{entry.lapNumber}
              </span>
            )}
          </div>
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

        {/* Left column: position + standings */}
        {(entry || (effectiveMode === 'gonzales' && gonzalesData)) && (effectiveShowPos || effectiveShowPoints) && (
          <div className="absolute top-2 left-2 z-10 flex flex-col gap-1" style={{ maxHeight: 'calc(100% - 0.5rem)' }}>
            {/* Position leaderboard */}
            {effectiveShowPos && positionLeaderboard && (() => {
              const renderRow = (item: PosEntry) => {
                const isMe = item.pilot === positionLeaderboard.myPilot;
                const name = shortName(item.pilot);
                const clipped = name.length > 10 ? name.slice(0, 10) + '.' : name;
                return (
                  <div key={item.pilot} className={`flex items-center gap-1.5 leading-tight ${isMe ? 'text-yellow-300 font-bold' : 'text-white'}`}>
                    <span className={isMe ? 'text-lg' : ''} style={isMe ? { fontSize: 'clamp(1rem, 3vw, 1.4rem)' } : {}}>P{item.pos}</span>
                    {item.delta != null && item.delta !== 0 && (
                      <span className={`text-[0.7em] ${item.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {item.delta > 0 ? '\u25B2' : '\u25BC'}{Math.abs(item.delta)}
                      </span>
                    )}
                    <span className="inline-block w-[10.5ch] truncate">{clipped}</span>
                    {item.bestTime != null && (
                      <span className="ml-auto tabular-nums font-bold text-[1.35em] text-white">
                        {toSeconds(item.bestTime)}
                      </span>
                    )}
                    {item.gapToNext != null && (
                      <span className={`${item.bestTime == null ? 'ml-auto' : ''} tabular-nums font-bold text-[1.35em] ${item.gapToNext < 0 ? 'text-green-400' : 'text-white'}`}>
                        {item.gapToNext > 0 ? '+' : item.gapToNext < 0 ? '\u2212' : ''}{Math.abs(item.gapToNext).toFixed(2)}
                      </span>
                    )}
                  </div>
                );
              };
              return (
                <div className="font-mono bg-dark-900/80 border border-dark-700 rounded-lg px-2.5 py-1.5"
                     style={{ fontSize: 'clamp(0.75rem, 2.2vw, 1rem)' }}>
                  {effectiveShowTime && (timeGroupData?.pos != null || timeGlobalData?.pos != null) && (
                    <div className="flex items-center gap-4 mb-1.5 pb-1.5 border-b border-dark-700" style={{ fontSize: 'clamp(1rem, 3vw, 1.4rem)' }}>
                      {timeGroupData?.pos != null && (
                        <span className="text-white font-bold">T={timeGroupData.pos}/{timeGroupData.total}</span>
                      )}
                      {timeGlobalData?.pos != null && (
                        <span className="text-white font-semibold">T={timeGlobalData.pos}/{timeGlobalData.total}</span>
                      )}
                    </div>
                  )}
                  {positionLeaderboard.top.map(renderRow)}
                  {positionLeaderboard.hasEllipsis && (
                    <div className="text-dark-600 text-center leading-none py-px text-[0.7em]">···</div>
                  )}
                  {positionLeaderboard.around.map(renderRow)}
                </div>
              );
            })()}

            <div className="flex-1" />

            {/* Standings */}
            {effectiveShowPoints && standingsLeaderboard && (
              <div className="font-mono bg-dark-900/80 border border-dark-700 rounded-lg px-2.5 py-1.5"
                   style={{ fontSize: 'clamp(0.75rem, 2.2vw, 1rem)' }}>
                {standingsLeaderboard.items.map((item) => {
                  const isMe = item.pilot === standingsLeaderboard.myPilot;
                  const name = shortName(item.pilot);
                  const clipped = name.length > 10 ? name.slice(0, 10) + '.' : name;
                  const isGonzalesMode = effectiveMode === 'gonzales';

                  if (isGonzalesMode) {
                    return (
                      <div key={item.pilot} className={`flex items-center leading-tight ${isMe ? 'text-yellow-300 font-bold' : 'text-white'}`}>
                        <span className="w-5 text-right tabular-nums shrink-0">{item.pos}</span>
                        <span className="ml-1.5 inline-block w-[10.5ch] truncate">{clipped}</span>
                        <span className={`ml-auto pl-3 font-bold text-[1.35em] tabular-nums text-right ${isMe ? 'text-yellow-300' : 'text-white'}`}>
                          {item.pts.toFixed(2)}
                        </span>
                      </div>
                    );
                  }

                  const diff = Math.round((item.pts - standingsLeaderboard.myPts) * 10) / 10;
                  const diffColor = (d: number) => {
                    if (d <= -10) return 'text-green-400';
                    if (d <= -5)  return 'text-green-400/80';
                    if (d <= -2)  return 'text-lime-400';
                    if (d < 0)    return 'text-yellow-400';
                    if (d < 2)    return 'text-red-300/60';
                    if (d < 5)    return 'text-red-400/80';
                    if (d < 10)   return 'text-red-500';
                    return 'text-red-700';
                  };
                  return (
                    <div key={item.pilot} className={`flex items-center leading-tight ${isMe ? 'text-yellow-300 font-bold' : 'text-white'}`}>
                      <span className="w-5 text-right tabular-nums shrink-0">{item.pos}</span>
                      <span className="ml-1.5 inline-block w-[10.5ch] truncate">{clipped}</span>
                      {isMe ? (
                        <span className="ml-auto pl-3 text-yellow-300 font-bold text-[1.35em] tabular-nums text-right w-[5ch]">{item.pts}</span>
                      ) : (
                        <span className={`ml-auto pl-3 font-bold text-[1.35em] tabular-nums text-right w-[5ch] ${diffColor(diff)}`}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!isLive ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 max-h-full overflow-auto">
            {lockMode === 'kart' && kart != null && (
              <p className="text-white text-2xl font-bold">Карт {kart}</p>
            )}
            <p className="text-dark-400 text-lg">
              {nextSessionLabel ? `Очікування: ${nextSessionLabel}` : 'Очікування заїзду...'}
            </p>
            {lockMode === 'pilot' && pilot && pilotHistory.length > 0 && (
              <div className="w-full max-w-sm">
                <table className="w-full text-xs font-mono">
                  <tbody>
                    {pilotHistory.map((h, i) => (
                      <tr key={i} className="border-b border-dark-800/50">
                        <td className="py-1 text-dark-400 pr-2">{h.label}</td>
                        <td className="py-1 text-dark-500 pr-2">К{h.kart}</td>
                        <td className="py-1 text-green-400 pr-2">{h.bestTime}</td>
                        <td className="py-1 text-blue-400">{h.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pilotNextSession && (
                  <div className="mt-2 text-xs text-dark-400 border-t border-dark-800/50 pt-2">
                    Далі: <span className="text-white">{pilotNextSession.label}</span>
                    {pilotNextSession.startPos != null && <span className="text-blue-400 ml-1">P{pilotNextSession.startPos}</span>}
                    {pilotNextSession.sessionsUntil > 1 && <span className="text-dark-600 ml-1">(через {pilotNextSession.sessionsUntil - 1} заїзд{pilotNextSession.sessionsUntil - 1 > 1 ? 'и' : ''})</span>}
                  </div>
                )}
              </div>
            )}
            {lockMode === 'kart' && kart != null && kartHistory.length > 0 && (
              <div className="w-full max-w-md">
                <p className="text-dark-500 text-xs uppercase mb-2">Останні заїзди</p>
                <table className="w-full text-sm font-mono">
                  <tbody>
                    {kartHistory.map((h, i) => (
                      <tr key={i} className="border-b border-dark-800/50">
                        <td className="py-1.5 text-dark-400 pr-2 whitespace-nowrap">{h.time}</td>
                        <td className="py-1.5 text-white pr-2 whitespace-nowrap">{h.type}</td>
                        <td className="py-1.5 text-dark-400 pr-2 whitespace-nowrap">Тр{h.track}</td>
                        <td className="py-1.5 text-yellow-300 font-bold pr-2 whitespace-nowrap">{h.bestLap}</td>
                        <td className="py-1.5 text-yellow-300/70 whitespace-nowrap">{h.bestS1 ?? '—'}, {h.bestS2 ?? '—'}</td>
                        <td className="py-1.5 text-dark-400 pl-2 truncate max-w-[80px]">{shortName(h.pilot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : !entry ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 max-h-full overflow-auto">
            {lockMode === 'kart' && kart != null && (
              <p className="text-white text-2xl font-bold">Карт {kart}</p>
            )}
            <p className="text-dark-400 text-lg">Не бере участі в цьому заїзді</p>
            {lockMode === 'pilot' && pilot && pilotHistory.length > 0 && (
              <div className="w-full max-w-sm mt-2">
                <table className="w-full text-xs font-mono">
                  <tbody>
                    {pilotHistory.map((h, i) => (
                      <tr key={i} className="border-b border-dark-800/50">
                        <td className="py-1 text-dark-400 pr-2">{h.label}</td>
                        <td className="py-1 text-dark-500 pr-2">К{h.kart}</td>
                        <td className="py-1 text-green-400 pr-2">{h.bestTime}</td>
                        <td className="py-1 text-blue-400">{h.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pilotNextSession && (
                  <div className="mt-2 text-xs text-dark-400 border-t border-dark-800/50 pt-2">
                    Далі: <span className="text-white">{pilotNextSession.label}</span>
                    {pilotNextSession.startPos != null && <span className="text-blue-400 ml-1">P{pilotNextSession.startPos}</span>}
                    {pilotNextSession.sessionsUntil > 1 && <span className="text-dark-600 ml-1">(через {pilotNextSession.sessionsUntil - 1} заїзд{pilotNextSession.sessionsUntil - 1 > 1 ? 'и' : ''})</span>}
                  </div>
                )}
              </div>
            )}
            {lockMode === 'kart' && kart != null && kartHistory.length > 0 && (
              <div className="w-full max-w-md mt-2">
                <p className="text-dark-500 text-xs uppercase mb-2">Останні заїзди</p>
                <table className="w-full text-sm font-mono">
                  <tbody>
                    {kartHistory.map((h, i) => (
                      <tr key={i} className="border-b border-dark-800/50">
                        <td className="py-1.5 text-dark-400 pr-2 whitespace-nowrap">{h.time}</td>
                        <td className="py-1.5 text-white pr-2 whitespace-nowrap">{h.type}</td>
                        <td className="py-1.5 text-dark-400 pr-2 whitespace-nowrap">Тр{h.track}</td>
                        <td className="py-1.5 text-yellow-300 font-bold pr-2 whitespace-nowrap">{h.bestLap}</td>
                        <td className="py-1.5 text-yellow-300/70 whitespace-nowrap">{h.bestS1 ?? '—'}, {h.bestS2 ?? '—'}</td>
                        <td className="py-1.5 text-dark-400 pl-2 truncate max-w-[80px]">{shortName(h.pilot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className={`w-full h-full flex items-center pl-4 ${
            effectiveShowPos || effectiveShowPoints ? 'justify-end pr-8' : 'justify-center'
          }`}>
            <div className="flex flex-col justify-center items-center mt-2">
              <div className={`font-mono font-bold leading-none ${COLOR_CLASSES[lapColor]}`}
                   style={{ fontSize: 'clamp(4rem, 15vw, 10rem)' }}>
                {entry.lastLap ? toSeconds(entry.lastLap) : '\u2014'}
              </div>

              {(personalDiffs.lap != null || sectorDiffs.lap != null) && (
                <div className="flex items-center gap-6 mb-2" style={{ fontSize: 'clamp(1.4rem, 4vw, 2.4rem)' }}>
                  {personalDiffs.lap != null && (
                    <span className={`font-mono font-bold ${personalDiffs.lap <= 0.001 ? 'text-green-400' : 'text-yellow-400/80'}`}>
                      {personalDiffs.lap <= 0.001 ? '\u2212' : '+'}{Math.abs(personalDiffs.lap).toFixed(3)}
                    </span>
                  )}
                  {sectorDiffs.lap != null && (
                    <span className={`font-mono font-bold ${sectorDiffs.lap <= 0 ? 'text-purple-400' : 'text-red-400/70'}`}>
                      {sectorDiffs.lap <= 0 ? '\u2212' : '+'}{Math.abs(sectorDiffs.lap).toFixed(3)}
                    </span>
                  )}
                </div>
              )}

              {effectiveShowSectors && (
              <div className="flex items-center justify-center gap-8 mt-2">
                <div className="flex flex-col items-center">
                  <div className={`font-mono font-bold ${COLOR_CLASSES[s1Color]}`}
                       style={{ fontSize: 'clamp(1.8rem, 6vw, 4rem)' }}>
                    {entry.s1 && (parseTime(entry.s1) ?? 0) >= 10 ? toSeconds(entry.s1) : '\u2014'}
                  </div>
                  {(personalDiffs.s1 != null || sectorDiffs.s1 != null) && (
                    <div className="flex items-center gap-3" style={{ fontSize: 'clamp(1.1rem, 3.5vw, 1.7rem)' }}>
                      {personalDiffs.s1 != null && (
                        <span className={`font-mono ${personalDiffs.s1 <= 0.001 ? 'text-green-400' : 'text-yellow-400/80'}`}>
                          {personalDiffs.s1 <= 0.001 ? '\u2212' : '+'}{Math.abs(personalDiffs.s1).toFixed(2)}
                        </span>
                      )}
                      {sectorDiffs.s1 != null && (
                        <span className={`font-mono ${sectorDiffs.s1 <= 0 ? 'text-purple-400' : 'text-red-400/70'}`}>
                          {sectorDiffs.s1 <= 0 ? '\u2212' : '+'}{Math.abs(sectorDiffs.s1).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="w-px h-10 bg-dark-800" />
                <div className="flex flex-col items-center">
                  <div className={`font-mono font-bold ${COLOR_CLASSES[s2Color]}`}
                       style={{ fontSize: 'clamp(1.8rem, 6vw, 4rem)' }}>
                    {entry.s2 && (parseTime(entry.s2) ?? 0) >= 10 ? toSeconds(entry.s2) : '\u2014'}
                  </div>
                  {(personalDiffs.s2 != null || sectorDiffs.s2 != null) && (
                    <div className="flex items-center gap-3" style={{ fontSize: 'clamp(1.1rem, 3.5vw, 1.7rem)' }}>
                      {personalDiffs.s2 != null && (
                        <span className={`font-mono ${personalDiffs.s2 <= 0.001 ? 'text-green-400' : 'text-yellow-400/80'}`}>
                          {personalDiffs.s2 <= 0.001 ? '\u2212' : '+'}{Math.abs(personalDiffs.s2).toFixed(2)}
                        </span>
                      )}
                      {sectorDiffs.s2 != null && (
                        <span className={`font-mono ${sectorDiffs.s2 <= 0 ? 'text-purple-400' : 'text-red-400/70'}`}>
                          {sectorDiffs.s2 <= 0 ? '\u2212' : '+'}{Math.abs(sectorDiffs.s2).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
          </div>
        )}

      </div>

    </div>
  );
}
