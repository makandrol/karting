import { describe, it, expect } from 'vitest';
import { parseMarathon, trimmedAverage, buildMarathonLapColumns, buildMarathonStartPositions, buildMarathonReplayLaps } from './marathon';

/** Build a `lap` event mirroring the collector's stored shape. */
function lapEvent(ts: number, team: Record<string, any>, lastLap: string, lapNumber: number) {
  return {
    event_type: 'lap',
    ts,
    data: {
      pilot: team.pilotName,
      kart: team.number,
      lapNumber,
      lastLap,
      team: { lapCount: lapNumber, ...team },
    },
  };
}

/** Build an `update` event (pit transitions etc). */
function updateEvent(ts: number, team: Record<string, any>) {
  return { event_type: 'update', ts, data: { pilot: team.pilotName, kart: team.number, team } };
}

describe('trimmedAverage', () => {
  it('returns plain average with no trim', () => {
    expect(trimmedAverage([40, 42, 44], 0, 0)).toBeCloseTo(42, 5);
  });

  it('trims worst and best', () => {
    // [38,40,42,44,100] → trim 1 best (38) + 1 worst (100) → avg(40,42,44)=42
    expect(trimmedAverage([100, 38, 42, 40, 44], 1, 1)).toBeCloseTo(42, 5);
  });

  it('returns null when everything trimmed away', () => {
    expect(trimmedAverage([40, 41], 1, 1)).toBeNull();
    expect(trimmedAverage([], 0, 0)).toBeNull();
  });
});

describe('parseMarathon — single team, one pit stop, kart change', () => {
  const base = { transponderId: 'T1', number: '18', teamName: 'Toretto Mafia', pitstops: '0', isOnPit: false, position: '1' };

  const events = [
    // Stint 1: Ковшар on kart 5
    lapEvent(1000, { ...base, pilotName: 'Ковшар', kart: '5' }, '42.000', 1),
    lapEvent(2000, { ...base, pilotName: 'Ковшар', kart: '5' }, '41.000', 2),
    lapEvent(3000, { ...base, pilotName: 'Ковшар', kart: '5' }, '43.000', 3),
    // Pit stop: isOnPit true → kart 0, then false with lastPitMainTime
    updateEvent(3500, { ...base, pilotName: 'Ковшар', kart: '0', isOnPit: true, pitstops: '1' }),
    updateEvent(3600, { ...base, pilotName: 'Овчарук', kart: '21', isOnPit: false, pitstops: '1', lastPitMainTime: '01:30.500' }),
    // Stint 2: Овчарук on kart 21
    lapEvent(4600, { ...base, pilotName: 'Овчарук', kart: '21', pitstops: '1' }, '40.000', 4),
    lapEvent(5600, { ...base, pilotName: 'Овчарук', kart: '21', pitstops: '1' }, '40.500', 5),
  ];

  it('groups into one team by start slot', () => {
    const m = parseMarathon(events);
    expect(m.teams).toHaveLength(1);
    expect(m.teams[0].startKart).toBe(18);
    expect(m.teams[0].teamName).toBe('Toretto Mafia');
  });

  it('lists both pilots in driving order', () => {
    const m = parseMarathon(events);
    expect(m.teams[0].pilots).toEqual(['Ковшар', 'Овчарук']);
  });

  it('splits into two stints by pilot+kart change', () => {
    const m = parseMarathon(events);
    const stints = m.teams[0].stints;
    expect(stints).toHaveLength(2);
    expect(stints[0]).toMatchObject({ pilotName: 'Ковшар', kart: 5, lapCount: 3 });
    expect(stints[1]).toMatchObject({ pilotName: 'Овчарук', kart: 21, lapCount: 2 });
  });

  it('captures pit stop with lap number and ~90s duration', () => {
    const m = parseMarathon(events);
    const pits = m.teams[0].pitStops;
    expect(pits).toHaveLength(1);
    expect(pits[0].index).toBe(1);
    expect(pits[0].lapNumber).toBe(3); // last completed lap before pit
    expect(pits[0].durationSec).toBeCloseTo(90.5, 2);
  });

  it('ignores on-pit (kart 0) laps and computes best lap', () => {
    const m = parseMarathon(events);
    expect(m.teams[0].totalLaps).toBe(5);
    expect(m.teams[0].bestLapSec).toBeCloseTo(40.0, 5);
  });

  it('builds a pit interval window for the scrubber', () => {
    const m = parseMarathon(events);
    expect(m.pitIntervals).toHaveLength(1);
    expect(m.pitIntervals[0]).toMatchObject({ startKart: 18, startTs: 3500, endTs: 3600 });
  });

  it('enriches pit interval with kartIn/kartOut/segment + pit index', () => {
    const m = parseMarathon(events);
    const pit = m.pitIntervals[0];
    expect(pit.pitIndex).toBe(1);
    expect(pit.kartIn).toBe(5);   // came in on kart 5
    expect(pit.kartOut).toBe(21); // left on kart 21
    expect(pit.segBestLapSec).toBeCloseTo(41.0, 3); // best of the pre-pit stint
    expect(pit.segDurationSec).toBeCloseTo(42 + 41 + 43, 3);
  });
});

