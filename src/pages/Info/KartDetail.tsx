import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { api, type DbSession } from '../../services/api';
import { parseTime, toSeconds, mergePilotNames, shortPilot } from '../../utils/timing';
import { fmtTimeShort as fmtTime, fmtDateDM as fmtDate } from '../../utils/datetime';
import { COMPETITION_CONFIGS, getPhaseShortLabel } from '../../data/competitions';
import { buildGonzalesKartPilotMap } from '../../utils/gonzalesPilotResolver';
import { LoadingState } from '../../components/States';
import { useKartFilters, useSelectedDateSessions } from '../../services/useKartFilters';
import DateNavigator from '../../components/Sessions/DateNavigator';
import SessionsTable from '../../components/Sessions/SessionsTable';
import TrackFilter from '../../components/Sessions/TrackFilter';

interface KartLap {
  id: number;
  session_id: string;
  pilot: string;
  kart: number;
  lap_number: number;
  lap_time: string;
  s1: string | null;
  s2: string | null;
  best_lap: string | null;
  position: number | null;
  ts: number;
  date: string;
  session_start: number;
}


/** Лейбл типу заїзду: "ЛЧ · Г1", "Прокат 5" тощо. */
function sessionTypeLabel(format: string | null, phase: string | null, raceNumber: number | null): string {
  if (format && phase) {
    const short = COMPETITION_CONFIGS[format as keyof typeof COMPETITION_CONFIGS]?.shortName || format;
    return `${short} · ${getPhaseShortLabel(format, phase)}`;
  }
  if (format) return COMPETITION_CONFIGS[format as keyof typeof COMPETITION_CONFIGS]?.shortName || format;
  return `Прокат${raceNumber != null ? ` ${raceNumber}` : ''}`;
}

