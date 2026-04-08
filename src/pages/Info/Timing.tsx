import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { TrackMap } from '../../components/Track';
import DayTimeline from '../../components/Timing/DayTimeline';
import SessionReplay, { type S1Event, type ReplaySortMode, type SnapshotPosition, parseSessionEvents } from '../../components/Timing/SessionReplay';
import { useTimingPoller } from '../../services/timingPoller';
import { useTrack } from '../../services/trackContext';
import { trackDisplayId, isReverseTrack, baseTrackId } from '../../data/tracks';
import { useAuth } from '../../services/auth';
import { COLLECTOR_URL } from '../../services/config';
import { Link, useNavigate } from 'react-router-dom';
import { shortName, fetchRaceStartPositions, isValidSession } from '../../utils/timing';
import type { TimingEntry } from '../../types';
import SessionsTable from '../../components/Sessions/SessionsTable';
import LapsByPilots, { buildPilotLaps } from '../../components/Timing/LapsByPilots';
import SessionTypeChanger from '../../components/Timing/SessionTypeChanger';
import { useLayoutPrefs, PAGE_SECTIONS } from '../../services/layoutPrefs';
import TableLayoutBar from '../../components/TableLayoutBar';
import { type DbLap, buildReplayLaps, extractCompetitionReplayProps } from '../../utils/session';

