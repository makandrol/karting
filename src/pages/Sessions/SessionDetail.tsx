import { useParams, Link } from 'react-router-dom';
import { getEventById, type CompetitionPhase } from '../../mock/competitionEvents';
import SessionReplay from '../../components/Timing/SessionReplay';
import { TrackMap } from '../../components/Track';
import { useTrack } from '../../services/trackContext';
import { useState, useMemo, useEffect, useRef } from 'react';
import type { TimingEntry } from '../../types';

function pts(v: number): string {
  if (!v) return '—';
  return (Math.round(v * 10) / 10).toString();
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const event = getEventById(sessionId || '');
  const { allTracks } = useTrack();
  const [activePhaseId, setActivePhaseId] = useState<string | null>(() => {
    if (event && event.phases.length === 1) return event.phases[0].id;
    return null;
  });

  if (!event) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-white mb-2">Заїзд не знайдено</h1>
        <Link to="/sessions" className="text-primary-400 hover:underline text-sm">← Всі заїзди</Link>
      </div>
    );
  }

  const activePhase = activePhaseId ? event.phases.find(p => p.id === activePhaseId) : null;
  const track = allTracks.find(t => t.id === event.trackConfigId) || allTracks[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/sessions" className="text-dark-400 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">{event.name}</h1>
          <p className="text-dark-400 text-sm">
            {new Date(event.date).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' })} •
            Траса {event.trackConfigId} • {event.phases.length} фаз
          </p>
        </div>
      </div>

      {/* Phase tabs */}
      <div className="flex flex-wrap gap-1.5">
        {event.phases.map((phase) => (
          <button
            key={phase.id}
            onClick={() => setActivePhaseId(activePhaseId === phase.id ? null : phase.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activePhaseId === phase.id ? 'bg-primary-600 text-white' : 'bg-dark-800 text-dark-400 hover:text-white'
            }`}
          >
            {phase.type === 'qualifying' ? '⏱️' : '🏁'} {phase.name}
          </button>
        ))}
      </div>

      {activePhase ? (
        <PhaseView phase={activePhase} track={track} eventFormat={event.format} />
      ) : (
        <div className="card text-center py-8 text-dark-500 text-sm">
          Виберіть фазу для перегляду
        </div>
      )}
    </div>
  );
}

// ============================================================
// Phase View — all sections
// ============================================================

function PhaseView({ phase, track, eventFormat }: { phase: CompetitionPhase; track: any; eventFormat: string }) {
  const isLeagueRace = phase.type === 'race' && ['light_league', 'champions_league'].includes(eventFormat);
  const [replayProgress, setReplayProgress] = useState(0); // 0..1

  // Replay data
  const replayLaps = phase.results.flatMap(r =>
    r.laps.map(l => ({ pilot: r.pilot, kart: r.kart, lapNumber: l.lapNumber, lapTime: l.lapTime, s1: l.s1, s2: l.s2, position: r.position }))
  );
  const maxLaps = Math.max(...phase.results.map(r => r.laps.length), 1);
  const avgLapSec = phase.results[0]?.laps[0]?.lapTimeSec || 42;
  const durationSec = maxLaps * avgLapSec + 30;

  // Track entries synced with replay
  const trackEntries: TimingEntry[] = useMemo(() => {
    const pilots = [...new Set(phase.results.map(r => r.pilot))];
    return pilots.map((pilot, idx) => ({
      position: idx + 1, pilot,
      kart: replayLaps.find(l => l.pilot === pilot)?.kart || 0,
      lastLap: null, s1: null, s2: null, bestLap: null,
      lapNumber: 1, bestS1: null, bestS2: null,
      progress: replayProgress > 0 ? ((replayProgress * maxLaps + idx * 0.05) % 1) : 0,
      currentLapSec: null, previousLapSec: null,
    }));
  }, [replayProgress, phase.results, replayLaps, maxLaps]);

  return (
    <div className="space-y-6">
      {/* 0. Race results (only for LL/CL races) */}
      {isLeagueRace && <RaceResults phase={phase} />}

      {/* 1. All laps by pilots */}
      <LapsGrid phase={phase} />

      {/* 2. Replay — always visible */}
      {replayLaps.length > 0 && (
        <div className="space-y-4">
          <SessionReplay
            laps={replayLaps}
            durationSec={durationSec}
            title={phase.name}
            onTimeUpdate={(t) => setReplayProgress(t / durationSec)}
          />

          {track?.svgPath && (
            <div>
              <div className="text-dark-500 text-xs mb-2">Трек</div>
              <TrackMap track={track} entries={trackEntries} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 0. Race Results (LL/CL only)
// ============================================================

function RaceResults({ phase }: { phase: CompetitionPhase }) {
  const sorted = [...phase.results].sort((a, b) => a.position - b.position);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Результати: {phase.name}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-left">Пілот</th>
              <th className="table-cell text-center">Старт</th>
              <th className="table-cell text-center">Фініш</th>
              <th className="table-cell text-center">Обгони</th>
              <th className="table-cell text-right">За позицію</th>
              <th className="table-cell text-right">За обгони</th>
              <th className="table-cell text-right font-bold">Сума</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const overtakes = (r.startPosition || 0) - r.position;
              return (
                <tr key={r.pilot} className="table-row">
                  <td className="table-cell text-left">
                    <span className={`font-mono font-bold mr-2 ${r.position <= 3 ? `position-${r.position}` : 'text-dark-400'}`}>{r.position}</span>
                    <Link to={`/pilots/${encodeURIComponent(r.pilot)}`} className="text-white hover:text-primary-400 transition-colors">{r.pilot}</Link>
                  </td>
                  <td className="table-cell text-center font-mono text-dark-400">{r.startPosition || '—'}</td>
                  <td className="table-cell text-center font-mono text-dark-200 font-semibold">{r.position}</td>
                  <td className={`table-cell text-center font-mono ${overtakes > 0 ? 'text-green-400' : overtakes < 0 ? 'text-red-400' : 'text-dark-500'}`}>
                    {overtakes > 0 ? `+${overtakes}` : overtakes < 0 ? overtakes : '—'}
                  </td>
                  <td className="table-cell text-right font-mono text-dark-300">{pts(r.positionPoints || 0)}</td>
                  <td className="table-cell text-right font-mono text-dark-300">{pts(r.overtakePoints || 0)}</td>
                  <td className="table-cell text-right font-mono text-primary-400 font-bold">{pts(r.points || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// 1. Laps Grid
// ============================================================

function LapsGrid({ phase }: { phase: CompetitionPhase }) {
  const pilotBests = new Map<string, number>();
  for (const r of phase.results) {
    for (const l of r.laps) {
      const prev = pilotBests.get(r.pilot) || Infinity;
      if (l.lapTimeSec < prev) pilotBests.set(r.pilot, l.lapTimeSec);
    }
  }

  const sortedPilots = [...pilotBests.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
  const pilotLaps = new Map<string, { lapTime: string; lapTimeSec: number }[]>();
  for (const r of phase.results) {
    pilotLaps.set(r.pilot, r.laps.map(l => ({ lapTime: l.lapTime, lapTimeSec: l.lapTimeSec })));
  }

  const maxLaps = Math.max(...[...pilotLaps.values()].map(l => l.length), 0);
  const overallBest = Math.min(...[...pilotBests.values()]);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-800">
        <h3 className="text-white font-semibold">Кола по пілотах</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-center w-8">Коло</th>
              {sortedPilots.map(p => (
                <th key={p} className="table-cell text-center min-w-[80px]">
                  <Link to={`/pilots/${encodeURIComponent(p)}`} className="text-white hover:text-primary-400 transition-colors">
                    {p.split(' ')[0]}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxLaps }, (_, lapIdx) => (
              <tr key={lapIdx} className="table-row">
                <td className="table-cell text-center font-mono text-dark-500">{lapIdx + 1}</td>
                {sortedPilots.map(pilot => {
                  const lap = pilotLaps.get(pilot)?.[lapIdx];
                  if (!lap) return <td key={pilot} className="table-cell text-center text-dark-700">—</td>;
                  const isBest = pilotBests.get(pilot) === lap.lapTimeSec;
                  const isOverall = Math.abs(lap.lapTimeSec - overallBest) < 0.002;
                  return (
                    <td key={pilot} className={`table-cell text-center font-mono ${
                      isOverall ? 'text-purple-400 font-bold' : isBest ? 'text-green-400 font-bold' : 'text-dark-300'
                    }`}>{lap.lapTime}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// (TrackMap synced via onTimeUpdate callback from SessionReplay)
