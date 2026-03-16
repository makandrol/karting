import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ALL_COMPETITION_EVENTS } from '../../mock/competitionEvents';

const FORMAT_MAP: Record<string, string> = {
  gonzales: 'gonzales', light_league: 'light-league', champions_league: 'champions-league',
};
const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

/** Parse YYYY-MM-DD as local date (not UTC) */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDateShort(d: string): string {
  const dt = parseLocalDate(d);
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
}

function fmtDayBtn(d: string): string {
  const dt = parseLocalDate(d);
  return `${DAY_NAMES[dt.getDay()]} ${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/** Pseudo-random time from id string (deterministic) with seconds */
function fmtTime(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  const hour = 10 + (h % 13); // 10..22
  const min = (h >> 4) % 60;
  const sec = (h >> 8) % 60;
  return `${hour}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function SessionsList() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const allDates = useMemo(() => {
    const set = new Set(ALL_COMPETITION_EVENTS.map(e => e.date));
    return [...set].sort().reverse();
  }, []);

  const [selectedDate, setSelectedDate] = useState(allDates[0] || todayStr);

  // Week boundaries (Monday start)
  const thisMonday = getMonday(today);
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);

  const thisWeekDates: string[] = [];
  const prevWeekDates: string[] = [];
  const olderByYearMonth = new Map<string, Map<string, string[]>>();

  for (const d of allDates) {
    const dt = parseLocalDate(d);
    if (dt >= thisMonday) {
      thisWeekDates.push(d);
    } else if (dt >= prevMonday) {
      prevWeekDates.push(d);
    } else {
      const year = String(dt.getFullYear());
      const month = String(dt.getMonth());
      if (!olderByYearMonth.has(year)) olderByYearMonth.set(year, new Map());
      const months = olderByYearMonth.get(year)!;
      if (!months.has(month)) months.set(month, []);
      months.get(month)!.push(d);
    }
  }

  // Expand state: previous week collapsed, current year collapsed (months expanded when opened)
  const [prevWeekOpen, setPrevWeekOpen] = useState(false);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [hideProkat, setHideProkat] = useState(false);

  const toggleYear = (y: string) => {
    const next = new Set(expandedYears);
    next.has(y) ? next.delete(y) : next.add(y);
    setExpandedYears(next);
  };

  const events = ALL_COMPETITION_EVENTS.filter(e => e.date === selectedDate);

  const DateBtn = ({ d, label }: { d: string; label?: string }) => {
    const hasEvents = allDates.includes(d);
    const isToday = d === todayStr;
    return (
      <button
        onClick={() => hasEvents && setSelectedDate(d)}
        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          d === selectedDate ? 'bg-primary-600 text-white' :
          isToday ? 'bg-primary-600/20 text-primary-400' :
          hasEvents ? 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700' :
          'bg-dark-900 text-dark-700 cursor-default'
        }`}
      >
        {label || fmtDayBtn(d)}
        {isToday && d !== selectedDate && <span className="ml-1 text-[9px]">•</span>}
      </button>
    );
  };

  // Generate week days Mon-Sun (only up to today)
  const weekDays = (monday: Date) => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }).filter(d => d <= todayStr);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">📅 Заїзди</h1>

      {/* Date navigation */}
      <div className="card p-3 space-y-3">
        {/* This week */}
        <div>
          <div className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Цей тиждень</div>
          <div className="flex flex-wrap gap-1.5">
            {weekDays(thisMonday).map(d => <DateBtn key={d} d={d} />)}
          </div>
        </div>

        {/* Previous week — collapsed by default */}
        {prevWeekDates.length > 0 && (
          <div>
            <button
              onClick={() => setPrevWeekOpen(v => !v)}
              className="flex items-center gap-1.5 text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5 hover:text-dark-300 transition-colors"
            >
              <span className={`transition-transform text-[8px] ${prevWeekOpen ? 'rotate-90' : ''}`}>▶</span>
              Попередній тиждень
            </button>
            {prevWeekOpen && (
              <div className="flex flex-wrap gap-1.5">
                {weekDays(prevMonday).map(d => <DateBtn key={d} d={d} />)}
              </div>
            )}
          </div>
        )}

        {/* Older — years collapsed by default, months always expanded */}
        {[...olderByYearMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => (
                <div key={year}>
                  <button
                    onClick={() => toggleYear(year)}
                    className="flex items-center gap-1.5 text-dark-300 hover:text-white text-xs font-medium transition-colors"
                  >
                    <span className={`text-[10px] transition-transform ${expandedYears.has(year) ? 'rotate-90' : ''}`}>▶</span>
                    {year}
                    <span className="text-dark-600 text-[10px]">({[...months.values()].flat().length})</span>
                  </button>

                  {expandedYears.has(year) && (
                    <div className="ml-4 mt-1 space-y-2">
                      {[...months.entries()].sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([monthIdx, dates]) => (
                        <div key={monthIdx}>
                          <div className="text-dark-400 text-[10px] font-medium mb-1">
                            {MONTH_NAMES[parseInt(monthIdx)]}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {dates.sort().reverse().map(d => <DateBtn key={d} d={d} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
      </div>

      {/* Events for selected date */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-dark-300 text-sm font-semibold">
            {selectedDate === todayStr ? 'Сьогодні' : fmtDateShort(selectedDate)}
          </h2>
          <label className="flex items-center gap-1.5 text-dark-500 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideProkat}
              onChange={(e) => setHideProkat(e.target.checked)}
              className="w-3 h-3 rounded border-dark-600 bg-dark-800 text-primary-500 focus:ring-0"
            />
            сховати прокат
          </label>
        </div>

        {events.length === 0 ? (
          <div className="card text-center py-6 text-dark-500 text-sm">Немає заїздів</div>
        ) : (
          <div className="space-y-0.5">
            {(() => {
              const rows: React.ReactNode[] = [];
              let currentTrack = -1;

              const filteredEvents = hideProkat
                ? events.filter(ev => ['gonzales', 'light_league', 'champions_league'].includes(ev.format))
                : events;

              filteredEvents.forEach((ev) => {
                // Track header/change
                if (ev.trackConfigId !== currentTrack) {
                  currentTrack = ev.trackConfigId;
                  rows.push(
                    <div key={`track-${ev.id}`} className="text-dark-400 text-xs font-semibold pt-2 pb-1 px-1">
                      Траса {currentTrack}
                    </div>
                  );
                }

                const urlType = FORMAT_MAP[ev.format] || ev.format;
                const isCompetition = ['gonzales', 'light_league', 'champions_league'].includes(ev.format);
                const compName = ev.format === 'light_league' ? 'ЛЛ' :
                                 ev.format === 'champions_league' ? 'ЛЧ' :
                                 ev.format === 'gonzales' ? 'Гонзалес' : ev.name;

                if (!isCompetition) {
                  const bestPilot = ev.phases[0]?.results?.[0];
                  rows.push(
                    <Link key={ev.id} to={`/sessions/${ev.id}`}
                      className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-dark-700/50 transition-colors group"
                    >
                      <span className="text-dark-400 text-sm group-hover:text-white transition-colors">
                        <span className="text-white font-mono text-xs">{fmtTime(ev.id)}</span>, Прокат
                      </span>
                      {bestPilot && (
                        <span className="text-dark-500 text-xs font-mono shrink-0 ml-4">
                          {bestPilot.pilot.split(' ')[0]} — <span className="text-green-400">{bestPilot.bestLap}</span>
                        </span>
                      )}
                    </Link>
                  );
                } else {
                  ev.phases.forEach((phase) => {
                    const bestPilot = phase.results?.[0];
                    const href = `/results/${urlType}/${ev.id}/${phase.id}`;
                    rows.push(
                      <Link key={`${ev.id}-${phase.id}`} to={href}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-dark-700/50 transition-colors group"
                      >
                        <span className="text-dark-300 text-sm group-hover:text-white transition-colors">
                          <span className="text-white font-mono text-xs">{fmtTime(ev.id + phase.id)}</span>, {compName}, {phase.name}
                        </span>
                        {bestPilot && (
                          <span className="text-dark-500 text-xs font-mono shrink-0 ml-4">
                            {bestPilot.pilot.split(' ')[0]} — <span className="text-green-400">{bestPilot.bestLap}</span>
                          </span>
                        )}
                      </Link>
                    );
                  });
                }
              });

              return rows;
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