export default function Timing() {
  const navigate = useNavigate();
  const { entries, mode, lastUpdate, error, collectorStatus } = useTimingPoller({
    interval: 1000,
  });
  const { currentTrack, setCurrentTrack, allTracks } = useTrack();
  const { hasPermission } = useAuth();
  const canChangeTrack = hasPermission('change_track');

  const isLive = mode === 'live';
  const isConnecting = mode === 'connecting';
  const isOffline = mode === 'idle';
  const hasData = entries.length > 0;
  const collectorConnected = collectorStatus !== null;
  const siteReachable = collectorStatus?.siteReachable ?? false;
  const currentSessionId = (collectorStatus as any)?.sessionId || null;
  const currentRaceNumber = (collectorStatus as any)?.raceNumber ?? null;

  const competition = (collectorStatus as any)?.competition ?? null;
  const isCompetition = competition?.state && !['none', 'finished'].includes(competition.state);
  const sessionType = isCompetition ? (competition.competition?.name || 'Змагання') : 'Прокат';

  const [liveSessionComp, setLiveSessionComp] = useState<{ competitionId: string | null; format: string | null; phase: string | null }>({ competitionId: null, format: null, phase: null });
  useEffect(() => {
    if (!currentSessionId) { setLiveSessionComp({ competitionId: null, format: null, phase: null }); return; }
    fetch(`${COLLECTOR_URL}/db/session-competition?session=${currentSessionId}`)
      .then(r => r.json())
      .then(data => setLiveSessionComp({ competitionId: data.competitionId || null, format: data.format || null, phase: data.phase || null }))
      .catch(() => {});
  }, [currentSessionId]);

  // Compute start positions from competition data (qualifying / previous race)
  useEffect(() => {
    if (!liveSessionComp.competitionId || !(liveSessionComp.phase?.startsWith('race_') || liveSessionComp.phase?.startsWith('final_')) || !liveSessionComp.format) {
      setStartPositions(new Map()); setTotalQualifiedPilots(0); return;
    }
    fetchRaceStartPositions(COLLECTOR_URL, liveSessionComp.competitionId, liveSessionComp.phase, liveSessionComp.format)
      .then(r => { setStartPositions(r.positions); setTotalQualifiedPilots(r.totalQualified); })
      .catch(() => { setStartPositions(new Map()); setTotalQualifiedPilots(0); });
  }, [liveSessionComp.competitionId, liveSessionComp.phase, liveSessionComp.format]);

  // Fetch laps for active session (for replay)
  const [replayLaps, setReplayLaps] = useState<DbLap[]>([]);
  const [s1Events, setS1Events] = useState<S1Event[]>([]);
  const [replaySnapshots, setReplaySnapshots] = useState<SnapshotPosition[]>([]);
  const [startPositions, setStartPositions] = useState<Map<string, number>>(new Map());
  const [totalQualifiedPilots, setTotalQualifiedPilots] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [trackEntries, setTrackEntries] = useState<TimingEntry[]>([]);

  interface RecentSession {
    id: string; start_time: number; end_time: number | null; pilot_count: number;
    real_pilot_count: number | null; race_number: number | null; track_id: number;
    best_lap_time: string | null; best_lap_pilot: string | null; best_lap_kart: number | null;
  }
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);

  useEffect(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fetch(`${COLLECTOR_URL}/db/sessions?date=${todayStr}`)
      .then(r => r.json())
      .then((data: RecentSession[]) => {
        setRecentSessions(data.filter(s => s.end_time && isValidSession(s)).slice(-5).reverse());
      })
      .catch(() => {});
  }, []);

  const fetchLaps = useCallback(async () => {
    if (!currentSessionId) { setReplayLaps([]); setS1Events([]); setReplaySnapshots([]); return; }
    try {
      const [lapsRes, eventsRes] = await Promise.all([
        fetch(`${COLLECTOR_URL}/db/laps?session=${currentSessionId}`).then(r => r.json()),
        fetch(`${COLLECTOR_URL}/db/events?session=${currentSessionId}`).then(r => r.json()).catch(() => []),
      ]);
      setReplayLaps(lapsRes);
      const parsed = parseSessionEvents(eventsRes);
      setS1Events(parsed.s1Events);
      setReplaySnapshots(parsed.snapshots);
      if (!liveSessionComp.competitionId || !liveSessionComp.phase?.startsWith('race_')) {
        if (parsed.firstSnapshotPos) setStartPositions(parsed.firstSnapshotPos);
      }
    } catch { /* ignore */ }
  }, [currentSessionId, liveSessionComp.competitionId, liveSessionComp.phase]);

  // Get session start time
  useEffect(() => {
    if (!currentSessionId) { setSessionStartTime(null); return; }
    const m = currentSessionId.match(/session-(\d+)/);
    if (m) setSessionStartTime(parseInt(m[1]));
  }, [currentSessionId]);

  // Fetch laps periodically when live
  useEffect(() => {
    if (!currentSessionId || !isLive) return;
    fetchLaps();
    const timer = setInterval(fetchLaps, 3000);
    return () => clearInterval(timer);
  }, [currentSessionId, isLive, fetchLaps]);

  const replayData = buildReplayLaps(replayLaps);

  const replayPilots = buildPilotLaps(replayLaps.filter(l => l.lap_time).map(l => ({ pilot: l.pilot, kart: l.kart, lap_time: l.lap_time, s1: l.s1, s2: l.s2, position: l.position })));
  const { isSectionVisible, getPageLayout } = useLayoutPrefs();
  const timingLayout = getPageLayout('timing');
  const hasReplayData = sessionStartTime != null && currentSessionId != null;
  const { raceGroup: liveRaceGroup, isRace: liveIsRace } = extractCompetitionReplayProps(liveSessionComp.phase);
  const replayDuration = sessionStartTime
    ? Math.round((Date.now() - sessionStartTime) / 1000)
    : 600;

  return (
    <div className="space-y-4">
      <TableLayoutBar pageId="timing" sections={PAGE_SECTIONS.timing} />

      {/* ===== STATUS BAR ===== */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
          isLive && hasData ? 'bg-green-500/10 text-green-400' :
          isLive ? 'bg-green-500/10 text-green-400/60' :
          isConnecting ? 'bg-blue-500/10 text-blue-400' :
          siteReachable ? 'bg-yellow-500/10 text-yellow-400' :
          'bg-dark-800 text-dark-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            isLive && hasData ? 'bg-green-400 animate-pulse' :
            isLive ? 'bg-green-400/50 animate-pulse' :
            isConnecting ? 'bg-blue-400 animate-pulse' :
            siteReachable ? 'bg-yellow-400 animate-pulse' :
            'bg-dark-500'
          }`} />
          {isLive && hasData ? (
            currentRaceNumber != null
              ? <>Заїзд №{currentRaceNumber}{sessionStartTime && <LiveTimer startTime={sessionStartTime} />}</>
              : 'LIVE'
          ) :
           isLive ? 'Online' :
           isConnecting ? 'Підключення...' :
           siteReachable ? 'Очікування заїзду' :
           'Офлайн'}
        </div>

        <div className="flex items-center gap-1 border border-dark-700 rounded px-2 py-1">
          <svg className="w-3.5 h-3.5 text-dark-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          {canChangeTrack ? (
            <select
              value={currentTrack.id}
              onChange={(e) => setCurrentTrack(parseInt(e.target.value, 10))}
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
            <span className="text-dark-300 text-xs font-mono">{trackDisplayId(currentTrack.id)}</span>
          )}
        </div>

        {(isLive && hasData) && (
          <SessionTypeChanger
            sessionId={currentSessionId}
            currentFormat={liveSessionComp.format}
            currentPhase={liveSessionComp.phase}
            currentCompetitionId={liveSessionComp.competitionId}
            onChanged={() => {
              if (currentSessionId) {
                fetch(`${COLLECTOR_URL}/db/session-competition?session=${currentSessionId}`)
                  .then(r => r.json())
                  .then(data => setLiveSessionComp({ competitionId: data.competitionId || null, format: data.format || null, phase: data.phase || null }))
                  .catch(() => {});
              }
            }}
          />
        )}

      </div>

      {/* ===== OFFLINE / CONNECTING ===== */}
      {(isOffline || isConnecting) && !hasData && (
        <div className="space-y-4">
          <div className="card text-center py-8 space-y-3">
            <div className="text-4xl">{isConnecting ? '🔄' : siteReachable ? '⏳' : collectorConnected ? '🏎️' : '🔌'}</div>
            <div>
              <h2 className="text-lg font-bold text-white mb-1">
                {isConnecting ? 'Підключення до сервера...' :
                 siteReachable ? 'Очікування заїзду' :
                 collectorConnected ? 'Таймінг картодрому недоступний' :
                 'Сервер збору даних недоступний'}
              </h2>
              <p className="text-dark-400 text-sm max-w-md mx-auto">
                {isConnecting
                  ? 'Зачекайте, встановлюється з\'єднання з сервером...'
                  : siteReachable
                  ? 'Картодром працює, але зараз немає активних заїздів. Дані з\'являться автоматично.'
                  : collectorConnected
                  ? 'Система таймінгу картодрому зараз не відповідає. Дані з\'являться автоматично, як тільки вона стане доступною.'
                  : 'Перевірте з\'єднання з сервером або спробуйте пізніше.'}
              </p>
              {siteReachable && recentSessions.length > 0 && (() => {
                const lastFinished = recentSessions.find(s => s.end_time && isValidSession(s));
                return lastFinished?.end_time ? <IdleTimer sinceMs={lastFinished.end_time} /> : null;
              })()}
            </div>
          </div>

          {recentSessions.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <SessionsTable sessions={recentSessions} />
            </div>
          )}

          <Link to="/sessions" className="block text-center text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors">
            Всі заїзди →
          </Link>
        </div>
      )}

      {/* ===== LIVE SESSION ===== */}
      {(hasData || siteReachable) && (
        <>
          {hasReplayData ? (
            <SessionReplay
              laps={replayData}
              durationSec={replayDuration}
              sessionStartTime={sessionStartTime!}
              isLive={true}
              raceNumber={currentRaceNumber}
              autoPlay={true}
              liveEntries={entries}
              s1Events={s1Events}
              snapshots={replaySnapshots}
              startPositions={startPositions}
              raceGroup={liveRaceGroup}
              totalQualifiedPilots={totalQualifiedPilots || undefined}
              hidePoints={liveSessionComp.format === 'sprint'}
              defaultSortMode={liveIsRace ? 'race' as ReplaySortMode : 'qualifying' as ReplaySortMode}
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
                  track: <TrackMap track={currentTrack} entries={trackEntries} static />,
                  lapsByPilots: <LapsByPilots pilots={replayPilots} currentEntries={trackEntries} isLive startPositions={liveIsRace ? startPositions : undefined} />,
                  history: (
                    <DayTimeline
                      isTimingOnline={isLive}
                      isTimingIdle={siteReachable && !isLive}
                      idleSince={collectorStatus?.siteReachableSince ?? null}
                    />
                  ),
                };
                return (
                  <>
                    {timingLayout.map(s => {
                      if (!s.visible || !sectionMap[s.id]) return null;
                      return <div key={s.id}>{sectionMap[s.id]}</div>;
                    })}
                  </>
                );
              }}
            />
          ) : (
            <>
              {isSectionVisible('timing', 'track') && <TrackMap track={currentTrack} entries={entries} />}
              {hasData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Пілотів" value={entries.length.toString()} />
                  <StatCard label="Лідер" value={entries.length > 0 ? shortName(entries[0].pilot) : '—'} />
                  <StatCard label="Найкращий час" value={entries.length > 0 ? (entries[0].bestLap || '—') : '—'} />
                </div>
              )}
            </>
          )}
        </>
      )}

      {error && (
        <div className="text-dark-500 text-xs text-center">{error}</div>
      )}

      {!hasReplayData && isSectionVisible('timing', 'history') && (
        <DayTimeline
          isTimingOnline={isLive}
          isTimingIdle={siteReachable && !isLive}
          idleSince={collectorStatus?.siteReachableSince ?? null}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center py-3">
      <div className="text-lg font-bold text-white font-mono mb-0.5">{value}</div>
      <div className="text-dark-500 text-[10px]">{label}</div>
    </div>
  );
}

function LiveTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const update = () => {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setElapsed(`${m}:${String(s).padStart(2, '0')}`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startTime]);
  return <span className="font-normal text-dark-400 ml-1.5 font-mono">{elapsed}</span>;
}

function IdleTimer({ sinceMs }: { sinceMs: number }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const update = () => {
      const sec = Math.floor((Date.now() - sinceMs) / 1000);
      if (sec < 60) setText(`${sec}с тому`);
      else if (sec < 3600) setText(`${Math.floor(sec / 60)}хв ${sec % 60}с тому`);
      else { const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); setText(`${h}год ${m}хв тому`); }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [sinceMs]);
  return <p className="text-dark-500 text-xs font-mono mt-1">Останній заїзд закінчився {text}</p>;
}
