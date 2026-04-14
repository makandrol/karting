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
  shortName: string;
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
    shortName: 'Гонз',
    maxPilots: 24,
    maxKarts: 12,
    raceCount: 24, // max(кількість пілотів, 12) раундів
    description: 'Тайм-атака: 12 картів, кожен пілот їде на кожному по 2 кола. Середній час найкращих кіл.',
  },
  light_league: {
    format: 'light_league',
    name: 'Лайт Ліга',
    shortName: 'ЛЛ',
    maxPilots: 36,
    maxKarts: 12,
    raceCount: 2,
    description: 'Квала + 2 гонки. Групи по 12, реверсивний старт.',
  },
  champions_league: {
    format: 'champions_league',
    name: 'Ліга Чемпіонів',
    shortName: 'ЛЧ',
    maxPilots: 24,
    maxKarts: 12,
    raceCount: 3,
    description: 'Квала + 3 гонки. Групи по 12, реверсивний старт.',
  },
  sprint: {
    format: 'sprint',
    name: 'Спринт',
    shortName: 'Спр',
    maxPilots: 45,
    maxKarts: 15,
    raceCount: 3, // Race 1, Race 2, Final
    description: 'Квала 1 + Гонка 1, Квала 2 + Гонка 2, Фінал. Без обгонів.',
  },
  marathon: {
    format: 'marathon',
    name: 'Марафон',
    shortName: 'Мар',
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

// ============================================================
// Phase configs — етапи для кожного типу змагань
// ============================================================

export interface PhaseConfig {
  id: string;
  label: string;
  shortLabel: string;
}

export const PHASE_CONFIGS: Record<string, { phases: PhaseConfig[] }> = {
  gonzales: {
    phases: [
      { id: 'qualifying_1', label: 'Кваліфікація 1', shortLabel: 'Кв1' },
      { id: 'qualifying_2', label: 'Кваліфікація 2', shortLabel: 'Кв2' },
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `round_${i + 1}_group_2`,
        label: `round_${i + 1}_group_2`,
        shortLabel: `round_${i + 1}_group_2`,
      })),
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `round_${i + 1}_group_1`,
        label: `round_${i + 1}_group_1`,
        shortLabel: `round_${i + 1}_group_1`,
      })),
    ],
  },
  light_league: {
    phases: [
      { id: 'qualifying_1', label: 'Кваліфікація 1', shortLabel: 'Кв1' },
      { id: 'qualifying_2', label: 'Кваліфікація 2', shortLabel: 'Кв2' },
      { id: 'qualifying_3', label: 'Кваліфікація 3', shortLabel: 'Кв3' },
      { id: 'qualifying_4', label: 'Кваліфікація 4', shortLabel: 'Кв4' },
      { id: 'race_1_group_3', label: 'Гонка 1 · Група 3', shortLabel: 'Г1-3' },
      { id: 'race_1_group_2', label: 'Гонка 1 · Група 2', shortLabel: 'Г1-2' },
      { id: 'race_1_group_1', label: 'Гонка 1 · Група 1', shortLabel: 'Г1-1' },
      { id: 'race_2_group_3', label: 'Гонка 2 · Група 3', shortLabel: 'Г2-3' },
      { id: 'race_2_group_2', label: 'Гонка 2 · Група 2', shortLabel: 'Г2-2' },
      { id: 'race_2_group_1', label: 'Гонка 2 · Група 1', shortLabel: 'Г2-1' },
    ],
  },
  champions_league: {
    phases: [
      { id: 'qualifying_1', label: 'Кваліфікація 1', shortLabel: 'Кв1' },
      { id: 'qualifying_2', label: 'Кваліфікація 2', shortLabel: 'Кв2' },
      { id: 'race_1_group_2', label: 'Гонка 1 · Група 2', shortLabel: 'Г1-2' },
      { id: 'race_1_group_1', label: 'Гонка 1 · Група 1', shortLabel: 'Г1-1' },
      { id: 'race_2_group_2', label: 'Гонка 2 · Група 2', shortLabel: 'Г2-2' },
      { id: 'race_2_group_1', label: 'Гонка 2 · Група 1', shortLabel: 'Г2-1' },
      { id: 'race_3_group_2', label: 'Гонка 3 · Група 2', shortLabel: 'Г3-2' },
      { id: 'race_3_group_1', label: 'Гонка 3 · Група 1', shortLabel: 'Г3-1' },
    ],
  },
  sprint: {
    phases: [
      { id: 'qualifying_1_group_1', label: 'Кваліфікація 1 · Група 1', shortLabel: 'Кв1-1' },
      { id: 'qualifying_1_group_2', label: 'Кваліфікація 1 · Група 2', shortLabel: 'Кв1-2' },
      { id: 'qualifying_1_group_3', label: 'Кваліфікація 1 · Група 3', shortLabel: 'Кв1-3' },
      { id: 'race_1_group_3', label: 'Гонка 1 · Група 3', shortLabel: 'Г1-3' },
      { id: 'race_1_group_2', label: 'Гонка 1 · Група 2', shortLabel: 'Г1-2' },
      { id: 'race_1_group_1', label: 'Гонка 1 · Група 1', shortLabel: 'Г1-1' },
      { id: 'qualifying_2_group_1', label: 'Кваліфікація 2 · Група 1', shortLabel: 'Кв2-1' },
      { id: 'qualifying_2_group_2', label: 'Кваліфікація 2 · Група 2', shortLabel: 'Кв2-2' },
      { id: 'qualifying_2_group_3', label: 'Кваліфікація 2 · Група 3', shortLabel: 'Кв2-3' },
      { id: 'race_2_group_3', label: 'Гонка 2 · Група 3', shortLabel: 'Г2-3' },
      { id: 'race_2_group_2', label: 'Гонка 2 · Група 2', shortLabel: 'Г2-2' },
      { id: 'race_2_group_1', label: 'Гонка 2 · Група 1', shortLabel: 'Г2-1' },
      { id: 'final_group_3', label: 'Фінал Лайт', shortLabel: 'Ф-Лайт' },
      { id: 'final_group_2', label: 'Фінал Голд', shortLabel: 'Ф-Голд' },
      { id: 'final_group_1', label: 'Фінал Про', shortLabel: 'Ф-Про' },
    ],
  },
  marathon: { phases: [{ id: 'race', label: 'Гонка', shortLabel: 'Гонка' }] },
};

