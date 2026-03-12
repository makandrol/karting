import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { TimingEntry } from '../../types';
import type { TrackConfig, SpeedProfilePoint } from '../../data/tracks';
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

/**
 * Конвертує рівномірний progress (0..1) у нерівномірний,
 * базуючись на speedProfile (progress→time маппінг).
 *
 * uniformProgress = час_пілота_на_колі / час_кола (лінійний)
 * Повертає progress по трасі (може бути нерівномірним — швидше на прямих, повільніше в поворотах)
 */
function applySpeedProfile(
  uniformProgress: number,
  profile: SpeedProfilePoint[],
  referenceLapTime: number,
  actualLapTime: number
): number {
  if (profile.length < 2) return uniformProgress;

  // uniformProgress = elapsed / lapTime → elapsed = uniformProgress * actualLapTime
  // Масштабуємо час до reference: scaledTime = elapsed * (referenceLapTime / actualLapTime)
  const elapsed = uniformProgress * referenceLapTime;

  // Шукаємо між якими маркерами ми зараз
  // Profile відсортований за progress, але нам потрібно шукати за time
  // Додаємо початкову (0,0) і кінцеву (1, referenceLapTime) точки
  const fullProfile: SpeedProfilePoint[] = [
    { progress: 0, time: 0 },
    ...profile,
    { progress: 1, time: referenceLapTime },
  ];

  // Знаходимо сегмент
  for (let i = 0; i < fullProfile.length - 1; i++) {
    const a = fullProfile[i];
    const b = fullProfile[i + 1];
    if (elapsed >= a.time && elapsed <= b.time) {
      const timeFraction = b.time > a.time ? (elapsed - a.time) / (b.time - a.time) : 0;
      return a.progress + timeFraction * (b.progress - a.progress);
    }
  }

  return uniformProgress;
}

interface KartState {
  kart: number;
  pilot: string;
  position: number;
  current: number;       // поточна відрендерена позиція (0..1)
  velocity: number;      // швидкість (progress/sec), оцінена з останніх оновлень
  lastTarget: number;    // останній отриманий target
  prevTarget: number;    // попередній target (для обчислення velocity)
  lastUpdateTime: number; // час останнього оновлення даних
}

export default function TrackMap({ track, entries }: TrackMapProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [pathReady, setPathReady] = useState(false);
  const statesRef = useRef<KartState[]>([]);
  const [rendered, setRendered] = useState<KartState[]>([]);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  const hasPath = track.svgPath.length > 0;

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

  // Оновити стани коли приходять нові дані
  useEffect(() => {
    const now = performance.now() / 1000;
    const prev = statesRef.current;

    statesRef.current = targets.map((t) => {
      const existing = prev.find((p) => p.kart === t.kart);

      if (!existing) {
        // Новий карт — початковий стан
        return {
          kart: t.kart,
          pilot: t.pilot,
          position: t.position,
          current: t.progress,
          velocity: 0.024, // ~1 коло за 42с → 1/42 ≈ 0.024 progress/sec
          lastTarget: t.progress,
          prevTarget: t.progress,
          lastUpdateTime: now,
        };
      }

      // Обчислити нову velocity з різниці targets
      const dt = now - existing.lastUpdateTime;
      if (dt > 0.1) { // мінімум 100мс між оновленнями
        let progressDiff = t.progress - existing.lastTarget;
        // Wraparound
        if (progressDiff < -0.5) progressDiff += 1;
        if (progressDiff < 0) progressDiff += 1; // завжди вперед

        const newVelocity = progressDiff / dt;

        // Згладжена velocity (80% стара + 20% нова) для стабільності
        const smoothVelocity = newVelocity > 0.001
          ? existing.velocity * 0.7 + newVelocity * 0.3
          : existing.velocity;

        return {
          ...existing,
          pilot: t.pilot,
          position: t.position,
          velocity: Math.max(smoothVelocity, 0.005), // мінімальна швидкість
          prevTarget: existing.lastTarget,
          lastTarget: t.progress,
          lastUpdateTime: now,
        };
      }

      return {
        ...existing,
        pilot: t.pilot,
        position: t.position,
        lastTarget: t.progress,
      };
    });
  }, [targets]);

  // 60fps: рівномірний рух з постійною швидкістю + м'яка корекція
  const tick = useCallback((time: number) => {
    const now = time / 1000;
    const dt = lastFrameRef.current ? now - lastFrameRef.current : 0.016;
    lastFrameRef.current = now;

    const states = statesRef.current;
    let changed = false;

    for (const s of states) {
      // 1. Рівномірний рух вперед з поточною швидкістю
      let newPos = s.current + s.velocity * dt;

      // 2. М'яка корекція до таргету (щоб не розходитись)
      //    Екстраполюємо де таргет зараз (таргет + швидкість × час_після_оновлення)
      const timeSinceUpdate = now - s.lastUpdateTime;
      let expectedPos = s.lastTarget + s.velocity * timeSinceUpdate;

      // Wraparound
      expectedPos = ((expectedPos % 1) + 1) % 1;

      let correction = expectedPos - newPos;
      if (correction > 0.5) correction -= 1;
      if (correction < -0.5) correction += 1;

      // Дуже м'яка корекція — 2% за кадр
      newPos += correction * 0.02;

      // Normalize
      newPos = ((newPos % 1) + 1) % 1;

      if (Math.abs(newPos - s.current) > 0.00001) {
        s.current = newPos;
        changed = true;
      }
    }

    if (changed) {
      setRendered(states.map((s) => ({ ...s })));
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
              // Застосувати speed profile для нерівномірного руху
              const mappedProgress = track.speedProfile.length >= 2
                ? applySpeedProfile(kp.current, track.speedProfile, track.referenceLapTime, track.referenceLapTime)
                : kp.current;
              const pt = getPointOnPath(pathRef.current!, mappedProgress);
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
