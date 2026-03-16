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
  position: number;
  bestLap: string;
  bestLapSec: number;
  laps: PhaseLap[];
  startPosition?: number;
  overtakes?: number;
  points: number;
  /** Бали за позицію */
  positionPoints?: number;
  /** Бали за обгони */
  overtakePoints?: number;
  /** Бали за швидкість */
  speedPoints?: number;
  /** Штрафи */
  penalty?: number;
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

// S1 ratio from track 1: 18.2s / 42s = 0.4333
const S1_RATIO = 0.4333;

function genLaps(count: number, base: number): PhaseLap[] {
  return Array.from({ length: count }, (_, i) => {
    const sec = base + (Math.random() - 0.3) * 2;
    const s1 = sec * (S1_RATIO + (Math.random() - 0.5) * 0.02);
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
  const numGroups = pilotsSubset.length > 13 ? 2 : pilotsSubset.length > 6 ? 2 : 1;

  for (let q = 1; q <= 2; q++) {
    phases.push({ id: `${id}-q${q}`, type: 'qualifying', name: `Квала ${q}`, results: genPhaseResults(pilotsSubset, 40.5) });
  }
  for (let r = 1; r <= 3; r++) {
    if (numGroups >= 2) {
      for (let g = numGroups; g >= 1; g--) {
        const groupPilots = pilotsSubset.filter((_, i) => (i % numGroups) === (numGroups - g));
        phases.push({
          id: `${id}-r${r}g${g}`, type: 'race', name: `Гонка ${r}, Група ${g}`,
          results: genPhaseResults(groupPilots, 40.5),
        });
      }
    } else {
      phases.push({ id: `${id}-r${r}`, type: 'race', name: `Гонка ${r}`, results: genPhaseResults(pilotsSubset, 40.5) });
    }
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

export let ALL_COMPETITION_EVENTS: CompetitionEvent[] = [
  generateGonzalesEvent('gonz-1', 'Гонзалес Раунд 1', '2025-01-15', 1),
  generateGonzalesEvent('gonz-2', 'Гонзалес Раунд 2', '2025-02-12', 3),
  generateGonzalesEvent('gonz-3', 'Гонзалес Раунд 3', '2025-03-10', 1),
  generateLightLeagueEvent('ll-2026-1', 'Лайт Ліга 2026 Етап 1', '2026-01-20', 1),
  generateLightLeagueEvent('ll-2026-2', 'Лайт Ліга 2026 Етап 2', '2026-02-17', 5),
  // Test: прокат сьогодні і вчора
  {
    id: 'prokat-today-1', format: 'sprint' as CompetitionFormat, name: 'Прокат',
    date: new Date().toISOString().split('T')[0], trackConfigId: 1,
    phases: [{ id: 'pt1', type: 'race' as const, name: 'Заїзд 1', results: genPhaseResults(PILOTS.slice(0, 6), 42) }],
  },
  {
    id: 'prokat-today-2', format: 'sprint' as CompetitionFormat, name: 'Прокат',
    date: new Date().toISOString().split('T')[0], trackConfigId: 1,
    phases: [{ id: 'pt2', type: 'race' as const, name: 'Заїзд 2', results: genPhaseResults(PILOTS.slice(0, 8), 41.5) }],
  },
  {
    id: 'prokat-yest-1', format: 'sprint' as CompetitionFormat, name: 'Прокат',
    date: new Date(Date.now() - 86400000).toISOString().split('T')[0], trackConfigId: 1,
    phases: [{ id: 'py1', type: 'race' as const, name: 'Заїзд 1', results: genPhaseResults(PILOTS.slice(0, 5), 43) }],
  },
  {
    id: 'prokat-yest-2', format: 'sprint' as CompetitionFormat, name: 'Прокат',
    date: new Date(Date.now() - 86400000).toISOString().split('T')[0], trackConfigId: 1,
    phases: [{ id: 'py2', type: 'race' as const, name: 'Заїзд 2', results: genPhaseResults(PILOTS.slice(0, 10), 42) }],
  },
  // CL 2026 (mock)
  generateChampionsLeagueEvent('cl-2026-1', 'Ліга Чемпіонів 2026 Етап 1', '2026-02-01', 3),
  generateChampionsLeagueEvent('cl-2026-2', 'Ліга Чемпіонів 2026 Етап 2', '2026-03-08', 1),
];

/** Helper: build race result from raw xlsx pilot data */
function buildRaceResult(p: any, r: number, startField: string, finishField: string): PhaseResult {
  const posPts = Math.round((p[`r${r}_pos_pts`] || 0) * 10) / 10;
  const overtakePts = Math.round((p[`r${r}_overtake_pts`] || 0) * 10) / 10;
  const speedPts = Math.round((p[`r${r}_speed_pts`] || 0) * 10) / 10;
  const penalty = Math.round((p[`r${r}_penalty`] || 0) * 10) / 10;
  const total = Math.round((posPts + overtakePts + speedPts + penalty) * 10) / 10;
  return {
    pilot: p.name, kart: 0,
    position: p[finishField] || 0,
    bestLap: '', bestLapSec: 0, laps: [],
    startPosition: p[startField] || 0,
    overtakes: Math.max(0, (p[startField] || 0) - (p[finishField] || 0)),
    points: total,
    positionPoints: posPts,
    overtakePoints: overtakePts,
    speedPoints: speedPts,
    penalty: penalty,
  };
}

/** Завантажити реальні дані Лайт Ліги 2025 */
export async function loadLightLeague2025(): Promise<void> {
  try {
    const resp = await fetch('/data/lightLeague2025.json');
    if (!resp.ok) return;
    const events: any[] = await resp.json();

    const llEvents: CompetitionEvent[] = events.map((ev, idx) => {
      const phases: CompetitionPhase[] = [];
      const numGroups = ev.total_pilots > 26 ? 3 : ev.total_pilots > 13 ? 2 : 1;

      // Qualifying
      phases.push({
        id: `ll25-${idx}-q`,
        type: 'qualifying',
        name: 'Квала',
        results: ev.pilots.map((p: any) => ({
          pilot: p.name, kart: 0, position: p.pos, bestLap: '', bestLapSec: 0, laps: [],
          points: Math.round((p.quali_pts || 0) * 10) / 10,
        })),
      });

      // 2 Races
      for (let r = 1; r <= 2; r++) {
        const groupField = r === 1 ? 'quali_group' : 'r2_group';
        const startField = r === 1 ? 'r1_start' : 'r2_start';
        const finishField = r === 1 ? 'r1_finish' : 'r2_finish';

        if (numGroups >= 2) {
          for (let g = numGroups; g >= 1; g--) {
            const groupPilots = ev.pilots.filter((p: any) => p[groupField] === g);
            if (!groupPilots.length) continue;
            phases.push({
              id: `ll25-${idx}-r${r}g${g}`,
              type: 'race',
              name: `Гонка ${r}, Група ${g}`,
              results: groupPilots.map((p: any) => buildRaceResult(p, r, startField, finishField))
                .sort((a: PhaseResult, b: PhaseResult) => a.position - b.position),
            });
          }
        } else {
          phases.push({
            id: `ll25-${idx}-r${r}`,
            type: 'race',
            name: `Гонка ${r}`,
            results: ev.pilots.map((p: any) => buildRaceResult(p, r, startField, finishField))
              .sort((a: PhaseResult, b: PhaseResult) => a.position - b.position),
          });
        }
      }

      const dateFormatted = new Date(ev.date).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
      return {
        id: `ll25-${idx}`,
        format: 'light_league' as CompetitionFormat,
        name: `ЛЛ ${dateFormatted}`,
        date: ev.date,
        trackConfigId: 1,
        phases,
      };
    });

    ALL_COMPETITION_EVENTS = [
      ...ALL_COMPETITION_EVENTS.filter(e => e.format !== 'light_league' || e.id.startsWith('ll-2026')),
      ...llEvents,
    ].sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.error('Failed to load LL 2025:', e);
  }
}
export async function loadChampionsLeague2025(): Promise<void> {
  try {
    const resp = await fetch('/data/championsLeague2025.json');
    if (!resp.ok) return;
    const events: any[] = await resp.json();

    const clEvents: CompetitionEvent[] = events.map((ev, idx) => {
      const phases: CompetitionPhase[] = [];
      const numGroups = ev.total_pilots > 13 ? 2 : 1;

      // Qualifying phase
      phases.push({
        id: `cl25-${idx}-q`,
        type: 'qualifying',
        name: 'Квала',
        results: ev.pilots.map((p: any) => ({
          pilot: p.name,
          kart: 0,
          position: p.pos,
          bestLap: '',
          bestLapSec: 0,
          laps: [],
          points: p.quali_pts || 0,
        })),
      });

      // Races 1-3
      for (let r = 1; r <= 3; r++) {
        if (numGroups === 2) {
          for (let g = 2; g >= 1; g--) {
            const groupPilots = ev.pilots.filter((p: any) => {
              const gKey = r === 1 ? 'quali_group' : `r${r}_group`;
              return p[gKey] === g;
            });
            phases.push({
              id: `cl25-${idx}-r${r}g${g}`,
              type: 'race',
              name: `Гонка ${r}, Група ${g}`,
              results: groupPilots.map((p: any) => buildRaceResult(p, r, `r${r}_start`, `r${r}_finish`))
                .sort((a: PhaseResult, b: PhaseResult) => a.position - b.position),
            });
          }
        } else {
          phases.push({
            id: `cl25-${idx}-r${r}`,
            type: 'race',
            name: `Гонка ${r}`,
            results: ev.pilots.map((p: any) => buildRaceResult(p, r, `r${r}_start`, `r${r}_finish`))
              .sort((a: PhaseResult, b: PhaseResult) => a.position - b.position),
          });
        }
      }

      const dateStr = ev.date;
      const dateFormatted = new Date(dateStr).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });

      return {
        id: `cl25-${idx}`,
        format: 'champions_league' as CompetitionFormat,
        name: `ЛЧ ${dateFormatted}`,
        date: dateStr,
        trackConfigId: 1,
        phases,
      };
    });

    // Add to global events
    ALL_COMPETITION_EVENTS = [
      ...ALL_COMPETITION_EVENTS.filter(e => e.format !== 'champions_league' || e.id.startsWith('cl-2026')),
      ...clEvents,
    ].sort((a, b) => a.date.localeCompare(b.date));

  } catch (e) {
    console.error('Failed to load CL 2025 data:', e);
  }
}

export function getEventsByFormat(format: CompetitionFormat): CompetitionEvent[] {
  return ALL_COMPETITION_EVENTS.filter(e => e.format === format);
}

export function getEventById(id: string): CompetitionEvent | undefined {
  return ALL_COMPETITION_EVENTS.find(e => e.id === id);
}