export function getPhasesForFormat(format: string, groupCount?: number | null, roundCount?: number | null): PhaseConfig[] {
  const config = PHASE_CONFIGS[format];
  if (!config) return [];

  const renumberGonzales = (phases: PhaseConfig[]): PhaseConfig[] => {
    let raceNum = 1;
    return phases.map(p => {
      if (p.id.startsWith('qualifying_')) return p;
      return { id: p.id, label: `Гонка ${raceNum}`, shortLabel: `Г${raceNum++}` };
    });
  };

  if (groupCount === undefined || groupCount === null) {
    if (format === 'gonzales') {
      const rc = roundCount ?? 12;
      const filtered = config.phases.filter(p => {
        if (p.id.startsWith('qualifying_')) return true;
        const rm = p.id.match(/^round_(\d+)/);
        if (rm) return parseInt(rm[1]) <= rc;
        return true;
      });
      return renumberGonzales(filtered);
    }
    return config.phases;
  }

  const filtered = config.phases.filter(p => {
    if (format === 'gonzales') {
      if (p.id.startsWith('qualifying_')) {
        const num = parseInt(p.id.split('_')[1]);
        return num <= groupCount;
      }
      const rm = p.id.match(/^round_(\d+)/);
      if (rm) {
        const roundNum = parseInt(rm[1]);
        const rc = roundCount ?? 12;
        if (roundNum > rc) return false;
      }
    }
    if (format !== 'sprint' && format !== 'gonzales' && p.id.startsWith('qualifying_')) {
      const num = parseInt(p.id.split('_')[1]);
      return num <= groupCount;
    }
    const groupMatch = p.id.match(/group_(\d+)/);
    if (groupMatch) return parseInt(groupMatch[1]) <= groupCount;
    return true;
  });

  if (format === 'gonzales') return renumberGonzales(filtered);
  return filtered;
}

export function getPhaseLabel(format: string, phaseId: string, groupCount?: number): string {
  if (format === 'gonzales' && phaseId.startsWith('round_')) {
    const rm = phaseId.match(/^round_(\d+)_group_(\d+)$/);
    if (rm) {
      const round = parseInt(rm[1]);
      const group = parseInt(rm[2]);
      const gc = groupCount ?? 1;
      const raceNum = gc >= 2
        ? (round - 1) * 2 + (group === 2 ? 1 : 2)
        : round;
      return `Гонка ${raceNum}`;
    }
  }
  const config = PHASE_CONFIGS[format];
  if (!config) return phaseId;
  const phase = config.phases.find(p => p.id === phaseId);
  return phase?.label || phaseId;
}

