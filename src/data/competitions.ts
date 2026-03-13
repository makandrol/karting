/**
 * Типи змагань — формальний опис форматів.
 * Детальний регламент: docs/regulations/competitions.md
 */

// ============================================================
// Загальні типи
// ============================================================

export type CompetitionFormat = 'gonzales' | 'light_league' | 'champions_league' | 'sprint' | 'marathon';
export type SessionType = 'prokat' | 'qualifying' | 'race' | 'gonzales_round';

export interface CompetitionConfig {
  format: CompetitionFormat;
  name: string;
  maxPilots: number;
  maxKarts: number;
  /** К-сть гонок (не рахуючи квалу) */
  raceCount: number;
  /** Опис формату */
  description: string;
}

export const COMPETITION_CONFIGS: Record<CompetitionFormat, CompetitionConfig> = {
  gonzales: {
    format: 'gonzales',
    name: 'Гонзалес',
    maxPilots: 24,
    maxKarts: 12,
    raceCount: 12, // 12 заїздів (по 1 на карт)
    description: '12 картів, кожен пілот їде на кожному по 2 кола. Середній час найкращих кіл.',
  },
  light_league: {
    format: 'light_league',
    name: 'Лайт Ліга',
    maxPilots: 36,
    maxKarts: 12,
    raceCount: 2,
    description: 'Квала + 2 гонки. Групи по 12, реверсивний старт.',
  },
  champions_league: {
    format: 'champions_league',
    name: 'Ліга Чемпіонів',
    maxPilots: 24,
    maxKarts: 12,
    raceCount: 3,
    description: 'Квала + 3 гонки. Групи по 12, реверсивний старт.',
  },
  sprint: {
    format: 'sprint',
    name: 'Спринт',
    maxPilots: 12,
    maxKarts: 12,
    raceCount: 1,
    description: 'Коротка гонка.',
  },
  marathon: {
    format: 'marathon',
    name: 'Марафон',
    maxPilots: 12,
    maxKarts: 12,
    raceCount: 1,
    description: 'Довга гонка з пітстопами.',
  },
};

// ============================================================
// Гонзалес — структура результатів
// ============================================================

export interface GonzalesResult {
  pilot: string;
  /** Найкращий час на кожному карті (індекс = номер карту - 1) */
  kartBestLaps: (number | null)[];  // секунди, null = не їздив
  /** Середній час найкращих кіл */
  averageTime: number | null;
}

// ============================================================
// Лайт Ліга / Ліга Чемпіонів — структура
// ============================================================

export interface LeagueGroup {
  name: string;        // "A", "B", "C"
  pilots: string[];    // відсортовані за квалою
}

export interface LeagueRaceResult {
  pilot: string;
  position: number;     // фінішна позиція
  bestLap: number;      // найкращий час кола (сек)
  startPosition: number;
  overtakes: number;    // к-сть обгонів
  points: number;       // бали за цю гонку
}

export interface LeagueStanding {
  pilot: string;
  qualifyingPoints: number;
  racePoints: number[];   // бали за кожну гонку
  totalPoints: number;
  bestLapOverall: number | null;
}

// ============================================================
// Бали за швидкість (топ-5)
// ============================================================

export const SPEED_POINTS = [2.5, 2.0, 1.5, 1.0, 0.5];

/**
 * Розбиває пілотів на групи за регламентом Лайт Ліги / Ліги Чемпіонів.
 */
export function splitIntoGroups(pilots: string[], maxGroups: number): LeagueGroup[] {
  const n = pilots.length;
  let groupCount: number;

  if (maxGroups >= 3) {
    if (n <= 13) groupCount = 1;
    else if (n <= 26) groupCount = 2;
    else groupCount = 3;
  } else {
    // Ліга чемпіонів — макс 2 групи
    if (n <= 13) groupCount = 1;
    else groupCount = 2;
  }

  const groups: LeagueGroup[] = [];
  const baseSize = Math.floor(n / groupCount);
  let remainder = n % groupCount;

  let idx = 0;
  for (let g = 0; g < groupCount; g++) {
    const size = baseSize + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    const groupPilots = pilots.slice(idx, idx + size);
    groups.push({
      name: String.fromCharCode(65 + g), // A, B, C
      pilots: groupPilots,
    });
    idx += size;
  }

  return groups;
}

/**
 * Реверсивний порядок старту для групи.
 * Останній за квалою стартує першим.
 */
export function reverseStartOrder(pilots: string[]): string[] {
  return [...pilots].reverse();
}
