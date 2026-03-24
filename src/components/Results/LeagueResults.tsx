import { useMemo, Fragment, useState, useEffect, useCallback } from 'react';
import { toSeconds } from '../../utils/timing';
import { PHASE_CONFIGS, splitIntoGroups } from '../../data/competitions';
import { useViewPrefs } from '../../services/viewPrefs';
import { useAuth } from '../../services/auth';
import { COLLECTOR_URL } from '../../services/config';

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

interface SessionLap {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  ts: number;
}

interface CompSession {
  sessionId: string;
  phase: string | null;
}

interface LeagueResultsProps {
  format: string;
  competitionId: string;
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
  initialExcludedPilots?: string[];
  initialEdits?: ManualEdits;
}

interface ScoringData {
  positionPoints: { label: string; minPilots: number; maxPilots: number; groups: Record<string, number[]> }[];
  overtakePoints: { groupI: { startPosMin: number; startPosMax: number; perOvertake: number }[]; groupII: number; groupIII: number };
  speedPoints: number[];
}

function parseLapSec(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+\.\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  const s = t.match(/^\d+\.\d+$/);
  if (s) return parseFloat(t);
  return null;
}

interface PilotQualiData { bestTime: number; bestTimeStr: string; kart: number; speedPoints: number }
interface PilotRaceData {
  kart: number; bestTime: number; bestTimeStr: string;
  group: number; startPos: number; finishPos: number;
  positionPoints: number; overtakePoints: number; speedPoints: number; penalties: number; totalRacePoints: number;
}
interface PilotRow {
  pilot: string; quali: PilotQualiData | null; races: (PilotRaceData | null)[];
  totalPoints: number;
}

type ManualEdits = Record<string, { startPos?: number; finishPos?: number; penalties?: number }>;

const TH_V = "px-1 py-1 text-center text-dark-500 border-r border-dark-700/30";
const TH_R = "[writing-mode:vertical-lr] rotate-180 text-[9px]";

function getOvertakeRate(scoring: ScoringData, group: number, startPos: number): number {
  if (group === 3) return scoring.overtakePoints.groupIII;
  if (group === 2) return scoring.overtakePoints.groupII;
  for (const rule of scoring.overtakePoints.groupI) {
    if (startPos >= rule.startPosMin && startPos <= rule.startPosMax) return rule.perOvertake;
  }
  return 0;
}

function getPositionPoints(scoring: ScoringData, totalPilots: number, group: string, finishPos: number): number {
  const cat = scoring.positionPoints.find(c => totalPilots >= c.minPilots && totalPilots <= c.maxPilots);
  if (!cat) return 0;
  const pts = cat.groups[group];
  if (!pts || finishPos < 1 || finishPos > pts.length) return 0;
  return pts[finishPos - 1];
}

