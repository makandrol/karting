import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, type DbSession } from '../../services/api';
import { toSeconds } from '../../utils/timing';
import { fmtDateTimeShort as fmtDate } from '../../utils/datetime';
import { useLocalStorage } from '../../services/useLocalStorage';
import { useKartFilters, useSelectedDateSessions } from '../../services/useKartFilters';
import { COMPETITION_CONFIGS, getPhaseShortLabel } from '../../data/competitions';
import { buildGonzalesKartPilotMap } from '../../utils/gonzalesPilotResolver';
import DateNavigator from '../../components/Sessions/DateNavigator';
import SessionsTable from '../../components/Sessions/SessionsTable';
import TrackFilter from '../../components/Sessions/TrackFilter';

interface KartStat {
  kart: number;
  top5: {
    pilot: string;
    resolved_pilot?: string | null;
    lap_time: string | null;
    lap_sec: number | null;
    s1: string | null;
    s2: string | null;
    ts: number | null;
    session_id: string | null;
    tb_s1: string | null;
    tb_s2: string | null;
    tb_sec: number | null;
  }[];
}

type SortMode = 'best' | 'tb' | 'number';

interface KartsFilters {
  sortMode: SortMode;
  topN: number;
  displayLaps: number;
  showDisabled: boolean;
}

const DEFAULT_FILTERS: KartsFilters = {
  sortMode: 'best',
  topN: 1,
  displayLaps: 3,
  showDisabled: false,
};

