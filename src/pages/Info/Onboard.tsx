import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTimingPoller } from '../../services/timingPoller';
import { COLLECTOR_URL } from '../../services/config';
import { parseTime, toSeconds, getTimeColor, COLOR_CLASSES } from '../../utils/timing';
import { COMPETITION_CONFIGS, getPhaseShortLabel } from '../../data/competitions';

interface CompSessionInfo {
  competitionId: string | null;
  format: string | null;
  phase: string | null;
}

interface CompData {
  sessions: { sessionId: string; phase: string }[];
}

function getRelatedPhases(phase: string): (p: string) => boolean {
  if (phase.startsWith('qualifying')) return p => p.startsWith('qualifying');
  const raceMatch = phase.match(/^(race_\d+)_/);
  if (raceMatch) {
    const prefix = raceMatch[1];
    return p => p.startsWith(prefix + '_');
  }
  return p => p === phase;
}

export default function Onboard() {
  const { kartId } = useParams<{ kartId: string }>();
  const navigate = useNavigate();
  const { entries, mode, collectorStatus } = useTimingPoller({ interval: 1000 });
  const [locked, setLocked] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [showSectors, setShowSectors] = useState(true);
  const viewRef = useRef<HTMLDivElement>(null);

  const sessionId = (collectorStatus as any)?.sessionId || null;

  const kart = kartId ? parseInt(kartId, 10) : null;
  const entry = kart !== null ? entries.find(e => e.kart === kart) : null;
  const allKarts = entries.map(e => e.kart).sort((a, b) => a - b);

  const goToKart = useCallback((k: number) => {
    navigate(`/onboard/${k}`, { replace: true });
    setSelectorOpen(false);
  }, [navigate]);

  const kartIdx = kart !== null ? allKarts.indexOf(kart) : -1;
  const prevKart = kartIdx > 0 ? allKarts[kartIdx - 1] : (allKarts.length > 0 ? allKarts[allKarts.length - 1] : null);
  const nextKart = kartIdx >= 0 && kartIdx < allKarts.length - 1 ? allKarts[kartIdx + 1] : (allKarts.length > 0 ? allKarts[0] : null);

  useEffect(() => {
    if (!kartId && allKarts.length > 0) goToKart(allKarts[0]);
  }, [kartId, allKarts.length > 0]);

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

  // ── Competition position tracking ──

  const [compInfo, setCompInfo] = useState<CompSessionInfo>({ competitionId: null, format: null, phase: null });
  const [compRanking, setCompRanking] = useState<{ pilot: string; bestLap: number }[]>([]);
  const [raceNumber, setRaceNumber] = useState<number | null>(null);

  // Fetch competition info + race number for current session
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

  // Fetch laps from all related sessions + build ranking
  useEffect(() => {
    if (!compInfo.competitionId || !compInfo.phase) { setCompRanking([]); return; }
    let active = true;

    (async () => {
      try {
        const compRes = await fetch(`${COLLECTOR_URL}/competitions/${compInfo.competitionId}`);
        const comp: CompData = await compRes.json();
        const sessions = typeof comp.sessions === 'string' ? JSON.parse(comp.sessions) : comp.sessions;

        const isRelated = getRelatedPhases(compInfo.phase!);
        const relatedSessionIds = sessions
          .filter((s: any) => isRelated(s.phase))
          .map((s: any) => s.sessionId);

        const allLaps: { pilot: string; lap_time: string }[] = [];
        for (const sid of relatedSessionIds) {
          const laps = await fetch(`${COLLECTOR_URL}/db/laps?session=${sid}`).then(r => r.json()).catch(() => []);
          allLaps.push(...laps);
        }
        // Also include current live entries best laps
        const pilotBests = new Map<string, number>();
        for (const l of allLaps) {
          if (!l.lap_time) continue;
          const sec = parseTime(l.lap_time);
          if (sec === null || sec < 38) continue;
          const prev = pilotBests.get(l.pilot);
          if (prev === undefined || sec < prev) pilotBests.set(l.pilot, sec);
        }
        // Merge with live entries (current session, might not be in DB yet)
        for (const e of entries) {
          const sec = parseTime(e.bestLap);
          if (sec === null || sec < 38) continue;
          const prev = pilotBests.get(e.pilot);
          if (prev === undefined || sec < prev) pilotBests.set(e.pilot, sec);
        }

        if (!active) return;
        const ranked = [...pilotBests.entries()]
          .map(([pilot, bestLap]) => ({ pilot, bestLap }))
          .sort((a, b) => a.bestLap - b.bestLap);
        setCompRanking(ranked);
      } catch {
        if (active) setCompRanking([]);
      }
    })();

    const timer = setInterval(() => {
      // Re-fetch periodically
      fetch(`${COLLECTOR_URL}/competitions/${compInfo.competitionId}`)
        .then(r => r.json())
        .then(async (comp: CompData) => {
          const sessions = typeof comp.sessions === 'string' ? JSON.parse(comp.sessions) : comp.sessions;
          const isRelated = getRelatedPhases(compInfo.phase!);
          const relatedSessionIds = sessions.filter((s: any) => isRelated(s.phase)).map((s: any) => s.sessionId);

          const allLaps: { pilot: string; lap_time: string }[] = [];
          for (const sid of relatedSessionIds) {
            const laps = await fetch(`${COLLECTOR_URL}/db/laps?session=${sid}`).then(r => r.json()).catch(() => []);
            allLaps.push(...laps);
          }
          const pilotBests = new Map<string, number>();
          for (const l of allLaps) {
            if (!l.lap_time) continue;
            const sec = parseTime(l.lap_time);
            if (sec === null || sec < 38) continue;
            const prev = pilotBests.get(l.pilot);
            if (prev === undefined || sec < prev) pilotBests.set(l.pilot, sec);
          }
          for (const e of entries) {
            const sec = parseTime(e.bestLap);
            if (sec === null || sec < 38) continue;
            const prev = pilotBests.get(e.pilot);
            if (prev === undefined || sec < prev) pilotBests.set(e.pilot, sec);
          }
          setCompRanking([...pilotBests.entries()].map(([pilot, bestLap]) => ({ pilot, bestLap })).sort((a, b) => a.bestLap - b.bestLap));
        })
        .catch(() => {});
    }, 5000);

    return () => { active = false; clearInterval(timer); };
  }, [compInfo.competitionId, compInfo.phase, entries]);

  // Compute position string for current pilot
  const positionDisplay = useMemo(() => {
    if (!entry) return null;
    const pilot = entry.pilot;

    if (compInfo.competitionId && compRanking.length > 0) {
      const idx = compRanking.findIndex(r => r.pilot === pilot);
      const pos = idx >= 0 ? idx + 1 : null;
      const total = compRanking.length;
      return pos ? `${pos}/${total}` : `—/${total}`;
    }

    // No competition — position in current session by best lap
    const withBest = entries
      .map(e => ({ pilot: e.pilot, best: parseTime(e.bestLap) }))
      .filter(e => e.best !== null && e.best >= 38) as { pilot: string; best: number }[];
    withBest.sort((a, b) => a.best - b.best);
    const idx = withBest.findIndex(e => e.pilot === pilot);
    return idx >= 0 ? String(idx + 1) : '—';
  }, [entry, entries, compInfo.competitionId, compRanking]);

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

  const isLive = mode === 'live' && entries.length > 0;

  return (
    <div className="fixed inset-0 bg-dark-950 flex flex-col z-50 select-none">
      {/* Top bar */}
      <div className="flex items-center px-3 py-2 bg-dark-900/90 border-b border-dark-800 shrink-0 gap-2">
        <Link to="/" className="text-dark-400 hover:text-white px-1.5 py-1 rounded-lg hover:bg-dark-800 transition-colors shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

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
              {allKarts.map(k => {
                const en = entries.find(e => e.kart === k);
                return (
                  <button key={k} onClick={() => goToKart(k)}
                    className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                      k === kart ? 'text-primary-400 bg-primary-500/10' : 'text-dark-300 hover:text-white hover:bg-dark-800'
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
          <div className="w-full h-full flex px-16">
            {/* Left: position + lap */}
            <div className="flex flex-col justify-center items-start shrink-0 mr-6">
              <div className="font-mono font-bold text-white leading-none"
                   style={{ fontSize: 'clamp(2.5rem, 8vw, 5rem)' }}>
                {positionDisplay}
              </div>
              <div className="text-dark-500 font-mono mt-1"
                   style={{ fontSize: 'clamp(1rem, 3vw, 1.5rem)' }}>
                L{entry.lapNumber}
              </div>
            </div>

            {/* Center: lap time + sectors */}
            <div className="flex-1 flex flex-col justify-center items-center">
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

      {/* View toggle — bottom left */}
      <div ref={viewRef} className="absolute bottom-3 left-3 z-20">
        <button onClick={() => setViewOpen(v => !v)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-medium transition-colors ${
            viewOpen ? 'border-primary-500 text-primary-400' : 'border-dark-700 bg-dark-900/80 text-dark-500 hover:text-dark-300'
          }`}>
          <span>Вид:</span>
          {viewOpen && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowSectors(v => !v); }}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                showSectors ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'
              }`}>
              Сект.
            </button>
          )}
        </button>
      </div>
    </div>
  );
}
