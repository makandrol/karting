import type { TimingEntry } from '../types';

interface PilotConfig {
  name: string;
  kart: number;
  baseLapTime: number;
  variance: number;
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

// Патерн відхилень від базового часу для тестування
const LAP_VARIATION_PATTERN = [-1, +2, -1, -1, +2, 0, -0.5, +1.5, -1, +0.5];

interface PilotState {
  config: PilotConfig;
  lapStartTime: number;
  currentLapDuration: number;  // мс
  currentS1Duration: number;   // мс
  s1Crossed: boolean;
  lapNumber: number;
  lastLap: string | null;
  lastS1: string | null;
  lastS2: string | null;
  currentS1: string | null;
  bestLap: string | null;
  bestLapSec: number | null;
  bestS1: string | null;
  bestS1Sec: number | null;
  bestS2: string | null;
  bestS2Sec: number | null;
}

function formatLapTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${String(mins).padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
}

function formatSector(seconds: number): string {
  return seconds.toFixed(3);
}

function generateLapDuration(config: PilotConfig, lapNumber: number): number {
  // Детерміністичний патерн замість рандому
  const patternIdx = lapNumber % LAP_VARIATION_PATTERN.length;
  const variation = LAP_VARIATION_PATTERN[patternIdx];
  const lapSec = config.baseLapTime + variation;
  return Math.max(lapSec, 39.0) * 1000;
}

export class DemoSimulator {
  private pilots: PilotState[];
  private startedAt: number;

  constructor(pilotCount: number = 10) {
    this.startedAt = Date.now();
    const configs = PILOT_CONFIGS.slice(0, Math.min(pilotCount, PILOT_CONFIGS.length));

    this.pilots = configs.map((config, idx) => {
      // Кожен стартує з різним зміщенням
      const initialOffset = (idx * 3.5) * 1000; // рівномірно розкидані
      const lapDuration = generateLapDuration(config, 1);
      const s1Duration = lapDuration * config.s1Ratio;

      return {
        config,
        lapStartTime: this.startedAt - initialOffset,
        currentLapDuration: lapDuration,
        currentS1Duration: s1Duration,
        s1Crossed: initialOffset > s1Duration,
        lapNumber: 1,
        lastLap: null,
        lastS1: null,
        lastS2: null,
        currentS1: initialOffset > s1Duration ? formatSector(s1Duration / 1000) : null,
        bestLap: null, bestLapSec: null,
        bestS1: null, bestS1Sec: null,
        bestS2: null, bestS2Sec: null,
      };
    });
  }

  tick(): TimingEntry[] {
    const now = Date.now();

    for (const pilot of this.pilots) {
      const elapsed = now - pilot.lapStartTime;
      const progress = elapsed / pilot.currentLapDuration;

      if (!pilot.s1Crossed && elapsed >= pilot.currentS1Duration) {
        pilot.s1Crossed = true;
        const s1Sec = pilot.currentS1Duration / 1000;
        pilot.currentS1 = formatSector(s1Sec);
        if (pilot.bestS1Sec === null || s1Sec < pilot.bestS1Sec) {
          pilot.bestS1Sec = s1Sec; pilot.bestS1 = formatSector(s1Sec);
        }
      }

      if (progress >= 1.0) {
        const lapSec = pilot.currentLapDuration / 1000;
        const s1Sec = pilot.currentS1Duration / 1000;
        const s2Sec = lapSec - s1Sec;

        pilot.lastLap = formatLapTime(lapSec);
        pilot.lastS1 = formatSector(s1Sec);
        pilot.lastS2 = formatSector(s2Sec);
        pilot.lapNumber += 1;

        if (pilot.bestLapSec === null || lapSec < pilot.bestLapSec) {
          pilot.bestLapSec = lapSec; pilot.bestLap = formatLapTime(lapSec);
        }
        if (pilot.bestS2Sec === null || s2Sec < pilot.bestS2Sec) {
          pilot.bestS2Sec = s2Sec; pilot.bestS2 = formatSector(s2Sec);
        }
        if (pilot.bestS1Sec === null || s1Sec < pilot.bestS1Sec) {
          pilot.bestS1Sec = s1Sec; pilot.bestS1 = formatSector(s1Sec);
        }

        const newLapDuration = generateLapDuration(pilot.config, pilot.lapNumber);
        pilot.lapStartTime = now;
        pilot.currentLapDuration = newLapDuration;
        pilot.currentS1Duration = newLapDuration * pilot.config.s1Ratio;
        pilot.s1Crossed = false;
        pilot.currentS1 = null;
      }
    }

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
        currentLapSec: pilot.currentLapDuration / 1000,
      };
    });

    entries.sort((a, b) => {
      if (a.bestLap === null && b.bestLap === null) return 0;
      if (a.bestLap === null) return 1;
      if (b.bestLap === null) return -1;
      const aM = a.bestLap.match(/^(\d+):(\d+\.\d+)$/);
      const bM = b.bestLap.match(/^(\d+):(\d+\.\d+)$/);
      if (!aM || !bM) return 0;
      return (parseInt(aM[1])*60+parseFloat(aM[2])) - (parseInt(bM[1])*60+parseFloat(bM[2]));
    });

    entries.forEach((e, i) => { e.position = i + 1; });
    return entries;
  }

  reset(): void {
    this.startedAt = Date.now();
    for (const pilot of this.pilots) {
      pilot.lapStartTime = this.startedAt;
      pilot.currentLapDuration = generateLapDuration(pilot.config, 1);
      pilot.currentS1Duration = pilot.currentLapDuration * pilot.config.s1Ratio;
      pilot.s1Crossed = false; pilot.lapNumber = 1;
      pilot.lastLap = null; pilot.lastS1 = null; pilot.lastS2 = null; pilot.currentS1 = null;
      pilot.bestLap = null; pilot.bestLapSec = null;
      pilot.bestS1 = null; pilot.bestS1Sec = null;
      pilot.bestS2 = null; pilot.bestS2Sec = null;
    }
  }
}
