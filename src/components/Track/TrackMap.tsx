import { useEffect, useRef, useMemo } from 'react';
import type { TimingEntry } from '../../types';
import type { TrackConfig, SpeedProfilePoint } from '../../data/tracks';
import { TRACK_SVG_VIEWBOX } from '../../data/tracks';

interface TrackMapProps {
  track: TrackConfig;
  entries: TimingEntry[];
  /** Статичний режим: карти позиціонуються по entry.progress без власної анімації.
   *  Використовується для replay. */
  static?: boolean;
}

const POSITION_COLORS = [
  '#facc15', '#d1d5db', '#d97706', '#f87171', '#60a5fa',
  '#34d399', '#a78bfa', '#fb923c', '#f472b6', '#94a3b8',
];

function pilotShort(name: string): string {
  return name.slice(0, 3);
}

function getPointOnPath(pathEl: SVGPathElement, progress: number): { x: number; y: number } {
  const len = pathEl.getTotalLength();
  const clamped = Math.max(0, Math.min(1, progress));
  const pt = pathEl.getPointAtLength(clamped * len);
  return { x: pt.x, y: pt.y };
}

// Фіксований колір по карту (не змінюється при зміні позицій)
const KART_COLORS: Record<number, string> = {};
let colorIndex = 0;
function getKartColor(kart: number): string {
  if (!KART_COLORS[kart]) {
    KART_COLORS[kart] = POSITION_COLORS[colorIndex % POSITION_COLORS.length];
    colorIndex++;
  }
  return KART_COLORS[kart];
}

/**
 * Конвертує час (секунди від старту кола) в позицію на трасі (0..1)
 * через speed profile.
 */
function timeToProgress(
  elapsedSec: number,
  profile: SpeedProfilePoint[],
  referenceLapTime: number,
  pilotLapTime: number,
): number {
  if (pilotLapTime <= 0) return 0;
  const scaledTime = elapsedSec * referenceLapTime / pilotLapTime;

  if (profile.length < 2) {
    return Math.min(scaledTime / referenceLapTime, 1);
  }

  const full: SpeedProfilePoint[] = [
    { progress: 0, time: 0 },
    ...profile,
    { progress: 1, time: referenceLapTime },
  ];

  for (let i = 0; i < full.length - 1; i++) {
    const a = full[i], b = full[i + 1];
    if (scaledTime >= a.time && scaledTime <= b.time) {
      const f = b.time > a.time ? (scaledTime - a.time) / (b.time - a.time) : 0;
      return a.progress + f * (b.progress - a.progress);
    }
  }

  return scaledTime >= referenceLapTime ? 1 : 0;
}

// ============================================================
// Стан карту на карті (для live режиму)
// ============================================================

interface KartState {
  kart: number;
  pilot: string;
  position: number;
  lapStartWallTime: number;
  movementLapTime: number;
  lapNumber: number;
  frozenAtFinish: boolean;
  currentProgress: number;
}

