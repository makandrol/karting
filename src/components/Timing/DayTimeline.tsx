import { Link } from 'react-router-dom';

interface TimelineSession {
  id: string;
  number: number;
  startTime: string; // "16:00:00"
  endTime: string;
  type: string;
  competitionName: string | null;
}

interface DayTimelineProps {
  sessions: TimelineSession[];
  isTimingOnline: boolean;
  /** Години роботи картодрому */
  dayStart?: number; // 10
  dayEnd?: number;   // 23
}

export default function DayTimeline({ sessions, isTimingOnline, dayStart = 10, dayEnd = 23 }: DayTimelineProps) {
  const totalHours = dayEnd - dayStart;
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const currentPct = Math.max(0, Math.min(100, ((currentHour - dayStart) / totalHours) * 100));

  // Build segments: offline (red) and sessions (green)
  const segments: { startPct: number; endPct: number; type: 'offline' | 'session'; session?: TimelineSession }[] = [];

  // Parse session times to percentages
  const parsedSessions = sessions.map(s => {
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    const startH = sh + (sm || 0) / 60;
    const endH = eh + (em || 0) / 60;
    return {
      ...s,
      startPct: Math.max(0, ((startH - dayStart) / totalHours) * 100),
      endPct: Math.min(100, ((endH - dayStart) / totalHours) * 100),
    };
  }).sort((a, b) => a.startPct - b.startPct);

  // Fill gaps with offline
  let lastEnd = 0;
  for (const s of parsedSessions) {
    if (s.startPct > lastEnd + 0.5) {
      segments.push({ startPct: lastEnd, endPct: s.startPct, type: 'offline' });
    }
    segments.push({ startPct: s.startPct, endPct: s.endPct, type: 'session', session: s });
    lastEnd = s.endPct;
  }
  // Remaining is offline (up to current time or end of day)
  const endPct = currentHour >= dayEnd ? 100 : currentPct;
  if (lastEnd < endPct - 0.5) {
    segments.push({ startPct: lastEnd, endPct, type: 'offline' });
  }

  // Hour markers
  const hours = [];
  for (let h = dayStart; h <= dayEnd; h++) {
    hours.push({ hour: h, pct: ((h - dayStart) / totalHours) * 100 });
  }

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-dark-500 text-[10px]">Сьогодні</span>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1 text-dark-500">
            <span className="w-2 h-2 rounded-sm bg-green-500/60" /> заїзд
          </span>
          <span className="flex items-center gap-1 text-dark-500">
            <span className="w-2 h-2 rounded-sm bg-red-500/30" /> офлайн
          </span>
          {isTimingOnline && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> live
            </span>
          )}
        </div>
      </div>

      {/* Timeline bar */}
      <div className="relative h-7 bg-dark-800 rounded-md overflow-hidden">
        {/* Segments */}
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${
              seg.type === 'session' ? 'bg-green-500/25 border-x border-green-500/40' : 'bg-red-500/10'
            }`}
            style={{ left: `${seg.startPct}%`, width: `${Math.max(seg.endPct - seg.startPct, 0.3)}%` }}
          />
        ))}

        {/* Session labels */}
        {parsedSessions.map((s) => {
          const midPct = (s.startPct + s.endPct) / 2;
          return (
            <Link
              key={s.id}
              to={`/sessions/${s.id}`}
              className="absolute top-0 h-full flex items-center justify-center z-10 hover:bg-green-500/20 transition-colors group"
              style={{ left: `${s.startPct}%`, width: `${Math.max(s.endPct - s.startPct, 3)}%` }}
              title={`Заїзд #${s.number} (${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)})${s.competitionName ? ' • ' + s.competitionName : ''}`}
            >
              <span className="text-[9px] font-bold font-mono text-green-400 group-hover:text-green-300">
                {s.number}
              </span>
            </Link>
          );
        })}

        {/* Current time marker */}
        {currentPct > 0 && currentPct < 100 && (
          <div
            className="absolute top-0 h-full w-[2px] bg-white/60 z-20"
            style={{ left: `${currentPct}%` }}
          />
        )}
      </div>

      {/* Hour labels */}
      <div className="relative h-3 mt-0.5">
        {hours.filter((_, i) => i % 2 === 0 || totalHours <= 8).map((h) => (
          <span
            key={h.hour}
            className="absolute text-[8px] font-mono text-dark-600 -translate-x-1/2"
            style={{ left: `${h.pct}%` }}
          >
            {h.hour}
          </span>
        ))}
      </div>
    </div>
  );
}
