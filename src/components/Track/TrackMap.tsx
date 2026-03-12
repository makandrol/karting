import { useState, useEffect, useRef, useMemo } from 'react';
import type { TimingEntry } from '../../types';
import type { TrackConfig } from '../../data/tracks';
import { TRACK_SVG_VIEWBOX } from '../../data/tracks';

interface TrackMapProps {
  track: TrackConfig;
  entries: TimingEntry[];
}

// Кольори для позицій
const POSITION_COLORS = [
  '#facc15', // 1st — gold
  '#d1d5db', // 2nd — silver
  '#d97706', // 3rd — bronze
  '#f87171', // 4th
  '#60a5fa', // 5th
  '#34d399', // 6th
  '#a78bfa', // 7th
  '#fb923c', // 8th
  '#f472b6', // 9th
  '#94a3b8', // 10th
];

/**
 * Отримує точку на SVG path відповідно до прогресу (0..1).
 */
function getPointOnPath(pathEl: SVGPathElement, progress: number): { x: number; y: number } {
  const totalLength = pathEl.getTotalLength();
  const point = pathEl.getPointAtLength(progress * totalLength);
  return { x: point.x, y: point.y };
}

export default function TrackMap({ track, entries }: TrackMapProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathReady, setPathReady] = useState(false);

  const hasPath = track.svgPath.length > 0;

  // Фільтруємо тільки ті, що мають progress
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

  // Force re-render when path is available
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
        {/* Track image background */}
        <img
          src={track.image}
          alt={track.name}
          className="w-full rounded-lg opacity-90"
        />

        {/* SVG overlay for kart dots */}
        {hasPath && (
          <svg
            viewBox={TRACK_SVG_VIEWBOX}
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }}
          >
            {/* Hidden path for calculations */}
            <path
              ref={pathRef}
              d={track.svgPath}
              fill="none"
              stroke="none"
            />

            {/* Kart dots */}
            {pathReady && pathRef.current && kartPositions.map((kp) => {
              const point = getPointOnPath(pathRef.current!, kp.progress);
              const color = POSITION_COLORS[Math.min(kp.position - 1, POSITION_COLORS.length - 1)];

              return (
                <g key={kp.kart}>
                  {/* Outer glow */}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={22}
                    fill={color}
                    opacity={0.2}
                  />
                  {/* Main dot */}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={16}
                    fill={color}
                    stroke="#1a1a1a"
                    strokeWidth={3}
                  />
                  {/* Kart number */}
                  <text
                    x={point.x}
                    y={point.y + 1.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#1a1a1a"
                    fontSize="14"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {kp.kart}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Legend */}
      {kartPositions.length > 0 && hasPath && (
        <div className="mt-3 flex flex-wrap gap-2">
          {kartPositions.slice(0, 5).map((kp) => {
            const color = POSITION_COLORS[Math.min(kp.position - 1, POSITION_COLORS.length - 1)];
            return (
              <span key={kp.kart} className="inline-flex items-center gap-1.5 text-xs text-dark-400">
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ backgroundColor: color }}
                />
                <span className="font-mono">{kp.kart}</span>
                <span className="text-dark-600">{kp.pilot.split(' ')[0]}</span>
              </span>
            );
          })}
          {kartPositions.length > 5 && (
            <span className="text-xs text-dark-600">+{kartPositions.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}
