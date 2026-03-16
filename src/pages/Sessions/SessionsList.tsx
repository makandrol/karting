import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ALL_COMPETITION_EVENTS } from '../../mock/competitionEvents';

const FORMAT_MAP: Record<string, string> = {
  gonzales: 'gonzales', light_league: 'light-league', champions_league: 'champions-league',
};
const FORMAT_ICON: Record<string, string> = {
  gonzales: '🏆', light_league: '⭐', champions_league: '👑',
};
const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtShort(d: string): string {
  const dt = new Date(d);
  return `${DAY_NAMES[dt.getDay()]} ${dt.getDate()}.${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export default function SessionsList() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // All unique dates with events
  const allDates = useMemo(() => {
    const set = new Set(ALL_COMPETITION_EVENTS.map(e => e.date));
    return [...set].sort().reverse();
  }, []);

  const [selectedDate, setSelectedDate] = useState(allDates[0] || todayStr);

  // Week boundaries
  const thisMonday = getMonday(today);
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);

  // Categorize dates
  const thisWeekDates: string[] = [];
  const prevWeekDates: string[] = [];
  const olderByYearMonth = new Map<string, Map<string, string[]>>(); // year → month → dates

  for (const d of allDates) {
    const dt = new Date(d);
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

  // Tree expand state — current year expanded by default
  const currentYear = String(new Date().getFullYear());
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set([currentYear]));
  const currentYearMonths = olderByYearMonth.get(currentYear);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => {
    const set = new Set<string>();
    if (currentYearMonths) {
      for (const monthIdx of currentYearMonths.keys()) {
        set.add(`${currentYear}-${monthIdx}`);
      }
    }
    return set;
  });

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
        {label || fmtShort(d)}
        {isToday && d !== selectedDate && <span className="ml-1 text-[9px]">•</span>}
      </button>
    );
  };

  // Generate days for a week (only up to today)
  const weekDays = (monday: Date) => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    }).filter(d => d <= todayStr);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">📅 Заїзди</h1>
        <p className="text-dark-400 text-sm">Історія змагань</p>
      </div>

      {/* Date navigation */}
      <div className="card p-3 space-y-3">
        {/* This week */}
        <div>
          <div className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Цей тиждень</div>
          <div className="flex flex-wrap gap-1.5">
            {weekDays(thisMonday).map(d => <DateBtn key={d} d={d} />)}
          </div>
        </div>

        {/* Previous week */}
        {prevWeekDates.length > 0 && (
          <div>
            <div className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Попередній тиждень</div>
            <div className="flex flex-wrap gap-1.5">
              {weekDays(prevMonday).map(d => <DateBtn key={d} d={d} />)}
            </div>
          </div>
        )}

        {/* Older — tree */}
        {olderByYearMonth.size > 0 && (
          <div>
            <div className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Архів</div>
            <div className="space-y-1">
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
                    <div className="ml-4 mt-1 space-y-1">
                      {[...months.entries()].sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([monthIdx, dates]) => {
                        const monthKey = `${year}-${monthIdx}`;
                        return (
                          <div key={monthKey}>
                            <button
                              onClick={() => toggleMonth(monthKey)}
                              className="flex items-center gap-1.5 text-dark-400 hover:text-white text-xs transition-colors"
                            >
                              <span className={`text-[10px] transition-transform ${expandedMonths.has(monthKey) ? 'rotate-90' : ''}`}>▶</span>
                              {MONTH_NAMES[parseInt(monthIdx)]}
                              <span className="text-dark-600 text-[10px]">({dates.length})</span>
                            </button>

                            {expandedMonths.has(monthKey) && (
                              <div className="ml-4 mt-1 flex flex-wrap gap-1.5">
                                {dates.sort().reverse().map(d => <DateBtn key={d} d={d} />)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Events for selected date */}
      <div>
        <h2 className="text-dark-300 text-sm font-semibold mb-3">
          {selectedDate === todayStr ? 'Сьогодні' : fmtDate(selectedDate)}
        </h2>

        {events.length === 0 ? (
          <div className="card text-center py-8 text-dark-500 text-sm">Немає змагань за цей день</div>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => {
              const urlType = FORMAT_MAP[ev.format] || ev.format;
              const dateFormatted = fmtDate(ev.date);
              return (
                <Link key={ev.id} to={`/results/${urlType}/${ev.id}`}
                  className="card flex items-center justify-between hover:border-dark-600 transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-dark-800 rounded-xl flex items-center justify-center text-xl group-hover:bg-primary-600 transition-colors">
                      {FORMAT_ICON[ev.format] || '📊'}
                    </div>
                    <div>
                      <div className="text-white font-semibold group-hover:text-primary-400 transition-colors">
                        {ev.name.replace(/(\d{2}\.\d{2})/, dateFormatted)}
                        {!ev.name.includes('20') && ` ${dateFormatted}`}
                      </div>
                      <div className="text-dark-500 text-xs">
                        Траса {ev.trackConfigId} • {ev.phases.length} фаз • {ev.phases[0]?.results?.length || 0} пілотів
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
