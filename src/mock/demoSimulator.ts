import type { TimingEntry } from '../types';

// ============================================================
// Конфігурація пілотів — базова швидкість і стабільність
// ============================================================

interface PilotConfig {
  name: string;
  kart: number;
  /** Базовий час кола в секундах */
  baseLapTime: number;
  /** Дисперсія часу кола (менше = стабільніший) */
  variance: number;
  /** Частка S1 від загального часу (зазвичай ~0.33) */
  s1Ratio: number;
}

const PILOT_CONFIGS: PilotConfig[] = [
  { name: 'Апанасенко Олексій', kart: 7,  baseLapTime: 40.8, variance: 0.6, s1Ratio: 0.325 },
  { name: 'Джасім Салєх',       kart: 3,  baseLapTime: 41.5, variance: 0.8, s1Ratio: 0.330 },
  { name: 'Жигаленко Антон',    kart: 12, baseLapTime: 41.8, variance: 0.7, s1Ratio: 0.328 },
  { name: 'Яковлєв Ярослав',    kart: 5,  baseLapTime: 42.0, variance: 0.9, s1Ratio: 0.335 },
  { name: 'Шевченко Д.',        kart: 1,  baseLapTime: 42.3, variance: 1.0, s1Ratio: 0.330 },
  { name: 'Бондаренко К.',      kart: 10, baseLapTime: 42.6, variance: 0.8, s1Ratio: 0.332 },
  { name: 'Коваленко М.',       kart: 14, baseLapTime: 42.9, variance: 1.1, s1Ratio: 0.327 },
  { name: 'Петренко О.',        kart: 8,  baseLapTime: 43.2, variance: 1.0, s1Ratio: 0.334 },
  { name: 'Ткаченко В.',        kart: 15, baseLapTime: 43.5, variance: 1.2, s1Ratio: 0.330 },
  { name: 'Мельник І.',         kart: 17, baseLapTime: 43.8, variance: 1.0, s1Ratio: 0.328 },
];

// ============================================================
// Стан кожного пілота в симуляції
// ============================================================

interface PilotState {
  config: PilotConfig;

  /** Абсолютний час (мс) коли стартувало поточне коло */
  lapStartTime: number;
  /** Тривалість поточного кола (мс), визначається на старті */
  currentLapDuration: number;
  /** Тривалість S1 поточного кола (мс) */
  currentS1Duration: number;

  /** Чи вже пройдено S1 на цьому колі */
  s1Crossed: boolean;

  /** Поточне коло (номер) */
  lapNumber: number;
  /** Час останнього завершеного кола */
  lastLap: string | null;
  /** S1 останнього завершеного кола */
  lastS1: string | null;
  /** S2 останнього завершеного кола */
  lastS2: string | null;

  /** Поточний S1 (оновлюється посередині кола) */
  currentS1: string | null;

  /** Найкращі часи */
  bestLap: string | null;
  bestLapSec: number | null;
  bestS1: string | null;
  bestS1Sec: number | null;
  bestS2: string | null;
  bestS2Sec: number | null;
}

// ============================================================
// Утиліти форматування
// ============================================================

function formatLapTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${String(mins).padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
}

function formatSector(seconds: number): string {
  return seconds.toFixed(3);
}

function generateLapDuration(config: PilotConfig): number {
  // Нормальний розподіл через Box-Muller
  const u1 = Math.random();
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const lapSec = config.baseLapTime + normal * config.variance;
  return Math.max(lapSec, 39.0) * 1000; // мілісекунди, мінімум 39с
}

// ============================================================
// DemoSimulator — stateful симулятор таймінгу
// ============================================================

export class DemoSimulator {
  private pilots: PilotState[];
  private startedAt: number;

  constructor(pilotCount: number = 10) {
    this.startedAt = Date.now();
    const configs = PILOT_CONFIGS.slice(0, Math.min(pilotCount, PILOT_CONFIGS.length));

    this.pilots = configs.map((config) => {
      // Кожен пілот стартує з випадковим зміщенням (ніби вже їздять)
      const initialOffset = Math.random() * config.baseLapTime * 1000;
      const lapDuration = generateLapDuration(config);
      const s1Duration = lapDuration * config.s1Ratio;

      return {
        config,
        lapStartTime: this.startedAt - initialOffset,
        currentLapDuration: lapDuration,
        currentS1Duration: s1Duration,
        s1Crossed: initialOffset > s1Duration,
        lapNumber: Math.floor(Math.random() * 3) + 1,
        lastLap: null,
        lastS1: null,
        lastS2: null,
        currentS1: initialOffset > s1Duration
          ? formatSector(s1Duration / 1000)
          : null,
        bestLap: null,
        bestLapSec: null,
        bestS1: null,
        bestS1Sec: null,
        bestS2: null,
        bestS2Sec: null,
      };
    });
  }

