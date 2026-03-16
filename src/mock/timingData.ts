import type { RaceResult, KartInfo, KartTopResult, KartLapRecord } from '../types';

// ============================================================
// Пілоти та карти для моків результатів змагань
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

const KARTS = [7, 3, 12, 5, 1, 10, 14, 8, 15, 17];

function randomLapTime(baseSec: number, variance: number): string {
  const total = baseSec + (Math.random() - 0.5) * variance;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
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
  const shuffled = [...PILOTS].sort(() => Math.random() - 0.5);
  const top5Pilots = shuffled.slice(0, 5);
  const baseLap = 40.0 + (kartNumber % 5) * 0.4;

  return top5Pilots.map((pilot, i) => {
    const lapSec = baseLap + i * 0.3 + Math.random() * 0.5;
    const hour = 16 + Math.floor(Math.random() * 5);
    const min = Math.floor(Math.random() * 60);
    const sec = Math.floor(Math.random() * 60);
    return {
      pilot,
      bestLap: randomLapTime(lapSec, 0.3),
      bestLapSeconds: lapSec,
      datetime: `2025-0${Math.min(i + 1, 3)}-${String(10 + i * 5).padStart(2, '0')}T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`,
    };
  }).sort((a, b) => a.bestLapSeconds - b.bestLapSeconds);
}

/** Генерує моки всіх кіл для карту */
export function generateKartLaps(kartNumber: number, count: number = 30): KartLapRecord[] {
  const baseLap = 40.5 + (kartNumber % 5) * 0.4;
  const laps: KartLapRecord[] = [];

  for (let i = 0; i < count; i++) {
    const pilot = PILOTS[i % PILOTS.length];
    const lapSec = baseLap + (Math.random() - 0.3) * 3;
    const s1Sec = lapSec * (0.32 + Math.random() * 0.02);
    const s2Sec = lapSec - s1Sec;
    const day = 1 + Math.floor(i / 10);
    const hour = 16 + (i % 5);
    const min = (i * 7) % 60;

    laps.push({
      pilot,
      lapTime: randomLapTime(lapSec, 0),
      lapTimeSeconds: lapSec,
      s1: s1Sec.toFixed(3),
      s2: s2Sec.toFixed(3),
      datetime: `2025-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`,
      lapNumber: (i % 15) + 1,
      sessionName: `Сесія ${Math.floor(i / 15) + 1}`,
    });
  }

  return laps.sort((a, b) => a.lapTimeSeconds - b.lapTimeSeconds);
}

export const ALL_KART_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 33, 44, 55, 69, 77, 88];

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
