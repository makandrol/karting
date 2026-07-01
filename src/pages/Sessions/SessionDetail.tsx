import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../services/api';
import { toSeconds, parseTime, KART_COLOR } from '../../utils/timing';
import { buildGonzalesKartPilotMap } from '../../utils/gonzalesPilotResolver';
import { fmtTime, fmtDuration } from '../../utils/datetime';
import { LoadingState } from '../../components/States';
import { useAuth } from '../../services/auth';
import SessionReplay, { type ReplaySortMode } from '../../components/Timing/SessionReplay';
import LapsByPilots, { buildPilotLaps } from '../../components/Timing/LapsByPilots';
import MarathonResults from '../../components/Results/MarathonResults';
import SessionTypeChanger from '../../components/Timing/SessionTypeChanger';
import { TrackMap } from '../../components/Track';
import { useTrack } from '../../services/trackContext';
import { trackDisplayId, isReverseTrack, baseTrackId } from '../../data/tracks';
import { useLayoutPrefs, PAGE_SECTIONS } from '../../services/layoutPrefs';
import TableLayoutBar from '../../components/TableLayoutBar';
import type { TimingEntry } from '../../types';
import { buildReplayLaps, extractCompetitionReplayProps } from '../../utils/session';
import { parseMarathon, buildMarathonLapColumns, buildMarathonStartPositions, buildMarathonReplayLaps, buildMarathonReplayStartPositions } from '../../utils/marathon';
import { lazy, Suspense } from 'react';
import { useSessionData } from './useSessionData';

