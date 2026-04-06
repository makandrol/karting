import { useState, useRef, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPhaseLabel } from '../../data/competitions';

interface CompSession {
  sessionId: string;
  phase: string | null;
}

interface SessionTime {
  sessionId: string;
  phase: string | null;
  startTime: number;
  endTime: number | null;
}

interface CompetitionTimelineProps {
  format: string;
  sessions: CompSession[];
  sessionTimes: SessionTime[];
  currentTime: number | null;
  onTimeChange: (time: number | null) => void;
  isLive: boolean;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}хв ${s}с` : `${s}с`;
}

export default function CompetitionTimeline({ format, sessions, sessionTimes, currentTime, onTimeChange, isLive }: CompetitionTimelineProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const navigate = useNavigate();

  const timeRange = useMemo(() => {
    if (sessionTimes.length === 0) return null;
    const sorted = [...sessionTimes].sort((a, b) => a.startTime - b.startTime);
    const start = sorted[0].startTime - 60000;
    const lastEnd = sorted.reduce((max, s) => Math.max(max, s.endTime ?? Date.now()), 0);
    const end = isLive ? Date.now() : lastEnd + 60000;
    return { start, end, duration: end - start };
  }, [sessionTimes, isLive]);

  const segments = useMemo(() => {
    if (!timeRange) return [];
    const sorted = [...sessionTimes].sort((a, b) => a.startTime - b.startTime);
    const segs: { start: number; end: number; type: 'session' | 'idle' | 'offline'; phase?: string; sessionId?: string }[] = [];
    let cursor = timeRange.start;

    for (const s of sorted) {
      if (s.startTime > cursor + 5000) {
        segs.push({ start: cursor, end: s.startTime, type: 'idle' });
      }
      const end = s.endTime ?? (isLive ? Date.now() : s.startTime + 60000);
      segs.push({ start: s.startTime, end, type: 'session', phase: s.phase ?? undefined, sessionId: s.sessionId });
      cursor = Math.max(cursor, end);
    }
    if (cursor < timeRange.end - 5000) {
      segs.push({ start: cursor, end: timeRange.end, type: isLive ? 'idle' : 'offline' });
    }
    return segs;
  }, [sessionTimes, timeRange, isLive]);

  const toPct = (ms: number) => {
    if (!timeRange || timeRange.duration === 0) return 0;
    return Math.max(0, Math.min(100, ((ms - timeRange.start) / timeRange.duration) * 100));
  };

  const pctToMs = (pct: number) => {
    if (!timeRange) return 0;
    return timeRange.start + (pct / 100) * timeRange.duration;
  };

  const handlePointerEvent = (e: React.PointerEvent) => {
    if (!barRef.current || !timeRange) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const ms = pctToMs(pct);
    onTimeChange(ms);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    barRef.current?.setPointerCapture(e.pointerId);
    handlePointerEvent(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    handlePointerEvent(e);
  };

  const onPointerUp = () => { draggingRef.current = false; };

  const activeSession = useMemo(() => {
    if (currentTime === null) return null;
    return sessionTimes.find(s => s.startTime <= currentTime && (s.endTime === null || s.endTime >= currentTime));
  }, [currentTime, sessionTimes]);

  const activePhaseLabel = activeSession?.phase ? getPhaseLabel(format, activeSession.phase) : null;

  const scrubberPct = currentTime !== null ? toPct(currentTime) : (isLive ? 100 : null);

  const hours = useMemo(() => {
    if (!timeRange) return [];
    const result: number[] = [];
    const startH = new Date(timeRange.start);
    startH.setMinutes(0, 0, 0);
    let h = startH.getTime();
    while (h <= timeRange.end) {
      if (h >= timeRange.start) result.push(h);
      h += 30 * 60 * 1000;
    }
    return result;
  }, [timeRange]);

  if (!timeRange || sessionTimes.length === 0) return null;

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {activePhaseLabel ? (
            <span onClick={() => activeSession && navigate(`/sessions/${activeSession.sessionId}`)}
              className="text-blue-400 text-xs font-semibold cursor-pointer hover:text-blue-300 underline underline-offset-2 transition-colors">{activePhaseLabel}</span>
          ) : currentTime !== null ? (
            <span className="text-dark-400 text-xs">Перерва</span>
          ) : (
            <span className="text-dark-400 text-xs">Таймлайн змагання</span>
          )}
          {currentTime !== null && activeSession && (
            <span className="text-dark-500 text-[10px] font-mono">{fmtTime(currentTime)}</span>
          )}
          {currentTime !== null && !activeSession && (
            <span className="text-dark-500 text-[10px] font-mono">{fmtTime(currentTime)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1 text-dark-500"><span className="w-2 h-2 rounded-sm bg-yellow-400/60" /> перерва</span>
            <span className="flex items-center gap-1 text-dark-500"><span className="w-2 h-2 rounded-sm bg-green-400/70" /> заїзд</span>
          </div>
          {currentTime !== null ? (
            <button onClick={() => onTimeChange(null)} className="px-1.5 py-0.5 rounded text-[9px] bg-primary-600/20 text-primary-400 hover:bg-primary-600/30 transition-colors">
              LIVE ▸
            </button>
          ) : isLive ? (
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-green-500/20 text-green-400 font-semibold">● LIVE</span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[9px] bg-dark-800 text-dark-600">○ LIVE</span>
          )}
        </div>
      </div>

      <div className="relative">
        <div className="relative h-3 mb-0.5">
          {hours.map(h => (
            <span key={h} className="absolute -translate-x-1/2 text-[9px] font-mono text-dark-500" style={{ left: `${toPct(h)}%` }}>
              {new Date(h).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ))}
        </div>

        <div
          ref={barRef}
          className="relative h-7 bg-dark-800 rounded-lg cursor-pointer touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="absolute inset-0 rounded-lg overflow-hidden">
          {hours.map(h => (
            <div key={h} className="absolute top-0 h-full w-px bg-dark-600/60 pointer-events-none" style={{ left: `${toPct(h)}%` }} />
          ))}

          {segments.map((seg, i) => {
            const left = toPct(seg.start);
            const width = Math.max(toPct(seg.end) - left, 0.3);
            const isSession = seg.type === 'session';
            const bg = isSession ? 'bg-green-400/35' : seg.type === 'idle' ? 'bg-yellow-400/25' : 'bg-red-400/20';
            return (
              <div key={i}
                className={`absolute top-0 h-full ${bg} transition-colors ${isSession ? 'cursor-pointer z-[1]' : 'pointer-events-none'}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={isSession ? (e) => { e.stopPropagation(); navigate(`/sessions/${seg.sessionId}`); } : undefined}
              >
                {isSession && seg.phase && width > 3 && (
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-green-200/70 pointer-events-none select-none overflow-hidden whitespace-nowrap">
                    {(() => {
                      const label = getPhaseLabel(format, seg.phase);
                      const m = label.match(/Гонка (\d+) · Група (\d+)/);
                      if (m) return `${m[1]}-${m[2]}`;
                      return label.replace('Кваліфікація ', 'Кв');
                    })()}
                  </span>
                )}
              </div>
            );
          })}
          </div>

          {scrubberPct !== null && (
            <div className="absolute top-0 h-full w-[2px] bg-white z-10 pointer-events-none" style={{ left: `${scrubberPct}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}