export default function TrackMap({ track, entries, static: isStatic }: TrackMapProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const kartsGroupRef = useRef<SVGGElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const statesRef = useRef<KartState[]>([]);
  const rafRef = useRef<number>(0);
  const pathReadyRef = useRef(false);

  const hasPath = track.svgPath.length > 0;

  const targets = useMemo(() => {
    return entries
      .filter((e) => e.progress !== null && e.progress >= 0)
      .map((e) => ({
        kart: e.kart,
        pilot: e.pilot,
        position: e.position,
        progress: e.progress!,
        lapNumber: e.lapNumber,
        previousLapSec: e.previousLapSec,
        currentLapSec: e.currentLapSec,
      }));
  }, [entries]);

  // ============================================================
  // STATIC MODE — positions from entries directly, no animation
  // ============================================================

  useEffect(() => {
    if (!isStatic || !hasPath) return;

    statesRef.current = targets.map((t) => ({
      kart: t.kart,
      pilot: t.pilot,
      position: t.position,
      lapStartWallTime: 0,
      movementLapTime: 0,
      lapNumber: t.lapNumber,
      frozenAtFinish: false,
      currentProgress: t.progress,
    }));

    updateLegend();

    // Try to render immediately, retry if path not ready
    function tryRender() {
      if (!pathRef.current) return false;
      ensureKartElements();
      updateKartPositions();
      return true;
    }

    if (!tryRender()) {
      // Path not ready yet — retry a few times
      const t1 = setTimeout(tryRender, 50);
      const t2 = setTimeout(tryRender, 150);
      const t3 = setTimeout(tryRender, 300);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
  }, [isStatic, hasPath, targets]);

  // ============================================================
  // LIVE MODE — wall-clock animation
  // ============================================================

  // Update states from entries (live mode only)
  useEffect(() => {
    if (isStatic) return;
    const now = performance.now() / 1000;
    const prev = statesRef.current;
    const refLap = track.referenceLapTime || 42;

    statesRef.current = targets.map((t) => {
      const existing = prev.find((p) => p.kart === t.kart);
      const movementLapTime = t.previousLapSec || refLap;

      if (!existing) {
        return {
          kart: t.kart,
          pilot: t.pilot,
          position: t.position,
          lapStartWallTime: now - (t.progress * movementLapTime),
          movementLapTime,
          lapNumber: t.lapNumber,
          frozenAtFinish: false,
          currentProgress: t.progress,
        };
      }

      if (t.lapNumber !== existing.lapNumber) {
        const wasFaster = existing.frozenAtFinish === false && existing.currentProgress < 0.95;
        return {
          ...existing,
          pilot: t.pilot,
          position: t.position,
          lapStartWallTime: now,
          movementLapTime,
          lapNumber: t.lapNumber,
          frozenAtFinish: false,
          currentProgress: wasFaster ? t.progress : 0,
        };
      }

      return {
        ...existing,
        pilot: t.pilot,
        position: t.position,
        movementLapTime,
      };
    });

    updateLegend();
  }, [isStatic, targets, track.referenceLapTime]);

  // 60fps animation (live mode only)
  useEffect(() => {
    if (!hasPath || isStatic) return;

    const initTimer = setTimeout(() => {
      if (!pathRef.current) return;
      pathReadyRef.current = true;
      ensureKartElements();
      rafRef.current = requestAnimationFrame(tick);
    }, 100);

    function tick() {
      if (!pathRef.current || !kartsGroupRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now() / 1000;
      const states = statesRef.current;
      const profile = track.speedProfile;
      const refLap = track.referenceLapTime || 42;

      for (const s of states) {
        const elapsed = now - s.lapStartWallTime;

        if (elapsed >= s.movementLapTime && !s.frozenAtFinish) {
          s.frozenAtFinish = true;
          s.currentProgress = 0.999;
        }

        if (!s.frozenAtFinish) {
          s.currentProgress = timeToProgress(elapsed, profile, refLap, s.movementLapTime);
        }
      }

      ensureKartElements();
      updateKartPositions();
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      clearTimeout(initTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [hasPath, isStatic, track.id, track.speedProfile, track.referenceLapTime]);

  // Path ready
  useEffect(() => {
    pathReadyRef.current = false;
    if (!hasPath) return;
    const t = setTimeout(() => { if (pathRef.current) pathReadyRef.current = true; }, 50);
    return () => clearTimeout(t);
  }, [track.id, hasPath]);

  // ============================================================
  // Shared rendering functions
  // ============================================================

  function updateLegend() {
    const el = legendRef.current;
    if (!el) return;
    const sorted = [...statesRef.current].sort((a, b) => a.position - b.position);
    el.innerHTML = sorted.map((kp) => {
      const color = getKartColor(kp.kart);
      return `<div style="display:flex;align-items:center;gap:4px;font-size:10px;line-height:1.2">
        <span style="width:14px;text-align:right;font-family:monospace;font-weight:700;color:${color}">${kp.position}</span>
        <span style="width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0"></span>
        <span style="font-family:monospace;color:#b0b0b0;width:18px">${kp.kart}</span>
        <span style="color:#fff;font-weight:500">${kp.pilot.split(' ')[0]}</span>
      </div>`;
    }).join('');
  }

  function ensureKartElements() {
    const g = kartsGroupRef.current;
    if (!g) return;
    const states = statesRef.current;
    while (g.children.length > states.length) g.removeChild(g.lastChild!);
    while (g.children.length < states.length) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      glow.setAttribute('r', '28'); glow.setAttribute('opacity', '0.15');
      group.appendChild(glow);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '20'); circle.setAttribute('stroke', '#1a1a1a'); circle.setAttribute('stroke-width', '2.5');
      group.appendChild(circle);
      const numText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      numText.setAttribute('text-anchor', 'middle'); numText.setAttribute('dominant-baseline', 'central');
      numText.setAttribute('fill', '#1a1a1a'); numText.setAttribute('font-size', '13');
      numText.setAttribute('font-weight', 'bold'); numText.setAttribute('font-family', 'monospace');
      group.appendChild(numText);
      const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameText.setAttribute('text-anchor', 'middle'); nameText.setAttribute('dominant-baseline', 'central');
      nameText.setAttribute('fill', '#1a1a1a'); nameText.setAttribute('font-size', '8');
      nameText.setAttribute('font-weight', '600'); nameText.setAttribute('font-family', 'system-ui, sans-serif');
      group.appendChild(nameText);
      g.appendChild(group);
    }
  }

  function updateKartPositions() {
    const g = kartsGroupRef.current;
    const path = pathRef.current;
    if (!g || !path) return;
    const states = statesRef.current;

    for (let i = 0; i < states.length; i++) {
      const s = states[i];
      const group = g.children[i] as SVGGElement;
      if (!group) continue;

      const pt = getPointOnPath(path, s.currentProgress);
      const color = getKartColor(s.kart);

      const glow = group.children[0] as SVGCircleElement;
      const circle = group.children[1] as SVGCircleElement;
      const numText = group.children[2] as SVGTextElement;
      const nameText = group.children[3] as SVGTextElement;

      glow.setAttribute('cx', String(pt.x)); glow.setAttribute('cy', String(pt.y)); glow.setAttribute('fill', color);
      circle.setAttribute('cx', String(pt.x)); circle.setAttribute('cy', String(pt.y)); circle.setAttribute('fill', color);
      numText.setAttribute('x', String(pt.x)); numText.setAttribute('y', String(pt.y - 3));
      numText.textContent = String(s.kart);
      nameText.setAttribute('x', String(pt.x)); nameText.setAttribute('y', String(pt.y + 10));
      nameText.textContent = pilotShort(s.pilot);
    }
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="relative">
        <img src={track.image} alt={track.name} className="w-full rounded-lg opacity-90" />

        {hasPath && (
          <div
            ref={legendRef}
            className="absolute top-2 left-2 bg-black/80 backdrop-blur-sm rounded-lg p-2 space-y-0.5 z-10"
          />
        )}

        {hasPath && (
          <svg
            viewBox={TRACK_SVG_VIEWBOX}
            className="absolute inset-0 w-full h-full"
            style={{ pointerEvents: 'none' }}
          >
            <path ref={pathRef} d={track.svgPath} fill="none" stroke="none" />
            <g ref={kartsGroupRef} />
          </svg>
        )}
      </div>
    </div>
  );
}
