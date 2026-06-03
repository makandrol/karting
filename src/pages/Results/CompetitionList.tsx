/**
 * Competition list page — date navigator + format filters + sortable list.
 * Extracted from CompetitionPage.tsx (260 LOC).
 */

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../services/auth';
import { api, normalizeCompetition } from '../../services/api';
import { trackDisplayId } from '../../data/tracks';
import { COMPETITION_CONFIGS } from '../../data/competitions';
import { loadWithExpiry, saveWithExpiry, shortName } from '../../utils/timing';
import type { Competition } from './competition-types';
import {
  FORMAT_FILTERS, COMP_LIST_NAMES, DAY_NAMES, MONTH_NAMES,
  localDateStr, getCompRealDate, getMonday, getWeekDays, getWeeksInMonth,
} from './competition-utils';

export default function CompetitionList({ competitions: initialCompetitions, initialFilter }: {
  competitions: Competition[]; initialFilter?: string;
}) {
  const { user } = useAuth();
  const storage = user ? localStorage : sessionStorage;
  const [competitions, setCompetitions] = useState(initialCompetitions);

  useEffect(() => { setCompetitions(initialCompetitions); }, [initialCompetitions]);

  const [activeFilters, setActiveFilters] = useState<Set<string>>(() => {
    if (initialFilter) return new Set([initialFilter]);
    const saved = loadWithExpiry(storage, 'karting_comp_filters');
    if (Array.isArray(saved) && saved.length > 0) return new Set(saved);
    return new Set(FORMAT_FILTERS.map(f => f.key));
  });

  const [sortDir, setSortDir] = useState<'desc' | 'asc'>(() => {
    const saved = loadWithExpiry(storage, 'karting_comp_sort');
    return saved === 'asc' ? 'asc' : 'desc';
  });

  const compDates = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of competitions) map.set(c.id, getCompRealDate(c));
    return map;
  }, [competitions]);

  const dateCompNames = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of competitions) {
      const d = compDates.get(c.id) || '';
      if (!d) continue;
      const cfg = COMPETITION_CONFIGS[c.format as keyof typeof COMPETITION_CONFIGS];
      const name = cfg?.shortName || c.format;
      if (!map[d]) map[d] = [];
      if (!map[d].includes(name)) map[d].push(name);
    }
    return map;
  }, [competitions, compDates]);

  const allCompDates = useMemo(() => [...new Set(competitions.map(c => compDates.get(c.id) || '').filter(Boolean))].sort().reverse(), [competitions, compDates]);

  const thisMonday = getMonday(new Date());
  const prevMonday = new Date(thisMonday);
  prevMonday.setDate(prevMonday.getDate() - 7);
  const thisWeekDays = getWeekDays(thisMonday);
  const prevWeekDays = getWeekDays(prevMonday);
  const todayStr = localDateStr(new Date());

  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => {
    const saved = loadWithExpiry(storage, 'karting_comp_dates');
    if (Array.isArray(saved) && saved.length > 0) return new Set(saved);
    return new Set(allCompDates);
  });

  useEffect(() => {
    if (selectedDates.size === 0 && allCompDates.length > 0) {
      setSelectedDates(new Set(allCompDates));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateCompNames]);

  const saveDates = (dates: Set<string>) => saveWithExpiry(storage, 'karting_comp_dates', [...dates]);
  const toggleDate = (d: string) => {
    setSelectedDates(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); saveDates(n); return n; });
  };
  const selectDates = (dates: string[]) => {
    setSelectedDates(prev => { const n = new Set(prev); dates.forEach(d => n.add(d)); saveDates(n); return n; });
  };

  const [prevWeekOpen, setPrevWeekOpen] = useState(() => [...selectedDates].some(d => new Set(prevWeekDays).has(d)));
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const saveFilters = (filters: Set<string>) => saveWithExpiry(storage, 'karting_comp_filters', [...filters]);
  const toggleFilter = (key: string) => {
    setActiveFilters(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      saveFilters(n); return n;
    });
  };
  const allActive = activeFilters.size === FORMAT_FILTERS.length;
  const toggleAll = () => {
    if (allActive) { setActiveFilters(new Set()); saveFilters(new Set()); }
    else { const all = new Set(FORMAT_FILTERS.map(f => f.key)); setActiveFilters(all); saveFilters(all); }
  };
  const toggleSort = () => { const next = sortDir === 'desc' ? 'asc' : 'desc'; setSortDir(next); saveWithExpiry(storage, 'karting_comp_sort', next); };

  const filtered = competitions
    .filter(c => activeFilters.has(c.format))
    .filter(c => selectedDates.size === 0 || selectedDates.has(compDates.get(c.id) || ''))
    .sort((a, b) => {
      if (a.status === 'live' && b.status !== 'live') return -1;
      if (a.status !== 'live' && b.status === 'live') return 1;
      const cmp = (compDates.get(a.id) || '').localeCompare(compDates.get(b.id) || '');
      return sortDir === 'desc' ? -cmp : cmp;
    });

  const DateBtn = ({ d }: { d: string }) => {
    const isToday = d === todayStr;
    const names = dateCompNames[d] || [];
    const hasData = names.length > 0;
    const isActive = selectedDates.has(d);
    const dayDate = new Date(d + 'T00:00:00');
    const label = `${DAY_NAMES[dayDate.getDay()]} ${String(dayDate.getDate()).padStart(2, '0')}.${String(dayDate.getMonth() + 1).padStart(2, '0')}`;
    return (
      <button
        onClick={() => hasData && toggleDate(d)}
        className={`flex flex-col items-center px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
          isActive ? 'bg-primary-600 text-white ring-1 ring-primary-400' :
          isToday ? 'bg-green-600/20 text-green-400' :
          hasData ? 'bg-dark-800 text-dark-300 hover:text-white hover:bg-dark-700' :
          'bg-dark-900 text-dark-700 cursor-default'
        }`}
      >
        <span>{label}</span>
        <span className={`text-[9px] ${isActive ? 'text-white/70' : 'text-dark-500'}`}>{hasData ? names.join(', ') : '–'}</span>
      </button>
    );
  };

  const SelectAllBtn = ({ dates }: { dates: string[] }) => {
    const withData = dates.filter(d => dateCompNames[d]);
    const notSelected = withData.filter(d => !selectedDates.has(d));
    if (notSelected.length === 0) return null;
    return (
      <button onClick={(e) => { e.stopPropagation(); selectDates(withData); }}
        className="bg-primary-600/20 text-primary-400 hover:bg-primary-600/40 text-[11px] font-bold rounded px-1.5 py-0.5 transition-colors ml-1.5 leading-none">
        +{notSelected.length}
      </button>
    );
  };

  const yearMonths = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const d of allCompDates) {
      const thisSet = new Set(thisWeekDays);
      const prevSet = new Set(prevWeekDays);
      if (thisSet.has(d) || prevSet.has(d)) continue;
      const y = d.slice(0, 4);
      const m = parseInt(d.slice(5, 7)) - 1;
      if (!map.has(y)) map.set(y, new Set());
      map.get(y)!.add(m);
    }
    const currentYear = String(new Date().getFullYear());
    for (const d of [...thisWeekDays, ...prevWeekDays]) {
      if (!dateCompNames[d]) continue;
      const y = d.slice(0, 4);
      if (y === currentYear) continue;
      const m = parseInt(d.slice(5, 7)) - 1;
      if (!map.has(y)) map.set(y, new Set());
      map.get(y)!.add(m);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCompDates, dateCompNames]);

  return (
    <div className="space-y-4">
      <div className="card p-3 space-y-3">
        <div>
          <div className="text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center">
            Цей тиждень
            <SelectAllBtn dates={thisWeekDays} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {thisWeekDays.map(d => <DateBtn key={d} d={d} />)}
          </div>
        </div>
        {prevWeekDays.length > 0 && (
          <div>
            <button onClick={() => setPrevWeekOpen(v => !v)}
              className="flex items-center gap-1.5 text-dark-500 text-[10px] font-semibold uppercase tracking-wider mb-1.5 hover:text-dark-300 transition-colors">
              <span className={`transition-transform text-[8px] ${prevWeekOpen ? 'rotate-90' : ''}`}>&#9654;</span>
              Попередній тиждень
              <SelectAllBtn dates={prevWeekDays} />
            </button>
            {prevWeekOpen && (
              <div className="flex flex-wrap gap-1.5">
                {prevWeekDays.map(d => <DateBtn key={d} d={d} />)}
              </div>
            )}
          </div>
        )}
        {[...yearMonths.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, months]) => {
          const currentYear = String(new Date().getFullYear());
          const yearDates = allCompDates.filter(d => {
            if (!d.startsWith(year)) return false;
            if (year === currentYear) return !new Set(thisWeekDays).has(d) && !new Set(prevWeekDays).has(d);
            return true;
          });
          return (
            <div key={year}>
              <button onClick={() => { const n = new Set(expandedYears); n.has(year) ? n.delete(year) : n.add(year); setExpandedYears(n); }}
                className="flex items-center gap-1.5 text-dark-300 hover:text-white text-xs font-medium transition-colors">
                <span className={`text-[10px] transition-transform ${expandedYears.has(year) ? 'rotate-90' : ''}`}>&#9654;</span>
                {year}
                <SelectAllBtn dates={yearDates} />
              </button>
              {expandedYears.has(year) && (
                <div className="ml-4 mt-1 space-y-2">
                  {[...months].sort((a, b) => b - a).map(month => {
                    const monthKey = `${year}-${month}`;
                    const weeks = getWeeksInMonth(parseInt(year), month);
                    const monthDates = yearDates.filter(d => d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`));
                    return (
                      <div key={monthKey}>
                        <button onClick={() => { const n = new Set(expandedMonths); n.has(monthKey) ? n.delete(monthKey) : n.add(monthKey); setExpandedMonths(n); }}
                          className="flex items-center gap-1.5 text-dark-400 hover:text-white text-xs transition-colors">
                          <span className={`text-[8px] transition-transform ${expandedMonths.has(monthKey) ? 'rotate-90' : ''}`}>&#9654;</span>
                          {MONTH_NAMES[month]}
                          <SelectAllBtn dates={monthDates} />
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
      <div className="flex gap-1 flex-wrap items-center">
        <button onClick={toggleAll}
          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${allActive ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>
          Все
        </button>
        {FORMAT_FILTERS.map(f => (
          <button key={f.key} onClick={() => toggleFilter(f.key)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${activeFilters.has(f.key) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600 hover:text-dark-400'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={toggleSort}
          className="px-2 py-1 rounded text-xs font-medium bg-dark-800 text-dark-500 hover:text-dark-300 transition-colors ml-1">
          Дата {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="card text-center py-12 text-dark-500">Немає змагань</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <CompetitionListItem key={c.id} competition={c} type={c.format} onDelete={(id) => setCompetitions(prev => prev.filter(x => x.id !== id))} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompetitionListItem({ competition: c, type, onDelete }: {
  competition: Competition; type: string; onDelete?: (id: string) => void;
}) {
  const { isOwner } = useAuth();
  const [confirming, setConfirming] = useState(false);

  const results = normalizeCompetition(c as any)?.results ?? {};
  const isGonzales = c.format === 'gonzales';
  let top3: { pilot: string; value: number }[] = [];
  try {
    const pilots = results?.standings?.pilots;
    if (Array.isArray(pilots)) {
      if (isGonzales) {
        top3 = pilots
          .filter((p: any) => p.averageTime != null)
          .sort((a: any, b: any) => a.averageTime - b.averageTime)
          .slice(0, 3)
          .map((p: any) => ({ pilot: p.pilot, value: p.averageTime }));
      } else {
        top3 = pilots.slice(0, 3).map((p: any) => ({ pilot: p.pilot, value: p.totalPoints }));
      }
    }
  } catch {}

  const compDate = (() => {
    if (c.sessions.length > 0) {
      const m = c.sessions[0].sessionId.match(/session-(\d+)/);
      if (m) {
        const d = new Date(parseInt(m[1]));
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
    }
    return c.date || '';
  })();

  const trackId = results?.trackId;
  const compLabel = (COMP_LIST_NAMES[c.format] || c.format) + (trackId != null ? `, ${trackDisplayId(trackId)}` : '');

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    try {
      await api.competitions.remove(c.id);
      onDelete?.(c.id);
    } catch {}
    setConfirming(false);
  };

  return (
    <Link to={`/results/${type}/${c.id}`}
      className="card px-4 py-2.5 block hover:bg-dark-700/50 transition-colors">
      <div className="flex items-center gap-3">
        <span className="text-white font-semibold text-sm w-[11em] shrink-0">{compDate}, {compLabel}</span>
        {c.status === 'live' && (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-500/15 text-green-400 shrink-0">
            Live
          </span>
        )}
        {top3.length > 0 && (
          <div className="flex flex-col text-xs font-mono min-w-0">
            {top3.map((p, i) => (
              <span key={p.pilot} className="flex items-center gap-1 whitespace-nowrap leading-tight">
                <span className={i === 0 ? 'text-yellow-400' : i === 1 ? 'text-dark-400' : 'text-amber-700'}>{i + 1}.</span>
                <span className="text-white inline-block w-[12ch] truncate">{shortName(p.pilot)}</span>
                <span className="text-green-400 tabular-nums">{isGonzales ? `${p.value.toFixed(2)}с` : p.value}</span>
              </span>
            ))}
          </div>
        )}
        {isOwner && (
          <button
            onClick={handleDelete}
            onBlur={() => setConfirming(false)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0 ${
              confirming ? 'bg-red-600 text-white' : 'text-dark-600 hover:text-red-400'
            }`}
            title="Видалити змагання">
            {confirming ? 'Точно?' : '✕'}
          </button>
        )}
      </div>
    </Link>
  );
}
