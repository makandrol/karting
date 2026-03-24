import { useMemo, Fragment } from 'react';
import { toSeconds } from '../../utils/timing';
import { PHASE_CONFIGS, getPhaseLabel, splitIntoGroups } from '../../data/competitions';
import { useViewPrefs } from '../../services/viewPrefs';

interface SessionLap {
  pilot: string;
  kart: number;
  lap_time: string | null;
  s1: string | null;
  s2: string | null;
  ts: number;
  lap_number?: number;
  position?: number;
}

interface CompSession {
  sessionId: string;
  phase: string | null;
}

interface LeagueResultsProps {
  format: string;
  sessions: CompSession[];
  sessionLaps: Map<string, SessionLap[]>;
}

function parseLapSec(t: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+\.\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  const s = t.match(/^\d+\.\d+$/);
  if (s) return parseFloat(t);
  return null;
}

interface PilotQualiData {
  bestTime: number;
  bestTimeStr: string;
  kart: number;
}

interface PilotRaceData {
  group: number;
  startPos: number;
  finishPos: number;
  bestTime: number;
  bestTimeStr: string;
  laps: number;
  positionPoints: number;
  overtakePoints: number;
  speedPoints: number;
  penalties: number;
  totalRacePoints: number;
}

interface PilotRow {
  pilot: string;
  quali: PilotQualiData | null;
  races: (PilotRaceData | null)[];
  totalPoints: number;
}