  /**
   * Викликається кожний тік (1 сек).
   * Оновлює стан пілотів і повертає поточні entries.
   */
  tick(): TimingEntry[] {
    const now = Date.now();

    for (const pilot of this.pilots) {
      const elapsed = now - pilot.lapStartTime;
      const progress = elapsed / pilot.currentLapDuration;

      // === Перевірка проходження S1 ===
      if (!pilot.s1Crossed && elapsed >= pilot.currentS1Duration) {
        pilot.s1Crossed = true;
        const s1Sec = pilot.currentS1Duration / 1000;
        pilot.currentS1 = formatSector(s1Sec);

        // Оновити best S1
        if (pilot.bestS1Sec === null || s1Sec < pilot.bestS1Sec) {
          pilot.bestS1Sec = s1Sec;
          pilot.bestS1 = formatSector(s1Sec);
        }
      }

      // === Перевірка завершення кола (фініш) ===
      if (progress >= 1.0) {
        const lapSec = pilot.currentLapDuration / 1000;
        const s1Sec = pilot.currentS1Duration / 1000;
        const s2Sec = lapSec - s1Sec;

        pilot.lastLap = formatLapTime(lapSec);
        pilot.lastS1 = formatSector(s1Sec);
        pilot.lastS2 = formatSector(s2Sec);
        pilot.lapNumber += 1;

        // Оновити best lap
        if (pilot.bestLapSec === null || lapSec < pilot.bestLapSec) {
          pilot.bestLapSec = lapSec;
          pilot.bestLap = formatLapTime(lapSec);
        }

        // Оновити best S2
        if (pilot.bestS2Sec === null || s2Sec < pilot.bestS2Sec) {
          pilot.bestS2Sec = s2Sec;
          pilot.bestS2 = formatSector(s2Sec);
        }

        // Оновити best S1 (на фініші теж, якщо раптом не оновилося)
        if (pilot.bestS1Sec === null || s1Sec < pilot.bestS1Sec) {
          pilot.bestS1Sec = s1Sec;
          pilot.bestS1 = formatSector(s1Sec);
        }

        // === Новий круг ===
        const newLapDuration = generateLapDuration(pilot.config);
        pilot.lapStartTime = now;
        pilot.currentLapDuration = newLapDuration;
        pilot.currentS1Duration = newLapDuration * pilot.config.s1Ratio;
        pilot.s1Crossed = false;
        pilot.currentS1 = null;
      }
    }

    // === Формуємо entries і сортуємо за bestLap ===
    const entries: TimingEntry[] = this.pilots.map((pilot) => {
      const elapsed = Date.now() - pilot.lapStartTime;
      const progress = Math.min(elapsed / pilot.currentLapDuration, 0.99);

      return {
        position: 0,
        pilot: pilot.config.name,
        kart: pilot.config.kart,
        lastLap: pilot.lastLap,
        s1: pilot.s1Crossed ? pilot.currentS1 : (pilot.lastS1 || null),
        s2: pilot.lastS2,
        bestLap: pilot.bestLap,
        lapNumber: pilot.lapNumber,
        bestS1: pilot.bestS1,
        bestS2: pilot.bestS2,
        progress,
      };
    });

    // Сортуємо: ті в кого є bestLap — за ним, інші — в кінець
    entries.sort((a, b) => {
      if (a.bestLap === null && b.bestLap === null) return 0;
      if (a.bestLap === null) return 1;
      if (b.bestLap === null) return -1;

      const aMatch = a.bestLap.match(/^(\d+):(\d+\.\d+)$/);
      const bMatch = b.bestLap.match(/^(\d+):(\d+\.\d+)$/);
      if (!aMatch || !bMatch) return 0;

      const aSec = parseInt(aMatch[1]) * 60 + parseFloat(aMatch[2]);
      const bSec = parseInt(bMatch[1]) * 60 + parseFloat(bMatch[2]);
      return aSec - bSec;
    });

    entries.forEach((e, i) => { e.position = i + 1; });

    return entries;
  }

  /** Скидає симуляцію */
  reset(): void {
    this.startedAt = Date.now();
    for (const pilot of this.pilots) {
      pilot.lapStartTime = this.startedAt - Math.random() * pilot.config.baseLapTime * 1000;
      pilot.currentLapDuration = generateLapDuration(pilot.config);
      pilot.currentS1Duration = pilot.currentLapDuration * pilot.config.s1Ratio;
      pilot.s1Crossed = false;
      pilot.lapNumber = 1;
      pilot.lastLap = null;
      pilot.lastS1 = null;
      pilot.lastS2 = null;
      pilot.currentS1 = null;
      pilot.bestLap = null;
      pilot.bestLapSec = null;
      pilot.bestS1 = null;
      pilot.bestS1Sec = null;
      pilot.bestS2 = null;
      pilot.bestS2Sec = null;
    }
  }
}
