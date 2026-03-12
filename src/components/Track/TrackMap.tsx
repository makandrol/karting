import { useEffect, useRef, useMemo } from 'react';
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

function applySpeedProfile(
  uniformProgress: number,
  profile: SpeedProfilePoint[],
  referenceLapTime: number,
): number {
  if (profile.length < 2) return uniformProgress;
  const elapsed = uniformProgress * referenceLapTime;
  const fullProfile: SpeedProfilePoint[] = [
    { progress: 0, time: 0 }, ...profile, { progress: 1, time: referenceLapTime },
  ];
  for (let i = 0; i < fullProfile.length - 1; i++) {
    const a = fullProfile[i], b = fullProfile[i + 1];
    if (elapsed >= a.time && elapsed <= b.time) {
      const f = b.time > a.time ? (elapsed - a.time) / (b.time - a.time) : 0;
      return a.progress + f * (b.progress - a.progress);
    }
  }
  return uniformProgress;
}

interface KartState {
  kart: number;
  pilot: string;
  position: number;
  current: number;
  velocity: number;
  lastTarget: number;
  lastUpdateTime: number;
}

/**
 * TrackMap — рендерить карту траси з кружечками пілотів.
 * Анімація через прямий DOM (без React re-renders) для плавності.
 */
export default function TrackMap({ track, entries }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const kartsGroupRef = useRef<SVGGElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const statesRef = useRef<KartState[]>([]);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const pathReadyRef = useRef(false);

  const hasPath = track.svgPath.length > 0;

  const targets = useMemo(() => {
    return entries
      .filter((e) => e.progress !== null && e.progress >= 0)
      .map((e) => ({ kart: e.kart, pilot: e.pilot, progress: e.progress!, position: e.position }));
  }, [entries]);

  // Update states from new data
  useEffect(() => {
    const now = performance.now() / 1000;
    const prev = statesRef.current;

    statesRef.current = targets.map((t) => {
      const existing = prev.find((p) => p.kart === t.kart);
      if (!existing) {
        return {
          kart: t.kart, pilot: t.pilot, position: t.position,
          current: t.progress, velocity: 0.024,
          lastTarget: t.progress, lastUpdateTime: now,
        };
      }

      const dt = now - existing.lastUpdateTime;
      if (dt > 0.1) {
        let progressDiff = t.progress - existing.lastTarget;

        // Detect finish line crossing: target jumped backwards
        const crossedFinish = progressDiff < -0.3;
        if (crossedFinish) progressDiff += 1;
        if (progressDiff < 0) progressDiff = 0;

        const newVel = progressDiff / dt;
        const smoothVel = newVel > 0.001 ? existing.velocity * 0.6 + newVel * 0.4 : existing.velocity;

        return {
          ...existing, pilot: t.pilot, position: t.position,
          velocity: Math.max(smoothVel, 0.005),
          // On finish crossing: snap current to new position to avoid stall
          current: crossedFinish ? t.progress : existing.current,
          lastTarget: t.progress, lastUpdateTime: now,
        };
      }
      return { ...existing, pilot: t.pilot, position: t.position, lastTarget: t.progress };
    });

    // Update legend via DOM
    updateLegend();
  }, [targets]);

  function updateLegend() {
    const el = legendRef.current;
    if (!el) return;
    const sorted = [...statesRef.current].sort((a, b) => a.position - b.position);
    el.innerHTML = sorted.map((kp) => {
      const color = POSITION_COLORS[Math.min(kp.position - 1, POSITION_COLORS.length - 1)];
      return `<div style="display:flex;align-items:center;gap:4px;font-size:10px;line-height:1.2">
        <span style="width:14px;text-align:right;font-family:monospace;font-weight:700;color:${color}">${kp.position}</span>
        <span style="width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0"></span>
        <span style="font-family:monospace;color:#b0b0b0;width:18px">${kp.kart}</span>
        <span style="color:#fff;font-weight:500">${kp.pilot.split(' ')[0]}</span>
      </div>`;
    }).join('');
  }

  // 60fps animation — direct DOM manipulation, NO React setState
  useEffect(() => {
    if (!hasPath) return;

    // Wait for path to be ready
    const initTimer = setTimeout(() => {
      if (!pathRef.current) return;
      pathReadyRef.current = true;
      // Create SVG elements for each kart once
      ensureKartElements();
      lastFrameRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }, 100);

    function tick(time: number) {
      const now = time / 1000;
      const dt = lastFrameRef.current ? now - lastFrameRef.current : 0.016;
      lastFrameRef.current = now;

      if (!pathRef.current || !kartsGroupRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const states = statesRef.current;

      for (const s of states) {
        let newPos = s.current + s.velocity * dt;
        const timeSinceUpdate = now - s.lastUpdateTime;
        let expectedPos = s.lastTarget + s.velocity * timeSinceUpdate;
        expectedPos = ((expectedPos % 1) + 1) % 1;

        let correction = expectedPos - newPos;
        if (correction > 0.5) correction -= 1;
        if (correction < -0.5) correction += 1;
        newPos += correction * 0.02;
        s.current = ((newPos % 1) + 1) % 1;
      }

      // Update DOM directly
      ensureKartElements();
      updateKartPositions();

      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      clearTimeout(initTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [hasPath, track.id]);

  function ensureKartElements() {
    const g = kartsGroupRef.current;
    if (!g) return;
    const states = statesRef.current;

    // Remove extra elements
    while (g.children.length > states.length) {
      g.removeChild(g.lastChild!);
    }

    // Add missing elements
    while (g.children.length < states.length) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      // Glow
      const glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      glow.setAttribute('r', '28'); glow.setAttribute('opacity', '0.15');
      group.appendChild(glow);
      // Main circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '20'); circle.setAttribute('stroke', '#1a1a1a'); circle.setAttribute('stroke-width', '2.5');
      group.appendChild(circle);
      // Kart number
      const numText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      numText.setAttribute('text-anchor', 'middle'); numText.setAttribute('dominant-baseline', 'central');
      numText.setAttribute('fill', '#1a1a1a'); numText.setAttribute('font-size', '13');
      numText.setAttribute('font-weight', 'bold'); numText.setAttribute('font-family', 'monospace');
      group.appendChild(numText);
      // Pilot name
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

      const mapped = track.speedProfile.length >= 2
        ? applySpeedProfile(s.current, track.speedProfile, track.referenceLapTime)
        : s.current;
      const pt = getPointOnPath(path, mapped);
      const color = POSITION_COLORS[Math.min(s.position - 1, POSITION_COLORS.length - 1)];

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
    <div ref={containerRef} className="card p-0 overflow-hidden">
      <div className="relative">
        <img src={track.image} alt={track.name} className="w-full rounded-lg opacity-90" />

        {/* F1 legend — direct DOM updated, no re-renders */}
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