export default function LeagueResults({ format, sessions, sessionLaps }: LeagueResultsProps) {
  const { prefs, toggle } = useViewPrefs();
  const phases = PHASE_CONFIGS[format]?.phases || [];
  const raceCount = format === 'champions_league' ? 3 : 2;
  const maxGroups = format === 'champions_league' ? 2 : 3;

  const qualiSessions = sessions.filter(s => s.phase?.startsWith('qualifying'));
  const raceSessions = (raceNum: number) => sessions.filter(s => s.phase?.startsWith(`race_${raceNum}_`));

  const data = useMemo(() => {
    // Collect qualifying data
    const qualiData = new Map<string, PilotQualiData>();
    for (const qs of qualiSessions) {
      const laps = sessionLaps.get(qs.sessionId) || [];
      for (const l of laps) {
        const sec = parseLapSec(l.lap_time);
        if (sec === null || sec < 38) continue;
        const existing = qualiData.get(l.pilot);
        if (!existing || sec < existing.bestTime) {
          qualiData.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, kart: l.kart });
        }
      }
    }

    // Sort pilots by qualifying time
    const qualifiedPilots = [...qualiData.entries()]
      .sort((a, b) => a[1].bestTime - b[1].bestTime)
      .map(([pilot]) => pilot);

    // Collect race data per race number
    const raceData: Map<string, PilotRaceData>[] = [];
    for (let r = 1; r <= raceCount; r++) {
      const rData = new Map<string, PilotRaceData>();
      const rSessions = raceSessions(r);

      for (const rs of rSessions) {
        const groupMatch = rs.phase?.match(/group_(\d+)/);
        const groupNum = groupMatch ? parseInt(groupMatch[1]) : 0;
        const laps = sessionLaps.get(rs.sessionId) || [];

        const pilotBest = new Map<string, { bestTime: number; bestTimeStr: string; laps: number; kart: number }>();
        for (const l of laps) {
          const sec = parseLapSec(l.lap_time);
          if (sec === null || sec < 38) continue;
          const existing = pilotBest.get(l.pilot);
          if (!existing) {
            pilotBest.set(l.pilot, { bestTime: sec, bestTimeStr: l.lap_time!, laps: 1, kart: l.kart });
          } else {
            existing.laps++;
            if (sec < existing.bestTime) { existing.bestTime = sec; existing.bestTimeStr = l.lap_time!; }
          }
        }

        const sorted = [...pilotBest.entries()].sort((a, b) => a[1].bestTime - b[1].bestTime);
        sorted.forEach(([pilot, pData], i) => {
          const qualiPos = qualifiedPilots.indexOf(pilot);
          rData.set(pilot, {
            group: groupNum,
            startPos: qualiPos >= 0 ? qualiPos + 1 : 0,
            finishPos: i + 1,
            bestTime: pData.bestTime,
            bestTimeStr: pData.bestTimeStr,
            laps: pData.laps,
            positionPoints: 0,
            overtakePoints: 0,
            speedPoints: 0,
            penalties: 0,
            totalRacePoints: 0,
          });
        });
      }
      raceData.push(rData);
    }

    // Build rows
    const allPilots = new Set<string>([...qualiData.keys()]);
    for (const rd of raceData) for (const p of rd.keys()) allPilots.add(p);

    const rows: PilotRow[] = [...allPilots].map(pilot => ({
      pilot,
      quali: qualiData.get(pilot) || null,
      races: raceData.map(rd => rd.get(pilot) || null),
      totalPoints: 0,
    }));

    rows.sort((a, b) => {
      if (a.totalPoints !== b.totalPoints) return b.totalPoints - a.totalPoints;
      const aq = a.quali?.bestTime ?? Infinity;
      const bq = b.quali?.bestTime ?? Infinity;
      return aq - bq;
    });

    return rows;
  }, [sessions, sessionLaps]);

  if (data.length === 0) return <div className="card text-center py-12 text-dark-500">Немає даних</div>;

  const raceLabels = Array.from({ length: raceCount }, (_, i) => `Гонка ${i + 1}`);

  return (
    <div className="space-y-4">
      {/* Points table */}
      {prefs.showLeaguePoints ? (
        <div className="relative">
          <button onClick={() => toggle('showLeaguePoints')}
            className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-md text-[10px] bg-dark-900/80 text-dark-400 hover:text-white transition-colors">
            сховати
          </button>
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-dark-800">
              <h3 className="text-white font-semibold text-sm">Таблиця балів</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-dark-800/50">
                    <th rowSpan={3} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 w-6">#</th>
                    <th rowSpan={3} className="px-2 py-1 text-left text-dark-300 font-semibold border-r border-dark-700 min-w-[100px]">Пілот</th>
                    <th colSpan={2} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700">Квала</th>
                    {raceLabels.map((label, ri) => (
                      <th key={ri} colSpan={8} className="px-2 py-1 text-center text-dark-300 font-semibold border-r border-dark-700 last:border-r-0">{label}</th>
                    ))}
                    <th rowSpan={3} className="px-2 py-1 text-center text-dark-300 font-semibold border-l border-dark-700 w-12">Всього</th>
                  </tr>
                  <tr className="bg-dark-800/30">
                    <th rowSpan={2} className="px-1 py-1 text-center text-dark-400 border-r border-dark-700/50">
                      <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Час</span>
                    </th>
                    <th rowSpan={2} className="px-1 py-1 text-center text-dark-400 border-r border-dark-700">
                      <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Карт</span>
                    </th>
                    {raceLabels.map((_, ri) => (
                      <Fragment key={ri}>
                        <th rowSpan={2} className="px-1 py-1 text-center text-dark-400 border-r border-dark-700/50">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Група</span>
                        </th>
                        <th rowSpan={2} className="px-1 py-1 text-center text-dark-400 border-r border-dark-700/50">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Старт</span>
                        </th>
                        <th rowSpan={2} className="px-1 py-1 text-center text-dark-400 border-r border-dark-700/50">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Фініш</span>
                        </th>
                        <th colSpan={4} className="px-1 py-1 text-center text-dark-400 border-r border-dark-700/50">Бали</th>
                        <th rowSpan={2} className="px-1 py-1 text-center text-dark-400 border-r border-dark-700">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Сума</span>
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                  <tr className="bg-dark-800/20">
                    {raceLabels.map((_, ri) => (
                      <Fragment key={ri}>
                        <th className="px-1 py-1 text-center text-dark-500 border-r border-dark-700/30">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Позиція</span>
                        </th>
                        <th className="px-1 py-1 text-center text-dark-500 border-r border-dark-700/30">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Обгони</span>
                        </th>
                        <th className="px-1 py-1 text-center text-dark-500 border-r border-dark-700/30">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Час</span>
                        </th>
                        <th className="px-1 py-1 text-center text-dark-500 border-r border-dark-700/50">
                          <span className="[writing-mode:vertical-lr] rotate-180 text-[9px]">Штрафи</span>
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={row.pilot} className="border-b border-dark-800/50 hover:bg-dark-700/30">
                      <td className="px-2 py-1 text-center font-mono text-white font-bold border-r border-dark-700">{i + 1}</td>
                      <td className="px-2 py-1 text-left text-white border-r border-dark-700">{row.pilot}</td>
                      <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/50">
                        {row.quali ? toSeconds(row.quali.bestTimeStr) : '—'}
                      </td>
                      <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700">
                        {row.quali?.kart || '—'}
                      </td>
                      {row.races.map((race, ri) => (
                        <Fragment key={ri}>
                          <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.group || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.startPos || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-300 border-r border-dark-700/30">{race?.finishPos || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.positionPoints || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.overtakePoints || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/30">{race?.speedPoints || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-500 border-r border-dark-700/50">{race?.penalties || '—'}</td>
                          <td className="px-1 py-1 text-center font-mono text-dark-300 font-bold border-r border-dark-700">{race?.totalRacePoints || '—'}</td>
                        </Fragment>
                      ))}
                      <td className="px-2 py-1 text-center font-mono text-green-400 font-bold border-l border-dark-700">
                        {row.totalPoints || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => toggle('showLeaguePoints')}
          className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-dark-800 text-dark-500 hover:text-white transition-colors">
          Показати таблицю балів
        </button>
      )}
    </div>
  );
}
