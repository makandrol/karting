import type { TimingEntry, TimingSnapshot, LiveRaceState, RaceResult, KartInfo } from '../types';

// ============================================================
// Mock timing entries — імітація табло timing.karting.ua
// ============================================================

const PILOTS = [
  'Макаревич А.', 'Шевченко Д.', 'Бондаренко К.', 'Коваленко М.',
  'Петренко О.', 'Ткаченко В.', 'Мельник І.', 'Литвиненко С.',
  'Кравченко Р.', 'Сидоренко П.',
];

const KARTS = [1, 3, 5, 7, 8, 10, 12, 14, 15, 17];

function randomLapTime(baseSec: number, variance: number): string {
  const total = baseSec + (Math.random() - 0.5) * variance;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}

function randomSector(baseSec: number, variance: number): string {
  const total = baseSec + (Math.random() - 0.5) * variance;
  return total.toFixed(3);
}

export function generateMockTimingEntries(count: number = 10): TimingEntry[] {
  const entries: TimingEntry[] = [];

  for (let i = 0; i < Math.min(count, PILOTS.length); i++) {
    const lapNumber = Math.floor(Math.random() * 15) + 1;
    const baseLap = 42 + i * 0.3;
    const baseS1 = 14 + i * 0.1;
    const baseS2 = 28 + i * 0.2;

    entries.push({
      position: i + 1,
      pilot: PILOTS[i],
      kart: KARTS[i],
      lastLap: lapNumber > 0 ? randomLapTime(baseLap, 2) : null,
      s1: lapNumber > 0 ? randomSector(baseS1, 0.5) : null,
      s2: lapNumber > 0 ? randomSector(baseS2, 0.8) : null,
      bestLap: randomLapTime(baseLap - 0.5, 1),
      lapNumber,
      bestS1: randomSector(baseS1 - 0.2, 0.3),
      bestS2: randomSector(baseS2 - 0.3, 0.4),
    });
  }

  return entries;
}

export function generateMockSnapshot(): TimingSnapshot {
  return {
    timestamp: Date.now(),
    sessionId: 'mock-session-001',
    entries: generateMockTimingEntries(10),
  };
}

export function generateMockLiveRace(): LiveRaceState {
  const minutes = Math.floor(Math.random() * 10);
  const seconds = Math.floor(Math.random() * 60);

  return {
    isActive: true,
    sessionName: 'Вечірня практика — Сесія 3',
    timeRemaining: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    entries: generateMockTimingEntries(10),
    lastUpdate: Date.now(),
  };
}

// ============================================================
// Mock race results — для сторінок змагань
// ============================================================

export function generateMockRaceResults(count: number = 10): RaceResult[] {
  return PILOTS.slice(0, count).map((pilot, i) => ({
    position: i + 1,
    pilot,
    kart: KARTS[i],
    bestLap: randomLapTime(41 + i * 0.2, 1),
    totalTime: randomLapTime(600 + i * 5, 10),
    laps: 15 - Math.floor(i / 4),
    points: Math.max(25 - i * 2, 1),
    gap: i === 0 ? '—' : `+${(i * 1.234 + Math.random() * 2).toFixed(3)}`,
  }));
}

// ============================================================
// Mock kart info
// ============================================================

export const MOCK_KARTS: KartInfo[] = [
  { number: 1, status: 'good', avgLapTime: '00:41.500', notes: 'Швидкий, стабільний' },
  { number: 3, status: 'good', avgLapTime: '00:41.800', notes: 'Хороший розгін' },
  { number: 5, status: 'average', avgLapTime: '00:42.100', notes: 'Середній' },
  { number: 7, status: 'good', avgLapTime: '00:41.600', notes: 'Один з найкращих' },
  { number: 8, status: 'poor', avgLapTime: '00:43.200', notes: 'Повільний, слабкі гальма' },
  { number: 10, status: 'average', avgLapTime: '00:42.400', notes: 'Нормальний' },
  { number: 12, status: 'good', avgLapTime: '00:41.900', notes: 'Добрий' },
  { number: 14, status: 'average', avgLapTime: '00:42.600', notes: 'Середній' },
  { number: 15, status: 'poor', avgLapTime: '00:43.500', notes: 'Повільний' },
  { number: 17, status: 'unknown', avgLapTime: '—', notes: 'Новий, немає даних' },
];

// ============================================================
// Mock competitions data
// ============================================================

export const MOCK_GONZALES_RESULTS = {
  name: 'Гонзалес 2025',
  rounds: [
    { date: '2025-01-15', name: 'Раунд 1', results: generateMockRaceResults(8) },
    { date: '2025-02-12', name: 'Раунд 2', results: generateMockRaceResults(10) },
    { date: '2025-03-10', name: 'Раунд 3', results: generateMockRaceResults(9) },
  ],
};

export const MOCK_LIGHT_LEAGUE_RESULTS = {
  name: 'Лайт Ліга 2025',
  rounds: [
    { date: '2025-01-20', name: 'Етап 1', results: generateMockRaceResults(10) },
    { date: '2025-02-17', name: 'Етап 2', results: generateMockRaceResults(10) },
  ],
};

export const MOCK_CHAMPIONS_RESULTS = {
  name: 'Ліга Чемпіонів 2025',
  rounds: [
    { date: '2025-02-01', name: 'Етап 1', results: generateMockRaceResults(8) },
  ],
};

export const MOCK_SPRINT_RESULTS = {
  name: 'Спринти 2025',
  rounds: [
    { date: '2025-01-10', name: 'Спринт #1', results: generateMockRaceResults(6) },
    { date: '2025-01-24', name: 'Спринт #2', results: generateMockRaceResults(7) },
    { date: '2025-02-07', name: 'Спринт #3', results: generateMockRaceResults(8) },
    { date: '2025-02-21', name: 'Спринт #4', results: generateMockRaceResults(6) },
  ],
};

export const MOCK_MARATHON_RESULTS = {
  name: 'Марафони 2025',
  rounds: [
    { date: '2025-03-01', name: 'Марафон Весняний', results: generateMockRaceResults(10) },
  ],
};
