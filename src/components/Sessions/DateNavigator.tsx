import { useState, useEffect } from 'react';
import { COLLECTOR_URL } from '../../services/config';

const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function getWeekDays(monday: Date): string[] {
  const todayStr = localDateStr(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return localDateStr(d);
  }).filter(d => d <= todayStr);
}

function getWeeksInMonth(year: number, month: number): string[][] {
  const todayStr = localDateStr(new Date());
  const firstDay = new Date(year, month, 1);
  const monday = getMonday(firstDay);
  const weeks: string[][] = [];

  for (let w = 0; w < 6; w++) {
    const weekStart = new Date(monday);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const days = getWeekDays(weekStart).filter(d => {
      const dd = new Date(d + 'T00:00:00');
      return dd.getMonth() === month && d <= todayStr;
    });
    if (days.length > 0) weeks.push(days);
  }
  return weeks;
}

interface DateNavigatorProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  statSessionIds?: Set<string>;
  onAddDateSessions?: (dates: string[]) => void;
}

function countStatSessionsForDates(statSessionIds: Set<string>, dates: string[]): number {
  const dateSet = new Set(dates);
  let count = 0;
  for (const id of statSessionIds) {
    const m = id.match(/session-(\d+)/);
    if (m) {
      const d = new Date(parseInt(m[1]));
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (dateSet.has(ds)) count++;
    }
  }
  return count;
}

