import type { CompetitionFormat } from '../data/competitions';

/**
 * Конкретне проведення змагання (подія).
 */
export interface CompetitionEvent {
  id: string;
  format: CompetitionFormat;
  name: string;           // "Лайт Ліга Етап 3"
  date: string;           // "2025-03-13"
  trackConfigId: number;  // номер конфігурації траси
  /** Фази змагання в порядку проведення */
  phases: CompetitionPhase[];
}

export interface CompetitionPhase {
  id: string;
  type: 'qualifying' | 'race' | 'gonzales_round';
  name: string;           // "Квала 1", "Гонка 1, Група C", "Раунд Карт 5"
  /** Результати по пілотах */
  results: PhaseResult[];
}

export interface PhaseResult {
  pilot: string;
  kart: number;
  position: number;       // фінішна позиція
  bestLap: string;
  bestLapSec: number;
  laps: PhaseLap[];
  startPosition?: number;
  overtakes?: number;
  points?: number;
}

export interface PhaseLap {
  lapNumber: number;
  lapTime: string;
  lapTimeSec: number;
  s1: string;
  s2: string;
}

// ============================================================
// Mock competition events
// ============================================================

const PILOTS = [
  'Апанасенко Олексій', 'Джасім Салєх', 'Жигаленко Антон', 'Яковлєв Ярослав',
  'Шевченко Д.', 'Бондаренко К.', 'Коваленко М.', 'Петренко О.',
  'Ткаченко В.', 'Мельник І.', 'Литвиненко С.', 'Кравченко Р.',
];

function fmtLap(sec: number): string {
  if (sec >= 60) { const m = Math.floor(sec / 60); return m + ':' + (sec - m * 60).toFixed(3).padStart(6, '0'); }
  return sec.toFixed(3);
}

function genLaps(count: number, base: number): PhaseLap[] {
  return Array.from({ length: count }, (_, i) => {
    const sec = base + (Math.random() - 0.3) * 2;
    const s1 = sec * (0.32 + Math.random() * 0.02);
    return { lapNumber: i + 1, lapTime: fmtLap(sec), lapTimeSec: sec, s1: s1.toFixed(3), s2: (sec - s1).toFixed(3) };
  });
}

function genPhaseResults(pilots: string[], base: number): PhaseResult[] {
  return pilots.map((pilot, i) => {
    const laps = genLaps(8 + Math.floor(Math.random() * 5), base + i * 0.3);
    const best = laps.reduce((min, l) => l.lapTimeSec < min.lapTimeSec ? l : min, laps[0]);
    return {
      pilot, kart: [7, 3, 12, 5, 1, 10, 14, 8, 15, 17, 2, 6][i % 12],
      position: i + 1, bestLap: best.lapTime, bestLapSec: best.lapTimeSec,
      laps, startPosition: pilots.length - i, overtakes: Math.floor(Math.random() * 5),
      points: Math.max(0, 10 - i),
    };
  }).sort((a, b) => a.bestLapSec - b.bestLapSec).map((r, i) => ({ ...r, position: i + 1 }));
}

function generateLightLeagueEvent(id: string, name: string, date: string, track: number): CompetitionEvent {
  const phases: CompetitionPhase[] = [];
  const pilotsSubset = PILOTS.slice(0, 12);

  // Кваліфікації
  for (let q = 1; q <= 2; q++) {
    phases.push({
      id: `${id}-q${q}`, type: 'qualifying', name: `Квала ${q}`,
      results: genPhaseResults(pilotsSubset, 41),
    });
  }
  // Гонки
  const groups = pilotsSubset.length > 13 ? ['C', 'B', 'A'] : ['A'];
  for (let r = 1; r <= 2; r++) {
    for (const g of groups) {
      phases.push({
        id: `${id}-r${r}g${g}`, type: 'race', name: `Гонка ${r}, Група ${g}`,
        results: genPhaseResults(pilotsSubset.slice(0, 6), 41),
      });
    }
  }
  return { id, format: 'light_league', name, date, trackConfigId: track, phases };
}

function generateChampionsLeagueEvent(id: string, name: string, date: string, track: number): CompetitionEvent {
  const phases: CompetitionPhase[] = [];
  const pilotsSubset = PILOTS.slice(0, 10);

  for (let q = 1; q <= 2; q++) {
    phases.push({ id: `${id}-q${q}`, type: 'qualifying', name: `Квала ${q}`, results: genPhaseResults(pilotsSubset, 40.5) });
  }
  for (let r = 1; r <= 3; r++) {
    phases.push({ id: `${id}-r${r}`, type: 'race', name: `Гонка ${r}`, results: genPhaseResults(pilotsSubset, 40.5) });
  }
  return { id, format: 'champions_league', name, date, trackConfigId: track, phases };
}

function generateGonzalesEvent(id: string, name: string, date: string, track: number): CompetitionEvent {
  const pilotsSubset = PILOTS.slice(0, 10);
  const phases: CompetitionPhase[] = [];
  for (let k = 1; k <= 12; k++) {
    phases.push({
      id: `${id}-k${k}`, type: 'gonzales_round', name: `Раунд Карт ${k}`,
      results: genPhaseResults(pilotsSubset, 41).map(r => ({ ...r, kart: k, laps: r.laps.slice(0, 2) })),
    });
  }
  return { id, format: 'gonzales', name, date, trackConfigId: track, phases };
}

export const ALL_COMPETITION_EVENTS: CompetitionEvent[] = [
  generateGonzalesEvent('gonz-1', 'Гонзалес Раунд 1', '2025-01-15', 1),
  generateGonzalesEvent('gonz-2', 'Гонзалес Раунд 2', '2025-02-12', 3),
  generateGonzalesEvent('gonz-3', 'Гонзалес Раунд 3', '2025-03-10', 1),
  generateLightLeagueEvent('ll-1', 'Лайт Ліга Етап 1', '2025-01-20', 1),
  generateLightLeagueEvent('ll-2', 'Лайт Ліга Етап 2', '2025-02-17', 5),
  generateLightLeagueEvent('ll-3', 'Лайт Ліга Етап 3', '2025-03-10', 1),
  generateChampionsLeagueEvent('cl-1', 'Ліга Чемпіонів Етап 1', '2025-02-01', 3),
  generateChampionsLeagueEvent('cl-2', 'Ліга Чемпіонів Етап 2', '2025-03-08', 1),
];

export function getEventsByFormat(format: CompetitionFormat): CompetitionEvent[] {
  return ALL_COMPETITION_EVENTS.filter(e => e.format === format);
}

export function getEventById(id: string): CompetitionEvent | undefined {
  return ALL_COMPETITION_EVENTS.find(e => e.id === id);
}
