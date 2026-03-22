import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { COLLECTOR_URL } from '../../services/config';

interface DbSession {
  id: string;
  start_time: number;
  end_time: number | null;
  pilot_count: number;
  track_id: number;
  race_number: number | null;
  is_race: number;
  date: string;
}

interface DayTimelineProps {
  isTimingOnline: boolean;
  isTimingIdle?: boolean;
  idleSince?: number | null;
}

type SegmentType = 'offline' | 'idle' | 'session';

interface Segment {
  startH: number;
  endH: number;
  type: SegmentType;
  session?: DbSession;
}

function fmtDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function fmtDateLabel(date: Date): string {
  const today = new Date();
  if (fmtDate(date) === fmtDate(today)) return 'Сьогодні';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (fmtDate(date) === fmtDate(yesterday)) return 'Вчора';
  return date.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(startMs: number, endMs: number): string {
  const sec = Math.round((endMs - startMs) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}с`;
  return `${m}хв ${s}с`;
}

function msToHour(ms: number): number {
  const d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60;
}

const DAY_START = 8;
const DAY_END = 23;
const WINDOW_HOURS = 6;

export default function DayTimeline({ isTimingOnline, isTimingIdle = false, idleSince = null }: DayTimelineProps) {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<number>(() => {
    const h = new Date().getHours();
    return Math.max(DAY_START, Math.min(DAY_END - WINDOW_HOURS, h - WINDOW_HOURS / 2));
  });

  const isToday = fmtDate(selectedDate) === fmtDate(new Date());
  const windowEnd = windowStart + WINDOW_HOURS;

  const fetchSessions = useCallback(async (date: Date) => {
    setLoading(true);
    try {
      const res = await fetch(`${COLLECTOR_URL}/db/sessions?date=${fmtDate(date)}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) setSessions(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSessions(selectedDate);
    if (!isToday) return;
    const timer = setInterval(() => fetchSessions(selectedDate), 30000);
    return () => clearInterval(timer);
  }, [selectedDate, isToday, fetchSessions]);

  const goDay = (delta: number) => {
    setSelectedDate(prev => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      if (fmtDate(next) > fmtDate(new Date())) return prev;
      return next;
    });
  };

  const slideWindow = (delta: number) => {
    setWindowStart(prev => Math.max(DAY_START, Math.min(DAY_END - WINDOW_HOURS, prev + delta)));
  };

  // Touch/drag support
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWindowStart: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-session]')) return;
    dragRef.current = { startX: e.clientX, startWindowStart: windowStart };
    barRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !barRef.current) return;
    const barWidth = barRef.current.offsetWidth;
    const dx = e.clientX - dragRef.current.startX;
    const hoursPerPx = WINDOW_HOURS / barWidth;
    const newStart = dragRef.current.startWindowStart - dx * hoursPerPx;
    setWindowStart(Math.max(DAY_START, Math.min(DAY_END - WINDOW_HOURS, newStart)));
  };

  const onPointerUp = () => { dragRef.current = null; };

  const now = new Date();
  const currentH = now.getHours() + now.getMinutes() / 60;

  const parsed = sessions
    .filter(s => !s.end_time || (s.end_time - s.start_time) >= 60000)
    .map(s => ({
    ...s,
    startH: msToHour(s.start_time),
    endH: s.end_time ? msToHour(s.end_time) : (isToday ? currentH : msToHour(s.start_time)),
  }));

  const raceNums = new Map<string, number | null>();
  parsed.forEach(s => raceNums.set(s.id, s.race_number));

  // Build segments
  const segments: Segment[] = [];
  const timelineEndH = isToday ? currentH : DAY_END;

  if (parsed.length === 0) {
    if (isToday) {
      if (isTimingIdle && idleSince) {
        const idleH = msToHour(idleSince);
        if (idleH > DAY_START) segments.push({ startH: DAY_START, endH: idleH, type: 'offline' });
        segments.push({ startH: idleH, endH: timelineEndH, type: 'idle' });
      } else if (isTimingOnline) {
        segments.push({ startH: DAY_START, endH: timelineEndH, type: 'idle' });
      } else {
        segments.push({ startH: DAY_START, endH: timelineEndH, type: 'offline' });
      }
    } else {
      segments.push({ startH: DAY_START, endH: DAY_END, type: 'offline' });
    }
  } else {
    let cursor = DAY_START;
    for (const s of parsed) {
      if (s.startH > cursor + 0.03) {
        segments.push({ startH: cursor, endH: s.startH, type: cursor === DAY_START ? 'offline' : 'idle' });
      }
      segments.push({ startH: s.startH, endH: Math.max(s.endH, s.startH + 0.05), type: 'session', session: s });
      cursor = Math.max(cursor, s.endH);
    }
    if (cursor < timelineEndH - 0.03) {
      if (isToday) {
        segments.push({ startH: cursor, endH: timelineEndH, type: isTimingOnline ? 'session' : isTimingIdle ? 'idle' : 'offline' });
      } else {
        segments.push({ startH: cursor, endH: DAY_END, type: 'offline' });
      }
    }
  }

  // Clip segments to window
  const toPct = (h: number) => Math.max(0, Math.min(100, ((h - windowStart) / WINDOW_HOURS) * 100));
  const clipped = segments
    .map(seg => {
      const s = Math.max(seg.startH, windowStart);
      const e = Math.min(seg.endH, windowEnd);
      if (e <= s) return null;
      return { ...seg, startPct: toPct(s), endPct: toPct(e) };
    })
    .filter(Boolean) as (Segment & { startPct: number; endPct: number })[];

  const currentPct = isToday ? toPct(currentH) : null;

  const hours: number[] = [];
  for (let h = Math.ceil(windowStart); h <= Math.floor(windowEnd); h++) hours.push(h);

  const hovered = hoveredSession ? parsed.find(s => s.id === hoveredSession) : null;

  // Window position indicator
  const totalRange = DAY_END - DAY_START;
  const scrollThumbLeft = ((windowStart - DAY_START) / totalRange) * 100;
  const scrollThumbWidth = (WINDOW_HOURS / totalRange) * 100;

  return (
    <div className="card p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <button onClick={() => goDay(-1)} className="p-1 rounded-md text-dark-400 hover:text-white hover:bg-dark-700 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="text-dark-300 text-xs font-medium min-w-[80px] text-center">{fmtDateLabel(selectedDate)}</span>
          <button onClick={() => goDay(1)} disabled={isToday} className="p-1 rounded-md text-dark-400 hover:text-white hover:bg-dark-700 transition-colors disabled:opacity-20 disabled:cursor-default">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
          {!isToday && (
            <button onClick={() => setSelectedDate(new Date())} className="ml-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-primary-500/15 text-primary-400 hover:bg-primary-500/25 transition-colors">
              Сьогодні
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5 text-[10px]">
          <span className="flex items-center gap-1 text-dark-500"><span className="w-2 h-2 rounded-sm bg-red-400/50" /> офлайн</span>
          <span className="flex items-center gap-1 text-dark-500"><span className="w-2 h-2 rounded-sm bg-yellow-400/60" /> очікування</span>
          <span className="flex items-center gap-1 text-dark-500"><span className="w-2 h-2 rounded-sm bg-green-400/70" /> заїзд</span>
          {isToday && isTimingOnline && (
            <span className="flex items-center gap-1 text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> live</span>
          )}
        </div>
      </div>

      {loading && sessions.length === 0 && (
        <div className="text-center text-dark-500 text-[10px] py-3">Завантаження...</div>
      )}

      {/* Timeline bar with hour labels */}
      <div className="flex items-center gap-0">
        <button onClick={() => slideWindow(-1)} disabled={windowStart <= DAY_START}
          className="p-0.5 text-dark-500 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-default flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div className="flex-1 min-w-0">
          {/* Hour labels above the bar */}
          <div className="relative h-4 mb-0.5">
            {hours.map(h => (
              <span key={h} className="absolute -translate-x-1/2 text-[11px] font-mono text-dark-400 font-medium" style={{ left: `${toPct(h)}%` }}>
                {h}
              </span>
            ))}
          </div>

          <div
            ref={barRef}
            className="relative h-8 bg-dark-800 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Hour grid lines */}
            {hours.map(h => (
              <div key={h} className="absolute top-0 h-full w-px bg-dark-600/80 pointer-events-none" style={{ left: `${toPct(h)}%` }} />
            ))}

            {/* Segments */}
            {clipped.map((seg, i) => {
              const width = Math.max(seg.endPct - seg.startPct, 0.2);
              const isSession = seg.type === 'session' && !!seg.session;
              const isHov = isSession && hoveredSession === seg.session!.id;
              const bg = seg.type === 'offline' ? (isHov ? 'bg-red-400/40' : 'bg-red-400/25')
                : seg.type === 'idle' ? (isHov ? 'bg-yellow-400/45' : 'bg-yellow-400/30')
                : isHov ? 'bg-green-400/55' : 'bg-green-400/35';

              return (
                <div
                  key={i}
                  data-session={isSession ? '1' : undefined}
                  className={`absolute top-0 h-full ${bg} ${isSession ? 'cursor-pointer' : ''} transition-colors`}
                  style={{ left: `${seg.startPct}%`, width: `${width}%` }}
                  onMouseEnter={isSession ? () => setHoveredSession(seg.session!.id) : undefined}
                  onMouseLeave={isSession ? () => setHoveredSession(null) : undefined}
                  onClick={isSession ? () => navigate(`/sessions/${seg.session!.id}`) : undefined}
                >
                  {isSession && (
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold font-mono text-green-200 pointer-events-none select-none overflow-visible whitespace-nowrap">
                      {raceNums.get(seg.session!.id) ?? ''}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Current time marker */}
            {currentPct !== null && currentPct > 0 && currentPct < 100 && (
              <div className={`absolute top-0 h-full w-[2px] z-10 pointer-events-none ${
                isTimingOnline ? 'bg-green-400' : isTimingIdle ? 'bg-yellow-400' : 'bg-white/60'
              }`} style={{ left: `${currentPct}%` }} />
            )}
          </div>

          {/* Scroll position indicator */}
          <div className="relative h-1 mt-1 bg-dark-800 rounded-full">
            <div className="absolute top-0 h-full bg-dark-600 rounded-full" style={{ left: `${scrollThumbLeft}%`, width: `${scrollThumbWidth}%` }} />
          </div>
        </div>

        <button onClick={() => slideWindow(1)} disabled={windowStart >= DAY_END - WINDOW_HOURS}
          className="p-0.5 text-dark-500 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-default flex-shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {/* Tooltip */}
      <div className="h-5 flex items-center mt-1">
        {hovered ? (
          <div className="flex items-center gap-2.5 text-[10px] text-dark-300">
            {hovered.race_number != null && <span className="text-dark-400 font-mono">#{hovered.race_number}</span>}
            <span className="font-mono font-medium text-white">{fmtTime(hovered.start_time)}–{hovered.end_time ? fmtTime(hovered.end_time) : 'зараз'}</span>
            <span>{hovered.pilot_count} пілотів</span>
            {hovered.end_time && <span>{fmtDuration(hovered.start_time, hovered.end_time)}</span>}
          </div>
        ) : sessions.length > 0 ? (
          <div className="text-[10px] text-dark-600">
            {sessions.length} {sessions.length === 1 ? 'заїзд' : sessions.length < 5 ? 'заїзди' : 'заїздів'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
