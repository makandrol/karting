import type { TimingEntry, TimingSnapshot, LiveRaceState, RaceResult, KartInfo, KartTopResult } from '../types';
import { MIN_VALID_LAP_SECONDS } from '../types';

// ============================================================
// Mock timing entries — імітація табло timing.karting.ua
// ============================================================

const PILOTS = [
  'Апанасенко Олексій',
  'Джасім Салєх',
  'Жигаленко Антон',
  'Яковлєв Ярослав',
  'Шевченко Д.',
  'Бондаренко К.',
  'Коваленко М.',
  'Петренко О.',
  'Ткаченко В.',
  'Мельник І.',
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

/**
 * Парсить час кола зі строки "00:42.123" в секунди (42.123).
 */
export function parseLapTimeToSeconds(lapTime: string | null): number | null {
  if (!lapTime) return null;
  const match = lapTime.match(/^(\d+):(\d+\.\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseFloat(match[2]);
}

/**
 * Перевіряє чи коло валідне (>= MIN_VALID_LAP_SECONDS).
 * Якщо час < 38.5s — хтось скоротив трасу.
 */
export function isValidLap(lapTime: string | null): boolean {
  const seconds = parseLapTimeToSeconds(lapTime);
  if (seconds === null) return false;
  return seconds >= MIN_VALID_LAP_SECONDS;
}

export function generateMockTimingEntries(count: number = 10): TimingEntry[] {
  const entries: TimingEntry[] = [];
  const usedPilots = PILOTS.slice(0, Math.min(count, PILOTS.length));

  // Апанасенко лідер ~50% часу
  const apanasenkIsLeader = Math.random() < 0.5;

  for (let i = 0; i < usedPilots.length; i++) {
    const lapNumber = Math.floor(Math.random() * 15) + 1;

    let baseLap: number;
    let baseS1: number;
    let baseS2: number;

    if (i === 0 && apanasenkIsLeader) {
      // Апанасенко лідер
      baseLap = 40.5;
      baseS1 = 13.2;
      baseS2 = 27.3;
    } else if (i === 0 && !apanasenkIsLeader) {
      // Апанасенко не лідер — трохи повільніший
      baseLap = 41.5 + Math.random() * 1.5;
      baseS1 = 13.8 + Math.random() * 0.3;
      baseS2 = 27.7 + Math.random() * 0.5;
    } else {
      baseLap = 41.0 + i * 0.4 + Math.random() * 0.5;
      baseS1 = 13.5 + i * 0.15;
      baseS2 = 27.5 + i * 0.25;
    }

    entries.push({
      position: 0, // will be set after sorting
      pilot: usedPilots[i],
      kart: KARTS[i % KARTS.length],
      lastLap: lapNumber > 0 ? randomLapTime(baseLap, 1.5) : null,
      s1: lapNumber > 0 ? randomSector(baseS1, 0.4) : null,
      s2: lapNumber > 0 ? randomSector(baseS2, 0.6) : null,
      bestLap: randomLapTime(baseLap - 0.3, 0.8),
      lapNumber,
      bestS1: randomSector(baseS1 - 0.15, 0.2),
      bestS2: randomSector(baseS2 - 0.2, 0.3),
    });
  }

  // Сортуємо за bestLap і виставляємо позиції
  entries.sort((a, b) => {
    const aTime = parseLapTimeToSeconds(a.bestLap);
    const bTime = parseLapTimeToSeconds(b.bestLap);
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    return aTime - bTime;
  });

  entries.forEach((e, idx) => { e.position = idx + 1; });

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
  const usedPilots = PILOTS.slice(0, Math.min(count, PILOTS.length));

  // Апанасенко ~50% першості
  const shuffled = [...usedPilots];
  if (Math.random() >= 0.5 && shuffled[0] === 'Апанасенко Олексій') {
    // залишити на 1 місці
  } else {
    // перемішати випадково (Апанасенко десь 2-4 місце)
    const apIdx = shuffled.indexOf('Апанасенко Олексій');
    if (apIdx >= 0) {
      const newPos = 1 + Math.floor(Math.random() * 3); // 1-3
      shuffled.splice(apIdx, 1);
      shuffled.splice(newPos, 0, 'Апанасенко Олексій');
    }
  }

  return shuffled.map((pilot, i) => ({
    position: i + 1,
    pilot,
    kart: KARTS[PILOTS.indexOf(pilot) % KARTS.length],
    bestLap: randomLapTime(40.5 + i * 0.3, 0.8),
    totalTime: randomLapTime(600 + i * 5, 10),
    laps: 15 - Math.floor(i / 4),
    points: Math.max(25 - i * 2, 1),
    gap: i === 0 ? '—' : `+${(i * 1.234 + Math.random() * 2).toFixed(3)}`,
  }));
}

// ============================================================
// Mock kart info — всі карти зі списком + top-5 результатів
// ============================================================

function generateKartTop5(kartNumber: number): KartTopResult[] {
  // Генеруємо top-5 результатів для кожного карту від різних пілотів
  const shuffled = [...PILOTS].sort(() => Math.random() - 0.5);
  const top5Pilots = shuffled.slice(0, 5);

  const baseLap = 40.0 + (kartNumber % 5) * 0.4; // різна швидкість карту

  return top5Pilots.map((pilot, i) => {
    const lapSec = baseLap + i * 0.3 + Math.random() * 0.5;
    return {
      pilot,
      bestLap: randomLapTime(lapSec, 0.3),
      bestLapSeconds: lapSec,
      date: `2025-0${Math.min(i + 1, 3)}-${String(10 + i * 5).padStart(2, '0')}`,
    };
  }).sort((a, b) => a.bestLapSeconds - b.bestLapSeconds);
}

export const ALL_KART_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export const MOCK_KARTS: KartInfo[] = ALL_KART_NUMBERS.map((num) => ({
  number: num,
  status: 'unknown' as const,
  avgLapTime: undefined,
  top5: generateKartTop5(num),
}));

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