export default function LeagueResults({ format, competitionId, sessions, sessionLaps, initialExcludedPilots, initialEdits }: LeagueResultsProps) {
  const { prefs, toggle } = useViewPrefs();
  const { isOwner } = useAuth();
  const raceCount = format === 'champions_league' ? 3 : 2;
  const maxGroups = format === 'champions_league' ? 2 : 3;

  const [scoring, setScoring] = useState<ScoringData | null>(null);
  useEffect(() => { fetch('/data/scoring.json').then(r => r.json()).then(setScoring).catch(() => {}); }, []);

  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (g: string) => setHiddenGroups(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });

  const [edits, setEdits] = useState<ManualEdits>(initialEdits || {});
  const setEdit = useCallback((pilot: string, raceNum: number, field: string, value: number) => {
    setEdits(prev => {
      const key = `${pilot}|${raceNum}`;
      const next = { ...prev, [key]: { ...prev[key], [field]: value } };
      saveToServer({ edits: next });
      return next;
    });
  }, [competitionId]);

  const [excludedPilots, setExcludedPilots] = useState<Set<string>>(new Set(initialExcludedPilots || []));
  const toggleExclude = useCallback((pilot: string) => {
    setExcludedPilots(prev => {
      const next = new Set(prev);
      next.has(pilot) ? next.delete(pilot) : next.add(pilot);
      saveToServer({ excludedPilots: [...next] });
      return next;
    });
  }, [competitionId]);

  const saveToServer = useCallback(async (partial: { excludedPilots?: string[]; edits?: ManualEdits }) => {
    try {
      const res = await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competitionId)}`);
      if (!res.ok) return;
      const comp = await res.json();
      const currentResults = comp.results || {};
      await fetch(`${COLLECTOR_URL}/competitions/${encodeURIComponent(competitionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
        body: JSON.stringify({ results: { ...currentResults, ...partial } }),
      });
    } catch {}
  }, [competitionId]);

  type SortKey = 'total' | 'quali_time' | `race_${number}_time` | `race_${number}_points`;
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    try { const v = localStorage.getItem(`karting_league_sort_${competitionId}`); return v ? JSON.parse(v).key : 'total'; } catch { return 'total'; }
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try { const v = localStorage.getItem(`karting_league_sort_${competitionId}`); return v ? JSON.parse(v).dir : 'desc'; } catch { return 'desc'; }
  });
  const toggleSort = (key: SortKey, fixedDir?: 'asc' | 'desc') => {
    let newKey = key;
    let newDir: 'asc' | 'desc';
    if (fixedDir) { newDir = fixedDir; }
    else if (sortKey === key) { newDir = sortDir === 'asc' ? 'desc' : 'asc'; }
    else { newDir = 'desc'; }
    setSortKey(newKey); setSortDir(newDir);
    try { localStorage.setItem(`karting_league_sort_${competitionId}`, JSON.stringify({ key: newKey, dir: newDir })); } catch {}
  };

  const qualiSessions = sessions.filter(s => s.phase?.startsWith('qualifying'));
  const getRaceSessions = (raceNum: number) => sessions.filter(s => s.phase?.startsWith(`race_${raceNum}_`));

  const data = useMemo(() => {
    if (!scoring) return [];

    // 1. Qualifying: best time per pilot
    const qualiData = new Map<string, PilotQualiData>();
    for (const qs of qualiSessions) {
      for (const l of (sessionLaps.get(qs.sessionId) || [])) {
        const sec = parseLapSec(l.lap_time);
        if (sec === null || sec < 38) continue;
        const ex = qualiData.get(l.pilot);
        if (!ex || sec < ex.bestTime) qualiData.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart, speedPoints: 0 });
      }
    }

    // Sort by qualifying time
    const qualiSorted = [...qualiData.entries()]
      .filter(([p]) => !excludedPilots.has(p))
      .sort((a, b) => a[1].bestTime - b[1].bestTime);
    const maxQualified = format === 'champions_league' ? 24 : 36;
    const qualifiedPilots = qualiSorted.slice(0, maxQualified).map(([p]) => p);
    const disqualifiedPilots = new Set(qualiSorted.slice(maxQualified).map(([p]) => p));
    const totalPilots = qualifiedPilots.length;

    // Qualifying speed points (top 5 fastest)
    qualiSorted.slice(0, 5).forEach(([pilot], i) => {
      const q = qualiData.get(pilot)!;
      q.speedPoints = scoring.speedPoints[i] || 0;
    });

    // 2. Determine groups from qualifying (reverse order: best = group 1 last position)
    const groups = splitIntoGroups(qualifiedPilots, maxGroups);
    const pilotGroup = new Map<string, { group: number; posInGroup: number }>();
    groups.forEach((g, gi) => {
      const groupNum = gi + 1; // group 1 = best (fastest from qualifying)
      g.pilots.forEach((p, pi) => {
        pilotGroup.set(p, { group: groupNum, posInGroup: g.pilots.length - pi }); // reverse: best gets highest pos
      });
    });

    // 3. Build race data
    let prevRaceTimes: { pilot: string; time: number }[] = qualiSorted.map(([p, d]) => ({ pilot: p, time: d.bestTime }));

    const raceResults: Map<string, PilotRaceData>[] = [];
    for (let r = 1; r <= raceCount; r++) {
      const rData = new Map<string, PilotRaceData>();
      const rSessions = getRaceSessions(r);

      // Determine start positions from previous race/quali times (reverse order per group)
      const prevSorted = [...prevRaceTimes]
        .filter(p => !excludedPilots.has(p.pilot) && !disqualifiedPilots.has(p.pilot))
        .sort((a, b) => a.time - b.time)
        .slice(0, maxQualified);
      const rGroups = splitIntoGroups(prevSorted.map(p => p.pilot), maxGroups);
      const startPositions = new Map<string, { group: number; startPos: number }>();
      rGroups.forEach((g, gi) => {
        const gNum = gi + 1;
        g.pilots.forEach((p, pi) => {
          startPositions.set(p, { group: gNum, startPos: g.pilots.length - pi });
        });
      });

      // Get finish positions from timing data (race mode: most laps, then earliest last lap)
      const raceTimes: { pilot: string; time: number }[] = [];
      for (const rs of rSessions) {
        const groupMatch = rs.phase?.match(/group_(\d+)/);
        const groupNum = groupMatch ? parseInt(groupMatch[1]) : 0;
        const laps = sessionLaps.get(rs.sessionId) || [];
        const pilotStats = new Map<string, { bestTime: number; bestTimeStr: string; kart: number; lapCount: number; lastTs: number }>();
        for (const l of laps) {
          const sec = parseLapSec(l.lap_time);
          if (sec === null || sec < 38) continue;
          const ex = pilotStats.get(l.pilot);
          if (!ex) {
            pilotStats.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart, lapCount: 1, lastTs: l.ts });
          } else {
            ex.lapCount++;
            if (l.ts > ex.lastTs) ex.lastTs = l.ts;
            if (sec < ex.bestTime) { ex.bestTime = sec; ex.bestTimeStr = l.lap_time!; }
          }
        }
        // Race finish: most laps first, then earliest last lap timestamp
        const sorted = [...pilotStats.entries()]
          .filter(([p]) => !excludedPilots.has(p))
          .sort((a, b) => {
            if (a[1].lapCount !== b[1].lapCount) return b[1].lapCount - a[1].lapCount;
            return a[1].lastTs - b[1].lastTs;
          });
        const excludedEntries = [...pilotStats.entries()].filter(([p]) => excludedPilots.has(p));
        sorted.forEach(([pilot, pData], i) => {
          const editKey = `${pilot}|${r}`;
          const edit = edits[editKey];
          const sp = startPositions.get(pilot);
          const isDisqualified = disqualifiedPilots.has(pilot);
          const startPos = isDisqualified ? -1 : (edit?.startPos ?? sp?.startPos ?? 0);
          const finishPos = edit?.finishPos ?? (i + 1);
          const group = isDisqualified ? 0 : (sp?.group ?? groupNum);
          const penalties = edit?.penalties ?? 0;

          const overtakes = isDisqualified ? 0 : Math.max(0, startPos - finishPos);
          const overtakeRate = getOvertakeRate(scoring, group, startPos);
          const overtakePoints = Math.round(overtakes * overtakeRate * 10) / 10;
          const groupLabel = group === 1 ? 'I' : group === 2 ? 'II' : 'III';
          const posPoints = getPositionPoints(scoring, totalPilots, groupLabel, finishPos);

          rData.set(pilot, {
            kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
            group, startPos, finishPos,
            positionPoints: posPoints, overtakePoints, speedPoints: 0, penalties,
            totalRacePoints: Math.round((posPoints + overtakePoints - penalties) * 10) / 10,
          });
          raceTimes.push({ pilot, time: pData.bestTime });
        });
        excludedEntries.forEach(([pilot, pData]) => {
          rData.set(pilot, {
            kart: pData.kart, bestTime: pData.bestTime, bestTimeStr: pData.bestTimeStr,
            group: 0, startPos: 0, finishPos: 0,
            positionPoints: 0, overtakePoints: 0, speedPoints: 0, penalties: 0, totalRacePoints: 0,
          });
        });
      }

      // Speed points for this race (top 5 by time across all groups)
      raceTimes.sort((a, b) => a.time - b.time);
      raceTimes.filter(r => !excludedPilots.has(r.pilot)).slice(0, 5).forEach(({ pilot }, i) => {
        const rd = rData.get(pilot);
        if (rd) {
          rd.speedPoints = scoring.speedPoints[i] || 0;
          rd.totalRacePoints = Math.round((rd.positionPoints + rd.overtakePoints + rd.speedPoints - rd.penalties) * 10) / 10;
        }
      });

      raceResults.push(rData);
      if (raceTimes.length > 0) prevRaceTimes = raceTimes.filter(r => !excludedPilots.has(r.pilot));
    }

    // 4. Build rows
    const allPilots = new Set<string>([...qualiData.keys()]);
    for (const rd of raceResults) for (const p of rd.keys()) allPilots.add(p);

    const rows: PilotRow[] = [...allPilots].map(pilot => {
      const q = qualiData.get(pilot) || null;
      const races = raceResults.map(rd => rd.get(pilot) || null);
      const qualiPts = q?.speedPoints ?? 0;
      const racePts = races.reduce((s, r) => s + (r?.totalRacePoints ?? 0), 0);
      return { pilot, quali: q, races, totalPoints: Math.round((qualiPts + racePts) * 10) / 10 };
    });

    return rows;
  }, [sessions, sessionLaps, scoring, edits, raceCount, maxGroups, excludedPilots]);

  const sortedData = useMemo(() => {
    const included = data.filter(r => !excludedPilots.has(r.pilot));
    const excluded = data.filter(r => excludedPilots.has(r.pilot));
    const getValue = (row: PilotRow): number => {
      if (sortKey === 'total') return row.totalPoints;
      if (sortKey === 'quali_time') return row.quali?.bestTime ?? Infinity;
      const m = sortKey.match(/^race_(\d+)_(time|points)$/);
      if (m) { const ri = parseInt(m[1]) - 1; const race = row.races[ri]; return m[2] === 'time' ? (race?.bestTime ?? Infinity) : (race?.totalRacePoints ?? 0); }
      return 0;
    };
    included.sort((a, b) => sortDir === 'asc' ? getValue(a) - getValue(b) : getValue(b) - getValue(a));
    return [...included, ...excluded];
  }, [data, sortKey, sortDir, excludedPilots]);

  if (!scoring) return <div className="card text-center py-6 text-dark-500">Завантаження балів...</div>;
  if (sortedData.length === 0) return <div className="card text-center py-12 text-dark-500">Немає даних</div>;

  const SortBtn = ({ k, label, fixedDir }: { k: SortKey; label: string; fixedDir?: 'asc' | 'desc' }) => (
    <button onClick={() => toggleSort(k, fixedDir)}
      className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${sortKey === k ? 'bg-primary-600/30 text-primary-400' : 'bg-dark-800 text-dark-600 hover:text-dark-400'}`}>
      {label} {fixedDir ? (fixedDir === 'asc' ? '↑' : '↓') : (sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '')}
    </button>
  );

  const showQuali = !hiddenGroups.has('quali');
  const showRace = (n: number) => !hiddenGroups.has(`race_${n}`);
  const rc = 9; // race columns: Карт, Час, Група, Старт, Фініш, Позиція, Обгони, Штрафи, Сума

  const EditableCell = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => {
    const [text, setText] = useState(String(value));
    useEffect(() => { setText(String(value)); }, [value]);
    return (
      <input type="text" inputMode="numeric" value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => { const v = parseFloat(text); onChange(isNaN(v) ? 0 : v); }}
        className="w-10 bg-transparent text-center font-mono text-dark-300 outline-none border-b border-dark-700 focus:border-primary-500" />
    );
  };

  return (
    <div className="space-y-4">
      {prefs.showLeaguePoints ? (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-dark-800 flex items-center gap-3 flex-wrap">
            <button onClick={() => toggle('showLeaguePoints')} className="text-white font-semibold text-sm hover:text-dark-300 transition-colors">Таблиця балів ▾</button>
            <div className="flex gap-1 flex-wrap">
              <SortBtn k="total" label="Сума" />
              <SortBtn k="quali_time" label="Квала" fixedDir="asc" />
              {Array.from({ length: raceCount }, (_, i) => (
                <Fragment key={i}>
                  <SortBtn k={`race_${i + 1}_time` as SortKey} label={`Г${i + 1} час`} fixedDir="asc" />
                  <SortBtn k={`race_${i + 1}_points` as SortKey} label={`Г${i + 1} бали`} fixedDir="desc" />
                </Fragment>
              ))}
            </div>
            <div className="flex gap-1">
              <button onClick={() => toggleGroup('quali')} className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${showQuali ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Квала</button>
              {Array.from({ length: raceCount }, (_, i) => (
                <button key={i} onClick={() => toggleGroup(`race_${i + 1}`)} className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${showRace(i + 1) ? 'bg-primary-600/20 text-primary-400' : 'bg-dark-800 text-dark-600'}`}>Г{i + 1}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-dark-800/50">
                  <th rowSpan={2} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-6">#</th>
                  <th rowSpan={2} className="px-2 py-1 text-left text-dark-300 font-semibold border-r border-dark-700 min-w-[100px]">Пілот</th>
                  <th rowSpan={2} className="px-1 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-10"><span className={TH_R}>Сума</span></th>
                  {showQuali && <th colSpan={3} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700">Квала</th>}
                  {Array.from({ length: raceCount }, (_, i) => showRace(i + 1) ? (
                    <th key={i} colSpan={rc} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700">Гонка {i + 1}</th>
                  ) : null)}
                </tr>
                <tr className="bg-dark-800/30">
                  {showQuali && (<>
                    <th className={TH_V}><span className={TH_R}>Карт</span></th>
                    <th className={TH_V}><span className={TH_R}>Час</span></th>
                    <th className={TH_V}><span className={TH_R}>Бали</span></th>
                  </>)}
                  {Array.from({ length: raceCount }, (_, i) => showRace(i + 1) ? (
                    <Fragment key={i}>
                      <th className={TH_V}><span className={TH_R}>Карт</span></th>
                      <th className={TH_V}><span className={TH_R}>Час</span></th>
                      <th className={TH_V}><span className={TH_R}>Група</span></th>
                      <th className={TH_V}><span className={TH_R}>Старт</span></th>
                      <th className={TH_V}><span className={TH_R}>Фініш</span></th>
                      <th className={TH_V}><span className={TH_R}>Позиція</span></th>
                      <th className={TH_V}><span className={TH_R}>Обгони</span></th>
                      <th className={TH_V}><span className={TH_R}>Штрафи</span></th>
                      <th className={TH_V}><span className={TH_R}>Сума</span></th>
                    </Fragment>
                  ) : null)}
                </tr>
              </thead>
              <tbody>
                  {sortedData.map((row, i) => {
                    const isExcluded = excludedPilots.has(row.pilot);
                    return (
                    <tr key={row.pilot} className={`border-b border-dark-800/50 ${isExcluded ? 'opacity-30' : 'hover:bg-dark-700/30'}`}>
                      <td className="px-2 py-1 text-center font-mono text-white font-bold border-r border-dark-700">{isExcluded ? '—' : i + 1}</td>
                      <td className="px-2 py-1 text-left border-r border-dark-700 whitespace-nowrap">
                        <span className="text-white">{row.pilot}</span>
                        {isOwner && (
                          <button onClick={() => toggleExclude(row.pilot)}
                            className={`ml-1 text-[9px] px-1 rounded transition-colors ${isExcluded ? 'text-green-400/60 hover:text-green-400' : 'text-dark-700 hover:text-red-400'}`}>
                            {isExcluded ? '↩' : '✕'}
                          </button>
                        )}
                      </td>
                    <td className="px-1 py-1 text-center font-mono text-green-400 font-bold border-r border-dark-700">{row.totalPoints || '—'}</td>
                    {showQuali && (<>
                      <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{row.quali?.kart || '—'}</td>
                      <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30">{row.quali ? toSeconds(row.quali.bestTimeStr) : '—'}</td>
                      <td className="px-1 py-1 text-center font-mono text-dark-400 border-r border-dark-700">{row.quali?.speedPoints ? row.quali.speedPoints : '—'}</td>
                    </>)}
                    {row.races.map((race, ri) => showRace(ri + 1) ? (
                      <Fragment key={ri}>
                        <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.kart || '—'}</td>
                        <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30">{race ? toSeconds(race.bestTimeStr) : '—'}</td>
                        <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.group || '—'}</td>
                        <td className="px-1 py-1 text-center font-mono text-dark-400 border-r border-dark-700/30">
                          {race ? (race.startPos === -1 ? <span className="text-red-400">X</span> : isOwner ? <EditableCell value={race.startPos} onChange={v => setEdit(row.pilot, ri + 1, 'startPos', v)} /> : <span>{race.startPos}</span>) : '—'}
                        </td>
                        <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30">
                          {race ? (isOwner ? <EditableCell value={race.finishPos} onChange={v => setEdit(row.pilot, ri + 1, 'finishPos', v)} /> : <span>{race.finishPos}</span>) : '—'}
                        </td>
                        <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.positionPoints || '—'}</td>
                        <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.overtakePoints || '—'}</td>
                        <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">
                          {race ? (isOwner ? <EditableCell value={race.penalties} onChange={v => setEdit(row.pilot, ri + 1, 'penalties', v)} /> : <span>{race.penalties || '—'}</span>) : '—'}
                        </td>
                        <td className="px-1 py-1 text-center font-mono text-dark-300 font-bold border-r border-dark-700">{race?.totalRacePoints || '—'}</td>
                      </Fragment>
                    ) : null)}
                  </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <button onClick={() => toggle('showLeaguePoints')} className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-dark-800 text-dark-500 hover:text-white transition-colors">Таблиця балів ▸</button>
      )}
    </div>
  );
}