describe('parseMarathon — kart=0 laps are kept (not dropped)', () => {
  // Regression: timing reports kart "0" for some laps (near start/pit). Dropping
  // them undercounts laps so a team appears a lap behind. They must be kept and
  // inherit the last known kart.
  const base = { transponderId: 'T', number: '4', teamName: 'A', pitstops: '0', isOnPit: false, position: '1' };
  const events = [
    lapEvent(1000, { ...base, pilotName: 'Карт 4', kart: '0' }, '43.000', 1), // first lap, no kart read
    lapEvent(2000, { ...base, pilotName: 'P', kart: '8' }, '42.000', 2),
    lapEvent(3000, { ...base, pilotName: 'P', kart: '0' }, '42.500', 3), // transient kart=0 mid-stint
    lapEvent(4000, { ...base, pilotName: 'P', kart: '8' }, '42.100', 4),
  ];

  it('counts all 4 laps', () => {
    const m = parseMarathon(events);
    expect(m.teams[0].totalLaps).toBe(4);
  });

  it('kart=0 laps inherit the nearest real kart (no spurious stint split)', () => {
    const m = parseMarathon(events);
    // lap1 kart=0 (no prior real kart) → inherits the next real kart (8);
    // mid-stint kart=0 (lap 3) inherits previous kart 8 → single kart-8 stint
    const karts = m.teams[0].stints.map(s => s.kart);
    expect(karts).toEqual([8]);
    const kart8 = m.teams[0].stints.find(s => s.kart === 8)!;
    expect(kart8.lapCount).toBe(4);
  });

  it('placeholder "Карт N" driver names resolve to the real pilot', () => {
    const m = parseMarathon(events);
    // all laps belong to the real driver P, not "Карт 4"
    expect(m.teams[0].pilots).toEqual(['P']);
    expect(m.kartStats.every(k => k.usages.every(u => !u.pilotName.startsWith('Карт')))).toBe(true);
  });
});

describe('parseMarathon — kart stats', () => {
  const t1 = { transponderId: 'A', number: '1', teamName: 'A', pitstops: '0', isOnPit: false, position: '1' };
  const t2 = { transponderId: 'B', number: '2', teamName: 'B', pitstops: '0', isOnPit: false, position: '2' };

  const events = [
    lapEvent(1000, { ...t1, pilotName: 'P1', kart: '5' }, '42.000', 1),
    lapEvent(2000, { ...t1, pilotName: 'P1', kart: '5' }, '41.000', 2),
    lapEvent(1500, { ...t2, pilotName: 'P2', kart: '5' }, '43.000', 1),
  ];

  it('aggregates the same actual kart across different teams', () => {
    const m = parseMarathon(events);
    const kart5 = m.kartStats.find(k => k.kart === 5);
    expect(kart5).toBeDefined();
    expect(kart5!.totalLaps).toBe(3);
    expect(kart5!.usages).toHaveLength(2);
    expect(kart5!.bestLapSec).toBeCloseTo(41.0, 5);
  });

  it('sums driven seconds per kart', () => {
    const m = parseMarathon(events);
    const kart5 = m.kartStats.find(k => k.kart === 5)!;
    expect(kart5.drivenSec).toBeCloseTo(42 + 41 + 43, 3);
  });

  it('kart usage carries lap range and timestamps', () => {
    const m = parseMarathon(events);
    const kart5 = m.kartStats.find(k => k.kart === 5)!;
    const p1 = kart5.usages.find(u => u.pilotName === 'P1')!;
    expect(p1).toMatchObject({ startLap: 1, endLap: 2 });
    expect(p1.startTs).toBe(1000);
    expect(p1.endTs).toBe(2000);
  });
});