export default function Karts() {
  const [filters, setFilters] = useLocalStorage<KartsFilters>('karting_karts_filters', DEFAULT_FILTERS);
  const { topN, showDisabled } = filters;
  // Fallback на дефолт для користувачів зі старим збереженим стейтом без цих полів.
  const displayLaps = filters.displayLaps ?? DEFAULT_FILTERS.displayLaps;
  const sortMode: SortMode = filters.sortMode ?? DEFAULT_FILTERS.sortMode;
  const setSortMode = (v: SortMode) => setFilters(f => ({ ...f, sortMode: v }));
  const setTopN = (v: number) => setFilters(f => ({ ...f, topN: v }));
  const setDisplayLaps = (v: number) => setFilters(f => ({ ...f, displayLaps: v }));
  const setShowDisabled = (v: boolean | ((p: boolean) => boolean)) =>
    setFilters(f => ({ ...f, showDisabled: typeof v === 'function' ? v(f.showDisabled) : v }));

  const [topNInput, setTopNInput] = useState(() => String(filters.topN));
  const [topNPrev, setTopNPrev] = useState(() => String(filters.topN));
  const [displayLapsInput, setDisplayLapsInput] = useState(() => String(filters.displayLaps ?? DEFAULT_FILTERS.displayLaps));
  const [displayLapsPrev, setDisplayLapsPrev] = useState(() => String(filters.displayLaps ?? DEFAULT_FILTERS.displayLaps));

  const {
    todayStr,
    selectedDates, toggleDate: handleToggleDate, selectDates: handleSelectDates, clearDates: clearAllDates,
    selectedTracks, trackFilter, toggleTrack, selectAllTracks, clearAllTracks,
    excludedSessions, toggleExcludeSession,
  } = useKartFilters();

  // Сесії вибраних днів (raw, без фільтра трас) — спільний хук.
  const { sessions: statSessionDetails } = useSelectedDateSessions(selectedDates);

  // Заїзди вибраних днів на вибраних трасах (для таблиці).
  const visibleSessions = useMemo(
    () => statSessionDetails.filter(s => selectedTracks.has(s.track_id || 1)),
    [statSessionDetails, selectedTracks],
  );

  // ID заїздів для статистики: на вибраних трасах та не виключені вручну.
  const statSessionIds = useMemo(
    () => new Set(visibleSessions.filter(s => !excludedSessions.has(s.id)).map(s => s.id)),
    [visibleSessions, excludedSessions],
  );
  // Стабільний ключ для повторних запитів статистики (sorted ids).
  const statSessionsKey = useMemo(() => [...statSessionIds].sort().join(','), [statSessionIds]);

  // Kart stats from selected sessions
  const [kartStats, setKartStats] = useState<KartStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = statSessionsKey ? statSessionsKey.split(',') : [];
    if (ids.length === 0) { setKartStats([]); return; }
    setLoading(true);
    api.karts.statsBySessions(ids)
      .then(setKartStats)
      .catch(() => setKartStats([]))
      .finally(() => { setLoading(false); });
  }, [statSessionsKey]);

  // Competitions (для типу заїзду + резолву пілота Гонзалеса з "Карт N").
  const [competitions, setCompetitions] = useState<any[]>([]);
  useEffect(() => {
    api.competitions.list().then(d => setCompetitions(d as any[])).catch(() => setCompetitions([]));
  }, []);

  // session_id → деталі сесії (включно з merged sub-ids на parent).
  const sessionMeta = useMemo(() => {
    const map = new Map<string, DbSession>();
    for (const s of statSessionDetails) {
      map.set(s.id, s);
      if (s.merged_session_ids) for (const sub of s.merged_session_ids) map.set(sub, s);
    }
    return map;
  }, [statSessionDetails]);

  // (session_id|kart) → real pilot для round-сесій Гонзалеса.
  const gonzalesPilotMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of competitions) {
      if (c.format !== 'gonzales') continue;
      const cfg = c.results?.gonzalesConfig;
      if (!cfg?.pilotStartSlots) continue;
      const roundSessions = (c.sessions || []).filter((s: any) => s.phase && /^round_\d+/.test(s.phase));
      if (roundSessions.length === 0) continue;
      const pilotCount = Object.keys(cfg.pilotStartSlots).length;
      const karts = cfg.kartList && cfg.kartList.length > 0
        ? cfg.kartList
        : Array.from({ length: 12 }, (_, i) => i + 1);
      const sub = buildGonzalesKartPilotMap(
        roundSessions.map((s: any) => ({ sessionId: s.sessionId, phase: s.phase })),
        cfg,
        karts,
        pilotCount,
      );
      for (const [k, v] of sub) map.set(k, v);
    }
    return map;
  }, [competitions]);

  /** Display-ім'я: завжди raw timing, наше відоме ім'я (ремап колектора або ротація Гонзалеса) — у дужках. */
  const resolvePilot = (pilot: string, sessionId: string | null, kart: number, lapResolved?: string | null): string => {
    let resolved = lapResolved || null;
    if (!resolved && sessionId) {
      const meta = sessionMeta.get(sessionId);
      const parentId = meta?.id ?? sessionId;
      resolved = gonzalesPilotMap.get(`${parentId}|${kart}`) ?? gonzalesPilotMap.get(`${sessionId}|${kart}`) ?? null;
    }
    if (!resolved || resolved === pilot) return pilot;
    return `${pilot} (${resolved})`;
  };

  /** Лейбл типу заїзду: "ЛЧ · Г1", "Прокат 5" тощо. */
  const sessionTypeLabel = (sessionId: string | null): string => {
    if (!sessionId) return '—';
    const s = sessionMeta.get(sessionId);
    if (!s) return 'Прокат';
    if (s.competition_format && s.competition_phase) {
      const short = COMPETITION_CONFIGS[s.competition_format as keyof typeof COMPETITION_CONFIGS]?.shortName || s.competition_format;
      return `${short} · ${getPhaseShortLabel(s.competition_format, s.competition_phase)}`;
    }
    if (s.competition_format) {
      return COMPETITION_CONFIGS[s.competition_format as keyof typeof COMPETITION_CONFIGS]?.shortName || s.competition_format;
    }
    return `Прокат${s.race_number != null ? ` ${s.race_number}` : ''}`;
  };

  const [disabledKartsArr, setDisabledKartsArr] = useLocalStorage<number[]>('karting_disabled_karts', []);
  const disabledKarts = useMemo(() => new Set(disabledKartsArr), [disabledKartsArr]);
  const setDisabledKarts = (next: Set<number>) => setDisabledKartsArr([...next]);
  const toggleKartDisabled = (num: number) => {
    const next = new Set(disabledKarts); next.has(num) ? next.delete(num) : next.add(num); setDisabledKarts(next);
  };

  // Метрика для рейтингу/сортування: lap_sec для 'best', tb_sec для 'tb'.
  const metricOf = (l: KartStat['top5'][number]) =>
    sortMode === 'tb' ? (l.tb_sec ?? Infinity) : (l.lap_sec ?? Infinity);

  const kartRanking = useMemo(() => {
    const metric = (l: KartStat['top5'][number]) =>
      sortMode === 'tb' ? (l.tb_sec ?? Infinity) : (l.lap_sec ?? Infinity);
    const ranked = kartStats
      .filter(k => !disabledKarts.has(k.kart) && k.top5.length > 0)
      .map(k => {
        const topLaps = [...k.top5].sort((a, b) => metric(a) - metric(b)).slice(0, topN);
        const avg = topLaps.length > 0 ? topLaps.reduce((s, l) => s + metric(l), 0) / topLaps.length : Infinity;
        return { number: k.kart, avg };
      })
      .sort((a, b) => a.avg - b.avg);
    const map = new Map<number, number>();
    ranked.forEach((k, i) => map.set(k.number, i + 1));
    return map;
  }, [kartStats, disabledKarts, topN, sortMode]);

  const activeKartsRaw = kartStats.filter(k => !disabledKarts.has(k.kart));
  const activeKarts = sortMode === 'number'
    ? activeKartsRaw
    : [...activeKartsRaw].sort((a, b) => (kartRanking.get(a.kart) ?? 999) - (kartRanking.get(b.kart) ?? 999));
  const inactiveKarts = kartStats.filter(k => disabledKarts.has(k.kart));
  // У режимах рейтингу (best/tb) карти йдуть #1, #2... тож номер ранку зайвий.
  const showRankBadge = sortMode === 'number';

  const useTB = sortMode === 'tb';

  interface FlatRow {
    kart: number; rank?: number; pilot: string;
    timeSec: number | null; timeStr: string | null; s1: string | null; s2: string | null;
    sessionId: string | null; ts: number | null;
  }

  // Плоска таблиця: по displayLaps найкращих кіл на кожен карт.
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const k of activeKarts) {
      const top = [...k.top5].sort((a, b) => metricOf(a) - metricOf(b)).slice(0, displayLaps);
      for (const r of top) {
        const sec = useTB ? r.tb_sec : r.lap_sec;
        const timeStr = useTB ? (r.tb_sec != null ? r.tb_sec.toFixed(3) : null) : r.lap_time;
        rows.push({
          kart: k.kart,
          rank: showRankBadge ? kartRanking.get(k.kart) : undefined,
          pilot: resolvePilot(r.pilot, r.session_id, k.kart, r.resolved_pilot),
          timeSec: sec,
          timeStr,
          s1: useTB ? r.tb_s1 : r.s1,
          s2: useTB ? r.tb_s2 : r.s2,
          sessionId: r.session_id,
          ts: r.ts,
        });
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKarts, displayLaps, sortMode, kartRanking, gonzalesPilotMap, sessionMeta, showRankBadge]);

  return (
    <div className="space-y-6">
      {/* Track filter */}
      <TrackFilter
        selected={selectedTracks}
        onToggle={toggleTrack}
        onSelectAll={selectAllTracks}
        onClearAll={clearAllTracks}
      />

      {/* Date multi-select */}
      <DateNavigator
        selectedDate={todayStr}
        onSelectDate={handleToggleDate}
        selectedDates={selectedDates}
        onToggleDate={handleToggleDate}
        onSelectDates={handleSelectDates}
        trackFilter={trackFilter}
      />

      {/* Stat summary */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Статистика: {selectedDates.size} {selectedDates.size === 1 ? 'день' : selectedDates.size < 5 ? 'дні' : 'днів'}, {statSessionIds.size} заїздів
            {excludedSessions.size > 0 && visibleSessions.length > 0 && (
              <span className="text-dark-600 ml-1 normal-case">({excludedSessions.size} прибрано)</span>
            )}
            {loading && <span className="text-dark-600 ml-2">завантаження...</span>}
          </div>
          {selectedDates.size > 0 && (
            <button onClick={clearAllDates}
              className="text-red-400/60 text-[10px] hover:text-red-400 transition-colors">очистити</button>
          )}
        </div>
        {visibleSessions.length > 0 && (
          <div className="max-h-48 overflow-y-auto">
            <SessionsTable
              sessions={visibleSessions}
              showDate
              excludedIds={excludedSessions}
              onToggleExclude={toggleExcludeSession}
            />
          </div>
        )}
      </div>

      {/* Kart list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Карти ({activeKarts.length} активних{inactiveKarts.length > 0 ? `, ${inactiveKarts.length} прихованих` : ''})
          </div>
          <div className="flex items-center gap-2">
            <label className="text-dark-400 text-[10px] flex items-center gap-1">
              <input type="text" inputMode="numeric" value={displayLapsInput}
                onChange={e => setDisplayLapsInput(e.target.value.replace(/\D/g, ''))}
                onFocus={() => setDisplayLapsPrev(displayLapsInput)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={() => { const v = parseInt(displayLapsInput); if (!v || v < 1) { setDisplayLapsInput(displayLapsPrev); return; } setDisplayLaps(v); }}
                className="w-8 bg-dark-800 border border-dark-700 text-white rounded px-1 py-0.5 outline-none focus:border-primary-500 text-[10px] text-center" />
              пілотів
            </label>
            <span className="text-dark-700">|</span>
            <label className="text-dark-400 text-[10px] flex items-center gap-1">
              <input type="text" inputMode="numeric" value={topNInput}
                onChange={e => setTopNInput(e.target.value.replace(/\D/g, ''))}
                onFocus={() => setTopNPrev(topNInput)}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                onBlur={() => { const v = parseInt(topNInput); if (!v || v < 1) { setTopNInput(topNPrev); return; } setTopN(v); }}
                className="w-8 bg-dark-800 border border-dark-700 text-white rounded px-1 py-0.5 outline-none focus:border-primary-500 text-[10px] text-center" />
              best laps
            </label>
            <span className="text-dark-700">|</span>
            <div className="flex bg-dark-800 rounded-md p-0.5">
              <button onClick={() => setSortMode('best')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortMode === 'best' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>Best lap</button>
              <button onClick={() => setSortMode('tb')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortMode === 'tb' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>TB</button>
              <button onClick={() => setSortMode('number')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortMode === 'number' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по номеру</button>
            </div>
          </div>
        </div>

        {/* Flat table */}
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="table-header">
                <th className="text-center w-16 px-1 py-1.5">Карт</th>
                <th className="text-right w-[68px] px-1 py-1.5">Час</th>
                <th className="text-right w-[56px] px-1 py-1.5">S1</th>
                <th className="text-right w-[56px] px-1 py-1.5">S2</th>
                <th className="table-cell text-left pl-3">Пілот</th>
                <th className="table-cell text-left">Заїзд</th>
              </tr></thead>
              <tbody>
                {flatRows.map((r, i) => {
                  const isFirstOfKart = i === 0 || flatRows[i - 1].kart !== r.kart;
                  const groupSize = flatRows.filter(x => x.kart === r.kart).length;
                  return (
                  <tr key={`${r.kart}-${r.pilot}-${r.sessionId}-${i}`}
                    className={`group ${isFirstOfKart && i > 0 ? 'border-t-[6px] border-t-dark-950' : ''} hover:bg-dark-700/30`}>
                    {isFirstOfKart ? (
                      <td rowSpan={groupSize} className="text-center align-middle border-r-2 border-dark-700 bg-dark-900/60 px-1">
                        <Link to={`/info/karts/${r.kart}`} className="font-mono font-extrabold text-blue-400 hover:text-blue-300 text-2xl leading-none">
                          {r.kart}
                        </Link>
                        {r.rank ? <span className="block text-dark-500 font-normal text-[10px] mt-0.5">#{r.rank}</span> : null}
                        <button onClick={() => toggleKartDisabled(r.kart)} title="Сховати карт"
                          className="block mx-auto mt-0.5 text-dark-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">✕</button>
                      </td>
                    ) : null}
                    <td className="text-right font-mono font-semibold text-green-400 px-1 py-0.5">{r.timeStr ? toSeconds(r.timeStr) : '—'}</td>
                    <td className="text-right font-mono text-[11px] text-dark-400 px-1 py-0.5">{r.s1 ? toSeconds(r.s1) : '—'}</td>
                    <td className="text-right font-mono text-[11px] text-dark-400 px-1 py-0.5">{r.s2 ? toSeconds(r.s2) : '—'}</td>
                    <td className="text-left text-white whitespace-nowrap pl-3 pr-2 py-0.5">{r.pilot}</td>
                    <td className="text-left whitespace-nowrap px-2 py-0.5">
                      {r.sessionId ? (
                        <Link to={`/sessions/${sessionMeta.get(r.sessionId)?.id ?? r.sessionId}`}
                          className="text-primary-400/90 hover:text-primary-300 underline underline-offset-2 decoration-primary-400/30">
                          {r.ts ? fmtDate(r.ts) : ''} · {sessionTypeLabel(r.sessionId)}
                        </Link>
                      ) : (
                        <span className="text-dark-300">{r.ts ? fmtDate(r.ts) : '—'} · {sessionTypeLabel(r.sessionId)}</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {flatRows.length === 0 && (
                  <tr><td colSpan={6} className="table-cell text-center text-dark-600 py-8">Немає даних. Оберіть дні в календарі.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {showDisabled && inactiveKarts.length > 0 && (
          <div className="mt-3 text-[10px] text-dark-500">
            <span className="uppercase tracking-wider">Приховані карти: </span>
            {inactiveKarts.map(k => (
              <button key={k.kart} onClick={() => toggleKartDisabled(k.kart)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mr-1 rounded bg-dark-800 text-dark-400 hover:text-green-400 transition-colors">
                Карт {k.kart} <span className="text-green-400/60">+</span>
              </button>
            ))}
          </div>
        )}

        {/* Controls under the list */}
        <div className="flex items-center justify-end gap-2 mt-3">
          <button onClick={() => setDisabledKarts(new Set())} className="text-dark-400 text-[10px] hover:text-white transition-colors">показати всі</button>
          <span className="text-dark-700">|</span>
          <button onClick={() => setShowDisabled((v: boolean) => !v)} className="text-dark-400 text-[10px] hover:text-white transition-colors">
            {showDisabled ? 'сховати приховані' : `показати приховані${inactiveKarts.length > 0 ? ` (${inactiveKarts.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
