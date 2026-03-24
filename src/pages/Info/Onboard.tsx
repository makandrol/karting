import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTimingPoller } from '../../services/timingPoller';
import { parseTime, toSeconds, getTimeColor, COLOR_CLASSES } from '../../utils/timing';

export default function Onboard() {
  const { kartId } = useParams<{ kartId: string }>();
  const navigate = useNavigate();
  const { entries, mode } = useTimingPoller({ interval: 1000 });
  const [locked, setLocked] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

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

  // Close selector on outside click
  useEffect(() => {
    if (!selectorOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) setSelectorOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [selectorOpen]);

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
  const bestLapColor = entry ? getTimeColor(entry.bestLap, entry.bestLap, overallBestLap) : 'none';

  const isLive = mode === 'live' && entries.length > 0;

  return (
    <div className="fixed inset-0 bg-dark-950 flex flex-col z-50 select-none">
      {/* Top bar */}
      <div className="flex items-center px-3 py-2 bg-dark-900/90 border-b border-dark-800 shrink-0 gap-2">
        <Link to="/" className="text-dark-400 hover:text-white text-xs font-medium px-2 py-1 rounded-lg hover:bg-dark-800 transition-colors shrink-0">
          ← Таймінг
        </Link>

        {/* Kart number button + dropdown */}
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
            <div className="absolute top-full left-0 mt-1 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl py-1 z-50 min-w-[140px] max-h-64 overflow-y-auto">
              {allKarts.map(k => {
                const en = entries.find(e => e.kart === k);
                return (
                  <button
                    key={k}
                    onClick={() => goToKart(k)}
                    className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                      k === kart ? 'text-primary-400 bg-primary-500/10' : 'text-dark-300 hover:text-white hover:bg-dark-800'
                    }`}
                  >
                    <span className="font-bold">{k}</span>
                    {en && <span className="text-dark-500 ml-2">{en.pilot}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Lock orientation */}
        <button
          onClick={() => setLocked(l => !l)}
          className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            locked ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
          }`}
        >
          {locked ? '🔒' : '🔓'}
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-dark-600'}`} />
          <span className={`text-xs ${isLive ? 'text-green-400' : 'text-dark-500'}`}>
            {isLive ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Prev kart */}
        {prevKart !== null && (
          <button
            onClick={() => goToKart(prevKart)}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-12 h-24 flex items-center justify-center text-dark-600 hover:text-white active:text-primary-400 transition-colors z-10"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Next kart */}
        {nextKart !== null && (
          <button
            onClick={() => goToKart(nextKart)}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-12 h-24 flex items-center justify-center text-dark-600 hover:text-white active:text-primary-400 transition-colors z-10"
          >
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
            <p className="text-dark-600 text-sm">Не на трасі</p>
          </div>
        ) : (
          <div className="text-center px-16">
            {/* Position + Lap */}
            <div className="text-dark-500 text-sm mb-2 font-mono tracking-wide">
              P{entry.position} · L{entry.lapNumber}
            </div>

            {/* Last lap */}
            <div className={`font-mono font-bold leading-none mb-4 ${COLOR_CLASSES[lapColor]}`}
                 style={{ fontSize: 'clamp(4rem, 15vw, 10rem)' }}>
              {entry.lastLap ? toSeconds(entry.lastLap) : '—'}
            </div>

            {/* S1 / S2 */}
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

            {/* Best lap */}
            <div className={`mt-5 font-mono font-semibold text-lg ${COLOR_CLASSES[bestLapColor]}`}>
              {entry.bestLap ? toSeconds(entry.bestLap) : '—'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
