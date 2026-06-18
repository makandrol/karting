import { describe, it, expect } from 'vitest';
import { parseMarathon, trimmedAverage, buildMarathonLapColumns, buildMarathonStartPositions } from './marathon';

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
});
