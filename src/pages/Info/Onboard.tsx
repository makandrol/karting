import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTimingPoller } from '../../services/timingPoller';
import { parseTime, toSeconds, getTimeColor, COLOR_CLASSES } from '../../utils/timing';
import type { TimingEntry } from '../../types';

export default function Onboard() {
  const { kartId } = useParams<{ kartId: string }>();
  const navigate = useNavigate();
  const { entries, mode } = useTimingPoller({ interval: 1000 });
  const [locked, setLocked] = useState(false);

  const kart = kartId ? parseInt(kartId, 10) : null;
  const entry = kart !== null ? entries.find(e => e.kart === kart) : null;

  const allKarts = entries.map(e => e.kart).sort((a, b) => a - b);

  const goToKart = useCallback((k: number) => navigate(`/onboard/${k}`, { replace: true }), [navigate]);

  const prevKart = kart !== null && allKarts.length > 0
    ? allKarts[allKarts.indexOf(kart) - 1] ?? allKarts[allKarts.length - 1]
    : null;
  const nextKart = kart !== null && allKarts.length > 0
    ? allKarts[allKarts.indexOf(kart) + 1] ?? allKarts[0]
    : null;

  // Auto-select first kart if none selected
  useEffect(() => {
    if (!kartId && allKarts.length > 0) goToKart(allKarts[0]);
  }, [kartId, allKarts.length > 0]);

  // Orientation lock
  useEffect(() => {
    if (!locked) return;
    try { (screen.orientation as any).lock?.('landscape').catch(() => {}); }
    catch { /* not supported */ }
    return () => { try { screen.orientation.unlock(); } catch { /* */ } };
  }, [locked]);

  // Overall bests for color coding
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
      <div className="flex items-center justify-between px-3 py-2 bg-dark-900/90 border-b border-dark-800 shrink-0">
        <Link to="/" className="text-dark-400 hover:text-white text-xs font-medium px-2 py-1 rounded-lg hover:bg-dark-800 transition-colors">
          ← Таймінг
        </Link>

        <div className="flex items-center gap-2">
          {/* Kart selector dropdown */}
          <select
            value={kart ?? ''}
            onChange={e => goToKart(parseInt(e.target.value))}
            className="bg-dark-800 border border-dark-700 text-white text-sm font-bold rounded-lg px-3 py-1.5 outline-none focus:border-primary-500"
          >
            {allKarts.length === 0 && <option value="">—</option>}
            {allKarts.map(k => {
              const e = entries.find(en => en.kart === k);
              return <option key={k} value={k}>Карт {k}{e ? ` · ${e.pilot}` : ''}</option>;
            })}
          </select>

          {/* Lock orientation */}
          <button
            onClick={() => setLocked(l => !l)}
            className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              locked ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
            }`}
            title="Залочити горизонтальний режим"
          >
            {locked ? '🔒' : '🔓'}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-400 animate-pulse' : 'bg-dark-600'}`} />
          <span className={`text-xs ${isLive ? 'text-green-400' : 'text-dark-500'}`}>
            {isLive ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {/* Prev kart button */}
        {prevKart !== null && (
          <button
            onClick={() => goToKart(prevKart)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-20 flex items-center justify-center text-dark-600 hover:text-white active:text-primary-400 transition-colors z-10"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Next kart button */}
        {nextKart !== null && (
          <button
            onClick={() => goToKart(nextKart)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-20 flex items-center justify-center text-dark-600 hover:text-white active:text-primary-400 transition-colors z-10"
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {!isLive ? (
          <div className="text-center">
            <div className="text-5xl mb-3 opacity-40">🏎️</div>
            <p className="text-dark-500 text-sm">Очікування заїзду...</p>
          </div>
        ) : !entry ? (
          <div className="text-center">
            <div className="text-dark-500 text-lg mb-1">Карт {kart}</div>
            <p className="text-dark-600 text-sm">Не на трасі</p>
          </div>
        ) : (
          <div className="text-center px-16">
            {/* Pilot name */}
            <div className="text-dark-400 text-sm mb-1 tracking-wide">
              {entry.pilot} · Карт {entry.kart} · P{entry.position} · Коло {entry.lapNumber}
            </div>

            {/* Last lap — main display */}
            <div className={`font-mono font-bold leading-none mb-4 ${COLOR_CLASSES[lapColor]}`}
                 style={{ fontSize: 'clamp(4rem, 15vw, 10rem)' }}>
              {entry.lastLap ? toSeconds(entry.lastLap) : '—'}
            </div>

            {/* S1 / S2 */}
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-dark-600 text-[10px] uppercase tracking-wider mb-0.5">S1</div>
                <div className={`font-mono font-bold ${COLOR_CLASSES[s1Color]}`}
                     style={{ fontSize: 'clamp(1.5rem, 5vw, 3.5rem)' }}>
                  {entry.s1 && (parseTime(entry.s1) ?? 0) >= 10 ? toSeconds(entry.s1) : '—'}
                </div>
              </div>
              <div className="w-px h-10 bg-dark-800" />
              <div className="text-center">
                <div className="text-dark-600 text-[10px] uppercase tracking-wider mb-0.5">S2</div>
                <div className={`font-mono font-bold ${COLOR_CLASSES[s2Color]}`}
                     style={{ fontSize: 'clamp(1.5rem, 5vw, 3.5rem)' }}>
                  {entry.s2 && (parseTime(entry.s2) ?? 0) >= 10 ? toSeconds(entry.s2) : '—'}
                </div>
              </div>
            </div>

            {/* Best lap */}
            <div className="mt-5 flex items-center justify-center gap-2">
              <span className="text-dark-600 text-xs">Найкращий:</span>
              <span className={`font-mono font-semibold text-lg ${COLOR_CLASSES[bestLapColor]}`}>
                {entry.bestLap ? toSeconds(entry.bestLap) : '—'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
