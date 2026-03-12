import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { TimingEntry } from '../../types';
import type { TrackConfig } from '../../data/tracks';
import { TRACK_SVG_VIEWBOX } from '../../data/tracks';

interface TrackMapProps {
  track: TrackConfig;
  entries: TimingEntry[];
}

const POSITION_COLORS = [
  '#facc15', '#d1d5db', '#d97706', '#f87171', '#60a5fa',
  '#34d399', '#a78bfa', '#fb923c', '#f472b6', '#94a3b8',
];

function getPointOnPath(pathEl: SVGPathElement, progress: number): { x: number; y: number } {
  const len = pathEl.getTotalLength();
  const pt = pathEl.getPointAtLength(progress * len);
  return { x: pt.x, y: pt.y };
}

function pilotShort(name: string): string {
  return name.slice(0, 3);
}

interface KartPos {
  kart: number;
  pilot: string;
  current: number;   // поточний progress (анімований)
  target: number;    // цільовий progress (з даних)
  position: number;
}

export default function TrackMap({ track, entries }: TrackMapProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathReady, setPathReady] = useState(false);
  const positionsRef = useRef<KartPos[]>([]);
  const [rendered, setRendered] = useState<KartPos[]>([]);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const hasPath = track.svgPath.length > 0;

  // Оновити таргети коли приходять нові дані
  const targets = useMemo(() => {
    return entries
      .filter((e) => e.progress !== null && e.progress >= 0)
      .map((e) => ({
        kart: e.kart,
        pilot: e.pilot,
        progress: e.progress!,
        position: e.position,
      }));
  }, [entries]);

  useEffect(() => {
    const prev = positionsRef.current;
    positionsRef.current = targets.map((t) => {
      const existing = prev.find((p) => p.kart === t.kart);
      return {
        kart: t.kart,
        pilot: t.pilot,
        current: existing ? existing.current : t.progress,
        target: t.progress,
        position: t.position,
      };
    });
  }, [targets]);

  // 60fps animation loop
  const tick = useCallback((time: number) => {
    const dt = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 0.016;
    lastTimeRef.current = time;

    // Швидкість інтерполяції — чим більше, тим швидше наздоганяє таргет
    // 5.0 = наздоганяє за ~0.3с, плавно
    const speed = 5.0;
    const factor = 1 - Math.exp(-speed * dt);

    let changed = false;
    const positions = positionsRef.current;

    for (const p of positions) {
      let diff = p.target - p.current;

      // Wraparound через фініш (0→1)
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;

      const newCurrent = p.current + diff * factor;
      const normalized = ((newCurrent % 1) + 1) % 1;

      if (Math.abs(normalized - p.current) > 0.0001) {
        p.current = normalized;
        changed = true;
      }
    }

    if (changed) {
      setRendered([...positions]);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!hasPath || !pathReady) return;
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [hasPath, pathReady, tick]);

  // Path ready
  useEffect(() => {
    setPathReady(false);
    if (!hasPath) return;
    const t = setTimeout(() => {
      if (pathRef.current) setPathReady(true);
    }, 50);
    return () => clearTimeout(t);
  }, [track.id, hasPath]);

  return (
    <div className="card p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <span className="text-dark-400 text-xs font-medium">
          {track.name} — {track.length}
        </span>
        {!hasPath && (
          <span className="text-dark-600 text-xs">Шлях не налаштований</span>
        )}
      </div>

      <div className="relative">
        <img src={track.image} alt={track.name} className="w-full rounded-lg opacity-90" />

        {hasPath && (
          <svg
            viewBox={TRACK_SVG_VIEWBOX}
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }}
          >
            <path ref={pathRef} d={track.svgPath} fill="none" stroke="none" />

            {pathReady && pathRef.current && rendered.map((kp) => {
              const pt = getPointOnPath(pathRef.current!, kp.current);
              const color = POSITION_COLORS[Math.min(kp.position - 1, POSITION_COLORS.length - 1)];

              return (
                <g key={kp.kart}>
                  <circle cx={pt.x} cy={pt.y} r={28} fill={color} opacity={0.15} />
                  <circle cx={pt.x} cy={pt.y} r={20} fill={color} stroke="#1a1a1a" strokeWidth={2.5} />
                  <text
                    x={pt.x} y={pt.y - 3}
                    textAnchor="middle" dominantBaseline="central"
                    fill="#1a1a1a" fontSize="13" fontWeight="bold" fontFamily="monospace"
                  >{kp.kart}</text>
                  <text
                    x={pt.x} y={pt.y + 10}
                    textAnchor="middle" dominantBaseline="central"
                    fill="#1a1a1a" fontSize="8" fontWeight="600" fontFamily="system-ui, sans-serif"
                  >{pilotShort(kp.pilot)}</text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {rendered.length > 0 && hasPath && (
        <div className="mt-3 flex flex-wrap gap-2">
          {rendered.slice(0, 6).map((kp) => {
            const color = POSITION_COLORS[Math.min(kp.position - 1, POSITION_COLORS.length - 1)];
            return (
              <span key={kp.kart} className="inline-flex items-center gap-1.5 text-xs text-dark-400">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: color }} />
                <span className="font-mono">{kp.kart}</span>
                <span className="text-dark-600">{kp.pilot.split(' ')[0]}</span>
              </span>
            );
          })}
          {rendered.length > 6 && (
            <span className="text-xs text-dark-600">+{rendered.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
}
