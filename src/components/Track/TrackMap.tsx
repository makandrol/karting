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
  const totalLength = pathEl.getTotalLength();
  const point = pathEl.getPointAtLength(progress * totalLength);
  return { x: point.x, y: point.y };
}

/** Перші 3 букви прізвища (або імені якщо коротке) */
function pilotShort(name: string): string {
  return name.slice(0, 3);
}

interface KartPosition {
  kart: number;
  pilot: string;
  progress: number;
  position: number;
}

export default function TrackMap({ track, entries }: TrackMapProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathReady, setPathReady] = useState(false);
  const [smoothPositions, setSmoothPositions] = useState<KartPosition[]>([]);
  const targetRef = useRef<KartPosition[]>([]);
  const animFrameRef = useRef<number>(0);

  const hasPath = track.svgPath.length > 0;

  // Target positions from entries
  const kartPositions = useMemo(() => {
    return entries
      .filter((e) => e.progress !== null && e.progress >= 0)
      .map((e) => ({
        kart: e.kart,
        pilot: e.pilot,
        progress: e.progress!,
        position: e.position,
      }));
  }, [entries]);

  // Update target ref
  useEffect(() => {
    targetRef.current = kartPositions;
  }, [kartPositions]);

  // Smooth animation loop at ~10fps (100ms)
  const animate = useCallback(() => {
    setSmoothPositions((prev) => {
      const targets = targetRef.current;
      if (targets.length === 0) return targets;

      return targets.map((target) => {
        const existing = prev.find((p) => p.kart === target.kart);
        if (!existing) return target;

        // Lerp progress toward target (handle wraparound at 0/1)
        let diff = target.progress - existing.progress;
        // If kart crossed finish line (progress jumped from ~0.99 to ~0.01)
        if (diff < -0.5) diff += 1;
        if (diff > 0.5) diff -= 1;

        const lerped = existing.progress + diff * 0.3;
        // Normalize to 0..1
        const normalized = ((lerped % 1) + 1) % 1;

        return {
          ...target,
          progress: normalized,
        };
      });
    });

    animFrameRef.current = window.setTimeout(() => {
      requestAnimationFrame(animate);
    }, 100); // ~10fps
  }, []);

  useEffect(() => {
    if (!hasPath || !pathReady) return;
    requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) clearTimeout(animFrameRef.current);
    };
  }, [hasPath, pathReady, animate]);

  // Path ready detection
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
          <span className="text-dark-600 text-xs">
            Шлях не налаштований
          </span>
        )}
      </div>

      <div className="relative">
        <img
          src={track.image}
          alt={track.name}
          className="w-full rounded-lg opacity-90"
        />

        {hasPath && (
          <svg
            viewBox={TRACK_SVG_VIEWBOX}
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }}
          >
            <path
              ref={pathRef}
              d={track.svgPath}
              fill="none"
              stroke="none"
            />

            {pathReady && pathRef.current && smoothPositions.map((kp) => {
              const point = getPointOnPath(pathRef.current!, kp.progress);
              const color = POSITION_COLORS[Math.min(kp.position - 1, POSITION_COLORS.length - 1)];
              const short = pilotShort(kp.pilot);

              return (
                <g key={kp.kart}>
                  {/* Outer glow */}
                  <circle cx={point.x} cy={point.y} r={28} fill={color} opacity={0.15} />
                  {/* Background circle */}
                  <circle cx={point.x} cy={point.y} r={20} fill={color} stroke="#1a1a1a" strokeWidth={2.5} />
                  {/* Kart number */}
                  <text
                    x={point.x}
                    y={point.y - 3}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#1a1a1a"
                    fontSize="13"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {kp.kart}
                  </text>
                  {/* 3-letter pilot name */}
                  <text
                    x={point.x}
                    y={point.y + 10}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#1a1a1a"
                    fontSize="8"
                    fontWeight="600"
                    fontFamily="system-ui, sans-serif"
                  >
                    {short}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Legend */}
      {smoothPositions.length > 0 && hasPath && (
        <div className="mt-3 flex flex-wrap gap-2">
          {smoothPositions.slice(0, 6).map((kp) => {
            const color = POSITION_COLORS[Math.min(kp.position - 1, POSITION_COLORS.length - 1)];
            return (
              <span key={kp.kart} className="inline-flex items-center gap-1.5 text-xs text-dark-400">
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: color }} />
                <span className="font-mono">{kp.kart}</span>
                <span className="text-dark-600">{kp.pilot.split(' ')[0]}</span>
              </span>
            );
          })}
          {smoothPositions.length > 6 && (
            <span className="text-xs text-dark-600">+{smoothPositions.length - 6}</span>
          )}
        </div>
      )}
    </div>
  );
}