describe('parseMarathon — finish order + gap', () => {
  const mk = (num: string, pos: string, name: string) => ({ transponderId: 't' + num, number: num, teamName: name, pitstops: '0', isOnPit: false, position: pos });
  // Team A (pos 1): 3 laps; Team B (pos 2): 3 laps slightly behind; Team C (pos 3): 2 laps (a lap down)
  const a = mk('1', '1', 'A');
  const b = mk('2', '2', 'B');
  const c = mk('3', '3', 'C');
  const events = [
    lapEvent(1000, { ...a, pilotName: 'A', kart: '5' }, '42.000', 1),
    lapEvent(1100, { ...b, pilotName: 'B', kart: '6' }, '42.500', 1),
    lapEvent(1050, { ...c, pilotName: 'C', kart: '7' }, '43.000', 1),
    lapEvent(2000, { ...a, pilotName: 'A', kart: '5' }, '42.000', 2),
    lapEvent(2200, { ...b, pilotName: 'B', kart: '6' }, '42.500', 2),
    lapEvent(2100, { ...c, pilotName: 'C', kart: '7' }, '43.000', 2),
    lapEvent(3000, { ...a, pilotName: 'A', kart: '5' }, '42.000', 3),
    lapEvent(3300, { ...b, pilotName: 'B', kart: '6' }, '42.500', 3),
  ];

  it('teams sorted by finish position', () => {
    const m = parseMarathon(events);
    expect(m.teams.map(t => t.teamName)).toEqual(['A', 'B', 'C']);
  });

  it('leader has empty gap, time gap for same-lap, lap-down for fewer laps', () => {
    const m = parseMarathon(events);
    expect(m.teams[0].gapLabel).toBe(''); // A leader
    expect(m.teams[1].gapLabel).toBe('+0.3с'); // B: (3300-3000)/1000
    expect(m.teams[2].gapLabel).toBe('+1 коло'); // C: one lap down vs B
  });
});

describe('parseMarathon — trimmed average per stint', () => {
  const base = { transponderId: 'T', number: '3', teamName: 'X', pitstops: '0', isOnPit: false, position: '1' };
  const events = [
    lapEvent(1000, { ...base, pilotName: 'P', kart: '7' }, '38.000', 1),
    lapEvent(2000, { ...base, pilotName: 'P', kart: '7' }, '40.000', 2),
    lapEvent(3000, { ...base, pilotName: 'P', kart: '7' }, '42.000', 3),
    lapEvent(4000, { ...base, pilotName: 'P', kart: '7' }, '44.000', 4),
    lapEvent(5000, { ...base, pilotName: 'P', kart: '7' }, '100.000', 5),
  ];

  it('plain average without trim', () => {
    const m = parseMarathon(events, { trimBest: 0, trimWorst: 0 });
    expect(m.teams[0].stints[0].avgLapSec).toBeCloseTo((38 + 40 + 42 + 44 + 100) / 5, 3);
  });

  it('trims 1 best + 1 worst', () => {
    const m = parseMarathon(events, { trimBest: 1, trimWorst: 1 });
    // drop 38 and 100 → avg(40,42,44) = 42
    expect(m.teams[0].stints[0].avgLapSec).toBeCloseTo(42, 3);
  });
});

describe('buildMarathonLapColumns', () => {
  const base = { transponderId: 'T1', number: '18', teamName: 'Toretto Mafia', pitstops: '0', isOnPit: false, position: '1' };
  const events = [
    lapEvent(1000, { ...base, pilotName: 'Ковшар', kart: '5' }, '42.000', 1),
    lapEvent(2000, { ...base, pilotName: 'Ковшар', kart: '5' }, '41.000', 2),
    updateEvent(2500, { ...base, pilotName: 'Ковшар', kart: '0', isOnPit: true, pitstops: '1' }),
    updateEvent(2600, { ...base, pilotName: 'Овчарук', kart: '21', isOnPit: false, pitstops: '1', lastPitMainTime: '01:30.000' }),
    lapEvent(3600, { ...base, pilotName: 'Овчарук', kart: '21', pitstops: '1' }, '40.000', 3),
  ];

  it('one column per team with team name header', () => {
    const cols = buildMarathonLapColumns(parseMarathon(events));
    expect(cols).toHaveLength(1);
    expect(cols[0].headerLabel).toBe('Toretto Mafia');
    expect(cols[0].startKart).toBe(18);
  });

  it('laps carry actual kart and driver in chronological order', () => {
    const cols = buildMarathonLapColumns(parseMarathon(events));
    const laps = cols[0].laps;
    expect(laps).toHaveLength(3);
    expect(laps[0]).toMatchObject({ kart: 5, driver: 'Ковшар' });
    expect(laps[2]).toMatchObject({ kart: 21, driver: 'Овчарук' });
  });

  it('laps carry race position', () => {
    const cols = buildMarathonLapColumns(parseMarathon(events));
    expect(cols[0].laps[0].position).toBe(1);
  });

  it('start positions keyed by team column', () => {
    const sp = buildMarathonStartPositions(parseMarathon(events));
    expect(sp.get('team-18')).toBe(1);
  });

  it('replay laps: one entry-stream per team labelled by team name, real kart per lap', () => {
    const rows = buildMarathonReplayLaps(parseMarathon(events));
    expect(new Set(rows.map(r => r.pilot))).toEqual(new Set(['Toretto Mafia']));
    expect(rows[0]).toMatchObject({ pilot: 'Toretto Mafia', kart: 5, position: 1, lapNumber: 1 });
    expect(rows[rows.length - 1]).toMatchObject({ kart: 21 });
  });
});