const Onboard = lazy(() => import('../Info/Onboard'));

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { allTracks } = useTrack();
  const { isOwner, hasPermission } = useAuth();
  const canChangeTrack = hasPermission('change_track');

  const {
    session: dbSession, setSession: setDbSession,
    daySessions, laps: dbLaps, setLaps: setDbLaps,
    s1Events, snapshots: replaySnapshots, rawEvents,
    startPositions, totalQualifiedPilots,
    sessionFormat, liveEntries,
    excludedLaps, setExcludedLaps,
    loading: dbLoading,
  } = useSessionData(sessionId);

  const [trackEntries, setTrackEntries] = useState<TimingEntry[]>([]);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [replayTimeSec, setReplayTimeSec] = useState<number | undefined>(undefined);
  const [pitRowOverrides, setPitRowOverrides] = useState<Record<string, 'L' | 'R'>>({});

  // Гонзалес: мапа (kart) → реальне ім'я з ротації змагання, щоб показувати
  // "Карт 16 (Апанасенко)" — raw timing + наше відоме ім'я в дужках.
  const compFormat = (dbSession as any)?.competition_format as string | null;
  const compPhaseRaw = (dbSession as any)?.competition_phase as string | null;
  const compIdRaw = (dbSession as any)?.competition_id as string | null;
  const isGonzalesRound = compFormat === 'gonzales' && !!compPhaseRaw && /^round_\d+/.test(compPhaseRaw);
  const [gonzKartPilot, setGonzKartPilot] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isGonzalesRound || !compIdRaw || !sessionId) { setGonzKartPilot(new Map()); return; }
    let active = true;
    (async () => {
      try {
        const comp: any = await api.competitions.getNormalized(compIdRaw);
        const cfg = comp?.results?.gonzalesConfig;
        if (!cfg?.pilotStartSlots || !active) return;
        const pilotCount = Object.keys(cfg.pilotStartSlots).length;
        const karts = cfg.kartList && cfg.kartList.length > 0 ? cfg.kartList : Array.from({ length: 12 }, (_, i) => i + 1);
        const map = buildGonzalesKartPilotMap([{ sessionId, phase: compPhaseRaw }], cfg, karts, pilotCount);
        // Ключі мапи — `${sessionId}|${kart}`; зведемо до kart→pilot для цієї сесії.
        const byKart = new Map<string, string>();
        for (const [k, v] of map) { const kart = k.split('|')[1]; if (kart) byKart.set(kart, v); }
        if (active) setGonzKartPilot(byKart);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [isGonzalesRound, compIdRaw, sessionId, compPhaseRaw]);

  /** kart → resolved name з ремапу колектора (resolved_pilot на лапах). */
  const kartResolvedFromLapsMemo = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of dbLaps) {
      if (l.resolved_pilot && !m.has(l.kart)) m.set(l.kart, l.resolved_pilot);
    }
    return m;
  }, [dbLaps]);

  /** Display-ім'я пілота: raw timing + наше ім'я в дужках. */
  const displayPilot = useMemo(() => (pilot: string, kart: number): string => {
    // Для Гонзалес-round беремо ім'я з ротації; інакше — з ремапу колектора (resolved_pilot).
    const resolved = isGonzalesRound
      ? gonzKartPilot.get(String(kart))
      : kartResolvedFromLapsMemo.get(kart);
    return resolved && resolved !== pilot ? `${pilot} (${resolved})` : pilot;
  }, [isGonzalesRound, gonzKartPilot, kartResolvedFromLapsMemo]);

  const { isSectionVisible, getPageLayout } = useLayoutPrefs();
  const sessionLayout = getPageLayout('sessionDetail');

  // Marathon: parse events once → per-team lap columns + start positions (race mode).
  const marathonLapData = useMemo(() => {
    if (compFormat !== 'marathon' || rawEvents.length === 0) return null;
    const model = parseMarathon(rawEvents);
    return {
      columns: buildMarathonLapColumns(model),
      startPositions: buildMarathonStartPositions(model),
      replayLaps: buildMarathonReplayLaps(model),
      replayStartPositions: buildMarathonReplayStartPositions(model),
      teamCount: model.teams.length,
    };
  }, [compFormat, rawEvents]);

  const handleRenamePilot = async (oldName: string, newName: string) => {
    if (!sessionId) return;
    const sessionIds = dbSession?.merged_session_ids || [sessionId];
    for (const sid of sessionIds) {
      await api.sessions.renamePilot(sid, oldName, newName).catch(() => {});
    }
    window.location.reload();
  };

  const handleChangeTrack = async (newTrackId: number) => {
    if (!sessionId || !dbSession) return;
    const isCompSession = !!(dbSession as any)?.competition_id;
    try {
      if (isCompSession) {
        const sessionIds = dbSession.merged_session_ids || [sessionId];
        await api.sessions.updateTrack(sessionIds, newTrackId);
      } else {
        await api.sessions.propagateTrack(sessionId, newTrackId);
      }
      setDbSession({ ...dbSession, track_id: newTrackId });
    } catch { /* ignore */ }
  };

  const handleToggleLap = async (lapKey: string) => {
    const next = new Set(excludedLaps);
    next.has(lapKey) ? next.delete(lapKey) : next.add(lapKey);
    setExcludedLaps(next);
    try {
      await api.laps.toggleExcluded(lapKey);
    } catch {}
  };

  // Редагування часу кола: ключ "sessionId|pilot|ts". Оптимістично оновлюємо
  // локальні laps (edited + original_lap_time), потім пишемо в колектор.
  const handleEditLap = async (lapKey: string, newLapTime: string, originalLapTime: string | null) => {
    const parts = lapKey.split('|');
    const ts = Number(parts[parts.length - 1]);
    const pilot = parts.slice(1, -1).join('|');
    setDbLaps(prev => prev.map(l =>
      l.ts === ts && l.pilot === pilot
        ? { ...l, lap_time: newLapTime, edited: true, original_lap_time: l.edited ? (l.original_lap_time ?? originalLapTime) : (originalLapTime ?? l.lap_time) }
        : l,
    ));
    try {
      await api.laps.setEdited(lapKey, newLapTime, originalLapTime);
    } catch {}
  };

  const handleRevertLap = async (lapKey: string) => {
    const parts = lapKey.split('|');
    const ts = Number(parts[parts.length - 1]);
    const pilot = parts.slice(1, -1).join('|');
    setDbLaps(prev => prev.map(l =>
      l.ts === ts && l.pilot === pilot
        ? { ...l, lap_time: l.original_lap_time ?? l.lap_time, edited: false, original_lap_time: null }
        : l,
    ));
    try {
      await api.laps.revertEdited(lapKey);
    } catch {}
  };

  if (dbLoading) {
    return <LoadingState />;
  }

  if (!dbSession) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">📊</div>
        <h1 className="text-2xl font-bold text-white mb-2">Заїзд не знайдено</h1>
        <Link to="/sessions" className="text-primary-400 hover:underline text-sm">← Всі заїзди</Link>
      </div>
    );
  }

  const mergedLaps = dbLaps;
  const pilots = buildPilotLaps(
    mergedLaps.filter(l => l.lap_time).map(l => ({ pilot: l.pilot, kart: l.kart, lap_time: l.lap_time, s1: l.s1, s2: l.s2, ts: l.ts, position: l.position })),
    excludedLaps.size > 0 ? excludedLaps : undefined,
    sessionId,
  );

  const dateStr = new Date(dbSession.start_time).toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' });
  const pilotCount = pilots.length > 0 ? pilots.length : (liveEntries.length > 0 ? liveEntries.length : (dbSession.real_pilot_count ?? 0));

  const currentIdx = daySessions.findIndex(s => s.id === sessionId);
  const dayOrder = (dbSession as any).day_order ?? (currentIdx >= 0 ? currentIdx + 1 : null);
  const prevSession = currentIdx > 0 ? daySessions[currentIdx - 1] : null;
  const nextSession = currentIdx >= 0 && currentIdx < daySessions.length - 1 ? daySessions[currentIdx + 1] : null;

  const compPhaseStr = (dbSession as any).competition_phase as string | null;
  const { raceGroup, isRace } = extractCompetitionReplayProps(compPhaseStr);
  const isMarathon = compFormat === 'marathon';

  return (
    <div className="space-y-6">
      <TableLayoutBar pageId="sessionDetail" sections={PAGE_SECTIONS.sessionDetail} />
      <div className="flex items-center gap-3">
        <Link to="/sessions" className="text-dark-400 hover:text-white transition-colors flex-shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">
              Заїзд {dayOrder ?? ''}
            </h1>
            <div className="flex items-center gap-1 border border-dark-700 rounded px-2 py-1">
              <svg className="w-3.5 h-3.5 text-dark-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              {canChangeTrack ? (
                <select
                  value={dbSession.track_id}
                  onChange={(e) => handleChangeTrack(parseInt(e.target.value, 10))}
                  className="bg-transparent text-dark-300 text-xs outline-none w-10 cursor-pointer"
                >
                  {[...allTracks].sort((a, b) => {
                    const aR = isReverseTrack(a.id) ? 1 : 0;
                    const bR = isReverseTrack(b.id) ? 1 : 0;
                    if (aR !== bR) return aR - bR;
                    return baseTrackId(a.id) - baseTrackId(b.id);
                  }).map((t) => (
                    <option key={t.id} value={t.id}>{trackDisplayId(t.id)}</option>
                  ))}
                </select>
              ) : (
                <span className="text-dark-300 text-xs font-mono">{trackDisplayId(dbSession.track_id)}</span>
              )}
            </div>
            <SessionTypeChanger
              sessionId={sessionId!}
              currentFormat={(dbSession as any).competition_format || null}
              currentPhase={compPhaseStr}
              currentCompetitionId={(dbSession as any).competition_id || null}
              onChanged={() => window.location.reload()}
            />
          </div>
          <p className="text-dark-400 text-sm">
            {dateStr}, {fmtTime(dbSession.start_time)}
            {dbSession.end_time && ` – ${fmtTime(dbSession.end_time)}`}
            {dbSession.end_time && ` · ${fmtDuration(dbSession.start_time, dbSession.end_time)}`}
            {` · ${pilotCount} пілотів`}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {dbSession.end_time && dbLaps.length > 0 && (
            <button onClick={() => setOnboardOpen(true)}
              className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
              title="Онборд">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </button>
          )}
          {prevSession ? (
            <Link to={`/sessions/${prevSession.id}`}
              className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
              title={`Заїзд ${prevSession.race_number ?? ''}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          ) : (
            <span className="p-1.5 text-dark-700"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></span>
          )}
          {nextSession ? (
            <Link to={`/sessions/${nextSession.id}`}
              className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors"
              title={`Заїзд ${nextSession.race_number ?? ''}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ) : (
            <span className="p-1.5 text-dark-700"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></span>
          )}
        </div>
      </div>

      {isMarathon ? (
        <>
          {!dbSession.end_time && (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Гонка активна — дані оновлюються кожні 3 секунди
            </div>
          )}
          {(() => {
            const replayLaps = marathonLapData?.replayLaps ?? [];
            const realDurationSec = dbSession.end_time
              ? Math.round((dbSession.end_time - dbSession.start_time) / 1000)
              : Math.round((Date.now() - dbSession.start_time) / 1000);
            const track = allTracks.find(t => t.id === dbSession.track_id) || allTracks[0];
            const lapsByPilotsEl = (
              <LapsByPilots key="lapsByPilots"
                pilots={(marathonLapData?.columns ?? []) as any}
                currentEntries={trackEntries}
                isLive={!dbSession.end_time}
                sessionId={sessionId}
                startPositions={marathonLapData?.startPositions}
                marathon />
            );
            const marathonPitEl = (
              <MarathonResults key="marathonPit"
                events={rawEvents}
                sessionStartTime={dbSession.start_time}
                currentTimeSec={replayTimeSec}
                sections={['marathonPit']}
                pitRowOverrides={pitRowOverrides}
                onPitRowOverridesChange={isOwner ? setPitRowOverrides : undefined} />
            );
            const marathonTeamsEl = (
              <MarathonResults key="marathonTeams"
                events={rawEvents}
                sessionStartTime={dbSession.start_time}
                currentTimeSec={replayTimeSec}
                sections={['marathonTeams']} />
            );
            const marathonKartsEl = (
              <MarathonResults key="marathonKarts"
                events={rawEvents}
                sessionStartTime={dbSession.start_time}
                sections={['marathonKarts']} />
            );

            if (replayLaps.length === 0) {
              return (
                <>
                  {marathonPitEl}
                  {marathonTeamsEl}
                  {marathonKartsEl}
                </>
              );
            }

            return (
              <SessionReplay
                laps={replayLaps}
                durationSec={realDurationSec}
                sessionStartTime={dbSession.start_time}
                isLive={!dbSession.end_time}
                raceNumber={dbSession.race_number}
                autoPlay={true}
                startPositions={marathonLapData?.replayStartPositions}
                hidePoints
                defaultSortMode={'race' as ReplaySortMode}
                onEntriesUpdate={setTrackEntries}
                onTimeUpdate={setReplayTimeSec}
                useRealLapTimes
                renderScrubber={(scrubber) => (
                  <div className="sticky top-0 z-10 bg-dark-900/95 backdrop-blur-sm border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
                    {scrubber}
                  </div>
                )}
                renderContent={({ scrubber, table }) => {
                  const sectionMap: Record<string, ReactNode> = {
                    replay: scrubber,
                    timingTable: table,
                    track: track?.svgPath ? <TrackMap track={track} entries={trackEntries} static /> : null,
                    lapsByPilots: lapsByPilotsEl,
                    marathonPit: marathonPitEl,
                    marathonTeams: marathonTeamsEl,
                    marathonKarts: marathonKartsEl,
                  };
                  return (
                    <>
                      {sessionLayout.map(s => {
                        if (!s.visible || !sectionMap[s.id]) return null;
                        return <div key={s.id}>{sectionMap[s.id]}</div>;
                      })}
                    </>
                  );
                }}
              />
            );
          })()}
        </>
      ) : pilots.length === 0 && liveEntries.length === 0 ? (
        <div className="card text-center py-8 text-dark-500 text-sm">
          {!dbSession.end_time ? 'Заїзд активний, кола ще не зафіксовані' : 'Немає даних кіл для цього заїзду'}
        </div>
      ) : pilots.length === 0 && liveEntries.length > 0 ? (
        <>
          {!dbSession.end_time && (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Заїзд активний — дані оновлюються кожні 3 секунди
            </div>
          )}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-dark-800">
              <h3 className="text-white font-semibold">Пілоти на трасі</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="table-header">
                    <th className="table-cell text-center w-10">#</th>
                    <th className="table-cell text-left">Пілот</th>
                    <th className="table-cell text-center">Карт</th>
                    <th className="table-cell text-center">Кіл</th>
                    <th className="table-cell text-right">Останній час</th>
                    <th className="table-cell text-right">Найкращий</th>
                  </tr>
                </thead>
                <tbody>
                  {liveEntries.map((e: any, i: number) => (
                    <tr key={e.pilot} className="table-row">
                      <td className="table-cell text-center font-mono font-bold text-white">{e.position || i + 1}</td>
                      <td className="table-cell text-left text-white">{displayPilot(e.pilot, e.kart)}</td>
                      <td className={`table-cell text-center font-mono ${KART_COLOR}`}>{e.kart}</td>
                      <td className="table-cell text-center font-mono text-dark-300">{e.lapNumber || 0}</td>
                      <td className="table-cell text-right font-mono text-dark-300">{toSeconds(e.lastLap)}</td>
                      <td className="table-cell text-right font-mono text-green-400 font-semibold">{toSeconds(e.bestLap)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          {!dbSession.end_time && (
            <div className="flex items-center gap-2 text-green-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Заїзд активний — дані оновлюються кожні 3 секунди
            </div>
          )}

          {dbSession.end_time && dbLaps.length > 0 && (() => {
            const replayLaps = buildReplayLaps(mergedLaps);
            const realDurationSec = dbSession.end_time
              ? Math.round((dbSession.end_time - dbSession.start_time) / 1000)
              : Math.max(...dbLaps.map(l => l.lap_number), 1) * (parseTime(dbLaps.find(l => l.lap_time)?.lap_time ?? null) || 42) + 30;
            const track = allTracks.find(t => t.id === dbSession.track_id) || allTracks[0];

            const lapsByPilotsEl = (
              <LapsByPilots key="lapsByPilots" pilots={pilots} currentEntries={trackEntries} onRenamePilot={isOwner ? handleRenamePilot : undefined}
                excludedLaps={excludedLaps.size > 0 ? excludedLaps : undefined}
                onToggleLap={isOwner ? handleToggleLap : undefined}
                onEditLap={isOwner ? handleEditLap : undefined}
                onRevertLap={isOwner ? handleRevertLap : undefined}
                sessionId={sessionId}
                pilotDisplayName={displayPilot}
                startPositions={isRace ? startPositions : undefined} />
            );

            return replayLaps.length > 0 ? (
              <SessionReplay
                laps={replayLaps}
                durationSec={realDurationSec}
                sessionStartTime={dbSession.start_time}
                raceNumber={dbSession.race_number}
                autoPlay={true}
                s1Events={s1Events}
                snapshots={replaySnapshots}
                startPositions={startPositions}
                raceGroup={raceGroup}
                totalQualifiedPilots={totalQualifiedPilots || undefined}
                hidePoints={sessionFormat === 'sprint'}
                defaultSortMode={isRace ? 'race' as ReplaySortMode : 'qualifying' as ReplaySortMode}
                onEntriesUpdate={setTrackEntries}
                renderScrubber={(scrubber) => (
                  <div className="sticky top-0 z-10 bg-dark-900/95 backdrop-blur-sm border border-dark-700 px-4 py-2.5 rounded-xl mb-2">
                    {scrubber}
                  </div>
                )}
                renderContent={({ scrubber, table }) => {
                  const sectionMap: Record<string, ReactNode> = {
                    replay: scrubber,
                    timingTable: table,
                    track: track?.svgPath ? <TrackMap track={track} entries={trackEntries} static /> : null,
                    lapsByPilots: lapsByPilotsEl,
                  };
                  return (
                    <>
                      {sessionLayout.map(s => {
                        if (!s.visible || !sectionMap[s.id]) return null;
                        return <div key={s.id}>{sectionMap[s.id]}</div>;
                      })}
                    </>
                  );
                }}
              />
            ) : lapsByPilotsEl;
          })()}

          {!(dbSession.end_time && dbLaps.length > 0) && (
            <LapsByPilots key="lapsByPilots" pilots={pilots} currentEntries={trackEntries} onRenamePilot={isOwner ? handleRenamePilot : undefined}
              excludedLaps={excludedLaps.size > 0 ? excludedLaps : undefined}
              onToggleLap={isOwner ? handleToggleLap : undefined}
              onEditLap={isOwner ? handleEditLap : undefined}
              onRevertLap={isOwner ? handleRevertLap : undefined}
              sessionId={sessionId}
              pilotDisplayName={displayPilot}
              startPositions={isRace ? startPositions : undefined} />
          )}
        </>
      )}

      {onboardOpen && createPortal(
        <Suspense fallback={null}>
          <Onboard
            replayEntries={trackEntries}
            replaySessionId={sessionId!}
            onClose={() => setOnboardOpen(false)}
          />
        </Suspense>,
        document.body
      )}
    </div>
  );
}