export function getPhaseShortLabel(format: string, phaseId: string, groupCount?: number): string {
  if (format === 'gonzales' && phaseId.startsWith('round_')) {
    const rm = phaseId.match(/^round_(\d+)_group_(\d+)$/);
    if (rm) {
      const round = parseInt(rm[1]);
      const group = parseInt(rm[2]);
      const gc = groupCount ?? 1;
      const raceNum = gc >= 2
        ? (round - 1) * 2 + (group === 2 ? 1 : 2)
        : round;
      return `Г${raceNum}`;
    }
  }
  const config = PHASE_CONFIGS[format];
  if (!config) return phaseId;
  const phase = config.phases.find(p => p.id === phaseId);
  return phase?.shortLabel || phaseId;
}

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
 * Розбиває пілотів на групи за регламентом Спринту — "змійкою" (round-robin).
 * Якщо кількість пілотів не ділиться порівну на групи, змійка починається
 * з найвищої групи, щоб група яка їде першою мала більше пілотів.
 * Парна: 1→Г1, 2→Г2, 3→Г1... Непарна: 1→Г2, 2→Г1, 3→Г2...
 * ≤14 → 1 група, 15-29 → 2 групи, 30+ → 3 групи.
 */
export function splitIntoGroupsSprint(pilots: string[], maxGroups?: number): LeagueGroup[] {
  const n = pilots.length;
  let groupCount: number;

  if (n <= 14) groupCount = 1;
  else if (n <= 29) groupCount = 2;
  else groupCount = 3;

  if (maxGroups !== undefined) groupCount = Math.min(groupCount, maxGroups);

  const reversed = n % groupCount !== 0;
  const buckets: string[][] = Array.from({ length: groupCount }, () => []);
  for (let i = 0; i < n; i++) {
    const gi = reversed ? (groupCount - 1) - (i % groupCount) : i % groupCount;
    buckets[gi].push(pilots[i]);
  }

  return buckets.map((groupPilots, gi) => ({
    name: String.fromCharCode(65 + gi),
    pilots: groupPilots,
  }));
}

/**
 * Реверсивний порядок старту для групи.
 * Останній за квалою стартує першим.
 */
export function reverseStartOrder(pilots: string[]): string[] {
  return [...pilots].reverse();
}

// ============================================================
// Гонзалес — ротація картів та пропуски
// ============================================================

export interface GonzalesKartSlot {
  /** Позиція в ротаційному списку (1-based) */
  position: number;
  /** Номер карту (null = пропуск) */
  kart: number | null;
  /** Мітка: "Карт 7" або "Пропуск 1" */
  label: string;
}

/**
 * Будує ротаційний список для Гонзалеса.
 * Карти + пропуски (якщо pilotCount > karts.length), рівномірно розподілені.
 * Якщо передано slotOrder — використовує його як є.
 */
export function buildGonzalesRotation(
  karts: number[], pilotCount: number, slotOrder?: (number | null)[]
): GonzalesKartSlot[] {
  if (slotOrder && slotOrder.length > 0) {
    let skipNum = 0;
    return slotOrder.map((k, i) => {
      if (k !== null) {
        return { position: i + 1, kart: k, label: `Карт ${k}` };
      }
      skipNum++;
      return { position: i + 1, kart: null, label: `Пропуск ${skipNum}` };
    });
  }

  const skipCount = Math.max(0, pilotCount - karts.length);
  if (skipCount === 0) {
    return karts.map((k, i) => ({ position: i + 1, kart: k, label: `Карт ${k}` }));
  }

  // Split karts into skipCount groups, larger groups first
  // e.g. 12 karts, 5 skips → groups [3,3,2,2,2] → skip after 3,6,8,10,12
  const baseSize = Math.floor(karts.length / skipCount);
  const largerGroups = karts.length % skipCount;
  const groups: number[] = [];
  for (let i = 0; i < skipCount; i++) {
    groups.push(i < largerGroups ? baseSize + 1 : baseSize);
  }

  const slots: GonzalesKartSlot[] = [];
  let kartIdx = 0;
  let skipNum = 0;
  for (let g = 0; g < groups.length; g++) {
    for (let j = 0; j < groups[g]; j++) {
      slots.push({ position: slots.length + 1, kart: karts[kartIdx], label: `Карт ${karts[kartIdx]}` });
      kartIdx++;
    }
    skipNum++;
    slots.push({ position: slots.length + 1, kart: null, label: `Пропуск ${skipNum}` });
  }
  return slots;
}

/**
 * Визначає карт для пілота в конкретному раунді за ротаційним списком.
 * startSlot — стартова позиція пілота (0-based index в ротаційному списку).
 * round — номер раунду (0-based).
 * Повертає slot (kart або null для пропуску).
 */
export function getGonzalesKartForRound(slots: GonzalesKartSlot[], startSlot: number, round: number): GonzalesKartSlot {
  const idx = (startSlot + round) % slots.length;
  return slots[idx];
}

/**
 * Визначає кількість груп для Гонзалеса.
 */
export function getGonzalesGroupCount(pilotCount: number): number {
  return pilotCount <= 13 ? 1 : 2;
}

/**
 * Визначає кількість раундів для Гонзалеса.
 */
export function getGonzalesRoundCount(pilotCount: number): number {
  return Math.max(pilotCount, 12);
}