export default function KartDetail() {
  const { kartId } = useParams<{ kartId: string }>();
  const kartNumber = parseInt(kartId || '0');

  const {
    todayStr,
    selectedDates, toggleDate: handleToggleDate, selectDates: handleSelectDates, clearDates: clearAllDates,
    selectedTracks, trackFilter, toggleTrack, selectAllTracks, clearAllTracks,
    excludedSessions, toggleExcludeSession,
  } = useKartFilters();

  // Fetch all-time session counts for this kart
  const [kartDateCounts, setKartDateCounts] = useState<Record<string, number> | undefined>(undefined);
  useEffect(() => {
    api.karts.sessionCounts(kartNumber)
      .then((data: { date: string; count: number }[]) => {
        const counts: Record<string, number> = {};
        for (const d of data) counts[d.date] = d.count;
        setKartDateCounts(counts);
      })
      .catch(() => setKartDateCounts(undefined));
  }, [kartNumber]);

  // Сесії вибраних днів на вибраних трасах — спільний хук.
  const { sessions: allSessions } = useSelectedDateSessions(selectedDates, selectedTracks);

  // Fetch session IDs and details for selected dates
  const [statSessionIds, setStatSessionIds] = useState<Set<string>>(new Set());
  const [statSessionDetails, setStatSessionDetails] = useState<DbSession[]>([]);
  const [laps, setLaps] = useState<KartLap[]>([]);
  const [subIdToMergedMap, setSubIdToMergedMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  // Competitions для резолву пілота Гонзалеса ("Карт N" → реальне ім'я з ротації).
  const [competitions, setCompetitions] = useState<any[]>([]);
  useEffect(() => {
    api.competitions.list().then(d => setCompetitions(d as any[])).catch(() => setCompetitions([]));
  }, []);

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
      const karts = cfg.kartList && cfg.kartList.length > 0 ? cfg.kartList : Array.from({ length: 12 }, (_, i) => i + 1);
      const sub = buildGonzalesKartPilotMap(
        roundSessions.map((s: any) => ({ sessionId: s.sessionId, phase: s.phase })),
        cfg, karts, pilotCount,
      );
      for (const [k, v] of sub) map.set(k, v);
    }
    return map;
  }, [competitions]);

  // Стабільний ключ сесій для deps.
  const sessionsKey = useMemo(() => allSessions.map(s => s.id).sort().join(','), [allSessions]);

  // Fetch kart laps for the loaded sessions, filter to sessions with this kart
  useEffect(() => {
    if (allSessions.length === 0) {
      setStatSessionIds(new Set());
      setStatSessionDetails([]);
      setLaps([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Fetch laps for this kart over the date range
      const dates = [...selectedDates].sort();
      const from = dates[0];
      const to = dates[dates.length - 1];
      let kartLaps: KartLap[] = [];
      try {
        kartLaps = await api.laps.byKart(kartNumber, from, to) as unknown as KartLap[];
      } catch {}
      if (cancelled) return;

      // 3. Filter to sessions where this kart has laps (include merged sub-session IDs)
      const allIds = new Set<string>();
      const subIdToMerged = new Map<string, string>();
      for (const s of allSessions) {
        allIds.add(s.id);
        if (s.merged_session_ids) {
          for (const subId of s.merged_session_ids) {
            allIds.add(subId);
            subIdToMerged.set(subId, s.id);
          }
        }
      }
      const filtered = kartLaps.filter(l => allIds.has(l.session_id));
      const bySession = new Map<string, KartLap[]>();
      for (const l of filtered) {
        if (!bySession.has(l.session_id)) bySession.set(l.session_id, []);
        bySession.get(l.session_id)!.push(l);
      }
      const merged: KartLap[] = [];
      for (const sessionLaps of bySession.values()) {
        merged.push(...mergePilotNames(sessionLaps));
      }
      const kartSessionIds = new Set<string>();
      for (const l of filtered) {
        const mergedId = subIdToMerged.get(l.session_id) || l.session_id;
        kartSessionIds.add(mergedId);
      }

      setLaps(merged);
      setStatSessionIds(kartSessionIds);
      setSubIdToMergedMap(subIdToMerged);
      // Override best lap with kart-specific best lap per session
      const kartBestBySession = new Map<string, { pilot: string; time: string; sec: number }>();
      for (const l of merged) {
        const sid = subIdToMerged.get(l.session_id) || l.session_id;
        const sec = parseTime(l.lap_time);
        if (sec === null) continue;
        const cur = kartBestBySession.get(sid);
        if (!cur || sec < cur.sec) kartBestBySession.set(sid, { pilot: l.pilot, time: l.lap_time, sec });
      }
      setStatSessionDetails(allSessions.filter(s => kartSessionIds.has(s.id)).map(s => {
        const best = kartBestBySession.get(s.id);
        if (best) return { ...s, best_lap_time: best.time, best_lap_pilot: best.pilot, best_lap_kart: kartNumber };
        return s;
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [sessionsKey, kartNumber]);

  const [sortBy, setSortBy] = useState<'best' | 'date'>('best');

  // Per-session stats for this kart (grouped by merged-parent session id).
  const sessionStats = useMemo(() => {
    const bySession = new Map<string, KartLap[]>();
    for (const l of laps) {
      const mergedId = subIdToMergedMap.get(l.session_id) || l.session_id;
      if (excludedSessions.has(mergedId)) continue;
      if (!bySession.has(mergedId)) bySession.set(mergedId, []);
      bySession.get(mergedId)!.push(l);
    }
    const result: { pilot: string; bestLap: string; bestLapSec: number; bestS1: string | null; bestS2: string | null; sessionId: string; date: string; sessionStart: number; raceNumber: number | null; competitionFormat: string | null; competitionPhase: string | null; lapCount: number }[] = [];
    for (const [sessionId, sessionLaps] of bySession) {
      let bestLap = '', bestLapSec = Infinity, bestS1: string | null = null, bestS1Sec = Infinity, bestS2: string | null = null, bestS2Sec = Infinity;
      const pilots = new Set<string>();
      for (const l of sessionLaps) {
        // Гонзалес: показуємо raw + резолв з ротації в дужках; інакше resolved_pilot з ремапу.
        const gonz = gonzalesPilotMap.get(`${sessionId}|${l.kart}`);
        const resolved = gonz ?? (l as any).resolved_pilot ?? null;
        pilots.add(resolved && resolved !== l.pilot ? `${l.pilot} (${resolved})` : l.pilot);
        const sec = parseTime(l.lap_time);
        if (sec !== null && sec < bestLapSec) { bestLapSec = sec; bestLap = l.lap_time; }
        const s1sec = parseTime(l.s1);
        if (s1sec !== null && s1sec < bestS1Sec) { bestS1Sec = s1sec; bestS1 = l.s1; }
        const s2sec = parseTime(l.s2);
        if (s2sec !== null && s2sec < bestS2Sec) { bestS2Sec = s2sec; bestS2 = l.s2; }
      }
      const detail = statSessionDetails.find(s => s.id === sessionId);
      result.push({
        pilot: [...pilots].join(', '),
        bestLap, bestLapSec, bestS1, bestS2,
        sessionId, date: sessionLaps[0].date, sessionStart: sessionLaps[0].session_start,
        raceNumber: detail?.race_number ?? null,
        competitionFormat: (detail as any)?.competition_format ?? null,
        competitionPhase: (detail as any)?.competition_phase ?? null,
        lapCount: sessionLaps.length,
      });
    }
    return result.sort((a, b) =>
      sortBy === 'date' ? b.sessionStart - a.sessionStart : a.bestLapSec - b.bestLapSec
    );
  }, [laps, statSessionDetails, sortBy, excludedSessions, subIdToMergedMap, gonzalesPilotMap]);

  const overallBestSec = sessionStats.length > 0 ? sessionStats[0].bestLapSec : null;
  const overallBestS1 = sessionStats.reduce((best, s) => { const v = parseTime(s.bestS1); return v !== null && v < best ? v : best; }, Infinity);
  const overallBestS2 = sessionStats.reduce((best, s) => { const v = parseTime(s.bestS2); return v !== null && v < best ? v : best; }, Infinity);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/info/karts" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Карт {kartNumber}</h1>
          <p className="text-dark-400 text-sm">
            {laps.length} кіл · {sessionStats.length} заїздів
            {overallBestSec !== null && overallBestSec < Infinity && <> · Рекорд: <span className="text-green-400 font-mono">{toSeconds(sessionStats[0].bestLap)}</span> ({sessionStats[0].pilot})</>}
          </p>
        </div>
      </div>

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
        overrideCounts={kartDateCounts}
        trackFilter={trackFilter}
      />

      {/* Stat summary */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-dark-400 text-[10px] font-semibold uppercase tracking-wider">
            Статистика: {selectedDates.size} {selectedDates.size === 1 ? 'день' : selectedDates.size < 5 ? 'дні' : 'днів'}, {statSessionIds.size} заїздів
            {excludedSessions.size > 0 && (
              <span className="text-dark-600 ml-1 normal-case">({[...excludedSessions].filter(id => statSessionIds.has(id)).length} прибрано)</span>
            )}
            {loading && <span className="text-dark-600 ml-2">завантаження...</span>}
          </div>
          {selectedDates.size > 0 && (
            <button onClick={clearAllDates}
              className="text-red-400/60 text-[10px] hover:text-red-400 transition-colors">очистити</button>
          )}
        </div>
        {statSessionDetails.length > 0 && (
          <div className="max-h-48 overflow-y-auto">
            <SessionsTable
              sessions={statSessionDetails}
              showDate
              newestFirst
              excludedIds={excludedSessions}
              onToggleExclude={toggleExcludeSession}
            />
          </div>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : laps.length === 0 ? (
        <div className="card text-center py-12 text-dark-500">Немає даних. Оберіть дні в календарі.</div>
      ) : (
        <>
          {/* Sessions table */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-800 flex items-center justify-between">
              <h3 className="text-white font-semibold">Заїзди ({sessionStats.length})</h3>
              <div className="flex bg-dark-800 rounded-md p-0.5">
                <button onClick={() => setSortBy('best')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortBy === 'best' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по швидкості</button>
                <button onClick={() => setSortBy('date')} className={`px-2 py-0.5 text-[10px] rounded transition-colors ${sortBy === 'date' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:text-white'}`}>по даті</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="table-header">
                  <th className="table-cell text-center w-8">#</th>
                  <th className="table-cell text-left">Pilot</th>
                  <th className="table-cell text-right">Best</th>
                  <th className="table-cell text-right">B.S1</th>
                  <th className="table-cell text-right">B.S2</th>
                  <th className="table-cell text-left">Заїзд</th>
                </tr></thead>
                <tbody>
                  {sessionStats.map((s, i) => {
                    const isBestLap = overallBestSec !== null && Math.abs(s.bestLapSec - overallBestSec) < 0.002;
                    const s1sec = parseTime(s.bestS1);
                    const isBestS1 = s1sec !== null && Math.abs(s1sec - overallBestS1) < 0.002;
                    const s2sec = parseTime(s.bestS2);
                    const isBestS2 = s2sec !== null && Math.abs(s2sec - overallBestS2) < 0.002;
                    return (
                      <tr key={s.sessionId} className="table-row">
                        <td className="table-cell text-center font-mono font-bold text-white">{i + 1}</td>
                        <td className="table-cell text-left text-white">{s.pilot}</td>
                        <td className={`table-cell text-right font-mono font-semibold ${isBestLap ? 'text-purple-400' : 'text-green-400'}`}>{toSeconds(s.bestLap)}</td>
                        <td className={`table-cell text-right font-mono text-[11px] ${isBestS1 ? 'text-purple-400' : 'text-dark-400'}`}>{s.bestS1 ? toSeconds(s.bestS1) : '—'}</td>
                        <td className={`table-cell text-right font-mono text-[11px] ${isBestS2 ? 'text-purple-400' : 'text-dark-400'}`}>{s.bestS2 ? toSeconds(s.bestS2) : '—'}</td>
                        <td className="table-cell text-left">
                          <Link to={`/sessions/${s.sessionId}`} className="text-primary-400 hover:text-primary-300 transition-colors underline underline-offset-2 decoration-primary-400/30">
                            {s.date.slice(5)} {fmtTime(s.sessionStart)} · {sessionTypeLabel(s.competitionFormat, s.competitionPhase, s.raceNumber)}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