export default function DateNavigator({ selectedDate, onSelectDate, statSessionIds, onAddDateSessions }: DateNavigatorProps) {
  const todayStr = localDateStr(new Date());
  const thisMonday = getMonday(new Date());
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);

  const [dateCounts, setDateCounts] = useState<Record<string, number>>({});
  const [prevWeekOpen, setPrevWeekOpen] = useState(false);
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  // Fetch session counts for all time
  useEffect(() => {
    fetch(`${COLLECTOR_URL}/db/session-counts?from=2020-01-01&to=${todayStr}`)
      .then(r => r.json())
      .then((data: { date: string; count: number }[]) => {
        const map: Record<string, number> = {};
        for (const d of data) map[d.date] = d.count;
        setDateCounts(map);
      })
      .catch(() => {});
  }, []);

  const toggleYear = (y: string) => {
    const next = new Set(expandedYears);
    next.has(y) ? next.delete(y) : next.add(y);
    setExpandedYears(next);
  };

  const toggleMonth = (key: string) => {
    const next = new Set(expandedMonths);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedMonths(next);
  };

  // Build year > month structure from ALL dates with data
  const allDatesWithData = Object.keys(dateCounts).sort().reverse();
  const yearMonths = new Map<string, Set<number>>();
  for (const d of allDatesWithData) {
    const y = d.slice(0, 4);
    const m = parseInt(d.slice(5, 7)) - 1;
    if (!yearMonths.has(y)) yearMonths.set(y, new Set());
    yearMonths.get(y)!.add(m);
  }
  // Always include current year even if no data yet
  const currentYear = String(new Date().getFullYear());
  if (!yearMonths.has(currentYear)) yearMonths.set(currentYear, new Set([new Date().getMonth()]));

  const DateBtn = ({ d }: { d: string }) => {
    const isToday = d === todayStr;
    const isSelected = d === selectedDate;
    const count = dateCounts[d] ?? 0;
    const hasData = count > 0 || isToday;
    const dayDate = new Date(d + 'T00:00:00');
    const label = `${DAY_NAMES[dayDate.getDay()]} ${String(dayDate.getDate()).padStart(2, '0')}.${String(dayDate.getMonth() + 1).padStart(2, '0')}`;
    const statCount = statSessionIds ? countStatSessionsForDates(statSessionIds, [d]) : null;
    const canAdd = onAddDateSessions && count > 0 && statCount !== null && statCount < count;
    return (
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => hasData && onSelectDate(d)}
          className={`flex flex-col items-center px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
            isSelected ? 'bg-primary-600 text-white' :
            isToday ? 'bg-primary-600/20 text-primary-400' :
            hasData ? 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700' :
            'bg-dark-900 text-dark-700 cursor-default'
          }`}
        >
          <span>{label}</span>
          {count > 0 && (
            <span className={`text-[9px] font-mono ${isSelected ? 'text-white/70' : 'text-dark-500'}`}>
              {statCount !== null ? `${statCount}/${count}` : count}
            </span>
          )}
        </button>
        {canAdd && (
          <button
            onClick={() => onAddDateSessions!([d])}
            title="Додати всі заїзди в статистику"
            className="text-primary-500/50 hover:text-primary-400 text-[10px] transition-colors px-0.5"
          >+</button>
        )}
      </div>
    );
  };

  const thisWeekDays = getWeekDays(thisMonday);
  const prevWeekDays = getWeekDays(prevMonday);
  const thisWeekCount = thisWeekDays.reduce((s, d) => s + (dateCounts[d] || 0), 0);
  const prevWeekCount = prevWeekDays.reduce((s, d) => s + (dateCounts[d] || 0), 0);
  const thisWeekStatCount = statSessionIds ? countStatSessionsForDates(statSessionIds, thisWeekDays) : null;
  const prevWeekStatCount = statSessionIds ? countStatSessionsForDates(statSessionIds, prevWeekDays) : null;

  const PeriodCount = ({ stat, total }: { stat: number | null; total: number }) => (
    <span className="text-dark-600 normal-case"> ({stat !== null ? `${stat}/${total}` : total})</span>
  );

  const AddBtn = ({ dates }: { dates: string[] }) => {
    if (!onAddDateSessions || !statSessionIds) return null;
    const total = dates.reduce((s, d) => s + (dateCounts[d] || 0), 0);
    const stat = countStatSessionsForDates(statSessionIds, dates);
    if (total === 0 || stat >= total) return null;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onAddDateSessions(dates); }}
        title="Додати всі заїзди в статистику"
        className="text-primary-500/50 hover:text-primary-400 text-[10px] transition-colors ml-1"
      >+</button>
    );
  };

  return (
    <div className="card p-3 space-y-3">
      {/* This week */}
      <div>
        <div className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center">
          Цей тиждень<PeriodCount stat={thisWeekStatCount} total={thisWeekCount} />
          <AddBtn dates={thisWeekDays} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {thisWeekDays.map(d => <DateBtn key={d} d={d} />)}
        </div>
      </div>

      {/* Previous week */}
      <div>
        <button
          onClick={() => setPrevWeekOpen(v => !v)}
          className="flex items-center gap-1.5 text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5 hover:text-dark-300 transition-colors"
        >
          <span className={`transition-transform text-[8px] ${prevWeekOpen ? 'rotate-90' : ''}`}>&#9654;</span>
          Попередній тиждень<PeriodCount stat={prevWeekStatCount} total={prevWeekCount} />
          <AddBtn dates={prevWeekDays} />
        </button>
        {prevWeekOpen && (
          <div className="flex flex-wrap gap-1.5">
            {prevWeekDays.map(d => <DateBtn key={d} d={d} />)}
          </div>
        )}
      </div>

      {/* Older — by year > month > weeks */}
      {[...yearMonths.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => {
        const yearDates = allDatesWithData.filter(d => d.startsWith(year));
        const yearCount = yearDates.reduce((s, d) => s + (dateCounts[d] || 0), 0);
        const yearStatCount = statSessionIds ? countStatSessionsForDates(statSessionIds, yearDates) : null;
        return (
          <div key={year}>
            <button
              onClick={() => toggleYear(year)}
              className="flex items-center gap-1.5 text-dark-300 hover:text-white text-xs font-medium transition-colors"
            >
              <span className={`text-[10px] transition-transform ${expandedYears.has(year) ? 'rotate-90' : ''}`}>&#9654;</span>
              {year}
              <span className="text-dark-600 text-[10px]">
                ({yearStatCount !== null ? `${yearStatCount}/${yearCount}` : yearCount})
              </span>
              <AddBtn dates={yearDates} />
            </button>

            {expandedYears.has(year) && (
              <div className="ml-4 mt-1 space-y-2">
                {[...months].sort((a, b) => b - a).map(month => {
                  const monthKey = `${year}-${month}`;
                  const weeks = getWeeksInMonth(parseInt(year), month);
                  const monthDates = allDatesWithData.filter(d => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
                  const monthCount = monthDates.reduce((s, d) => s + (dateCounts[d] || 0), 0);
                  const monthStatCount = statSessionIds ? countStatSessionsForDates(statSessionIds, monthDates) : null;

                  return (
                    <div key={monthKey}>
                      <button
                        onClick={() => toggleMonth(monthKey)}
                        className="flex items-center gap-1.5 text-dark-400 hover:text-white text-xs transition-colors"
                      >
                        <span className={`text-[8px] transition-transform ${expandedMonths.has(monthKey) ? 'rotate-90' : ''}`}>&#9654;</span>
                        {MONTH_NAMES[month]}
                        <span className="text-dark-600 text-[10px]">
                          ({monthStatCount !== null ? `${monthStatCount}/${monthCount}` : monthCount})
                        </span>
                        <AddBtn dates={monthDates} />
                      </button>

                      {expandedMonths.has(monthKey) && (
                        <div className="ml-3 mt-1 space-y-1">
                          {weeks.map((weekDays, wi) => (
                            <div key={wi} className="flex flex-wrap gap-1.5">
                              {weekDays.map(d => <DateBtn key={d} d={d} />)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
