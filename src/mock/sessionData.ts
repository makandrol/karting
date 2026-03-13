import type { KartLapRecord } from '../types';

// ============================================================
// Mock sessions — заїзди
// ============================================================

export interface SessionData {
  id: string;
  number: number;       // номер заїзду за день (від 0)
  date: string;         // "2025-03-13"
  startTime: string;    // "16:30:00"
  endTime: string;      // "16:42:00"
  durationSec: number;
  pilots: string[];
  laps: SessionLap[];
  /** Тип: прокат або змагання */
  type: 'prokat' | 'qualifying' | 'race' | 'gonzales_round';
  /** Назва змагання (якщо є) */
  competitionName: string | null;
}

export interface SessionLap {
  pilot: string;
  kart: number;
  lapNumber: number;
  lapTime: string;
  lapTimeSec: number;
  s1: string;
  s2: string;
  timestamp: string;    // ISO
}

export interface PilotProfile {
  name: string;
  totalSessions: number;
  totalLaps: number;
  bestLap: string | null;
  bestLapSec: number | null;
  sessions: { sessionId: string; date: string; sessionNumber: number; laps: number; bestLap: string; kart: number; competitionName: string | null }[];
}

// ============================================================
// Mock data generators
// ============================================================

const PILOTS = [
  'Апанасенко Олексій', 'Джасім Салєх', 'Жигаленко Антон', 'Яковлєв Ярослав',
  'Шевченко Д.', 'Бондаренко К.', 'Коваленко М.', 'Петренко О.',
];

const KARTS = [7, 3, 12, 5, 1, 10, 14, 8];

function fmtLap(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + s.toFixed(3).padStart(6, '0');
  }
  return sec.toFixed(3);
}

function genLaps(pilot: string, kart: number, count: number, base: number, sessionId: string, date: string, startHour: number): SessionLap[] {
  const laps: SessionLap[] = [];
  for (let i = 0; i < count; i++) {
    const sec = base + (Math.random() - 0.3) * 3;
    const s1 = sec * (0.32 + Math.random() * 0.02);
    const min = startHour * 60 + i * 2;
    laps.push({
      pilot, kart, lapNumber: i + 1,
      lapTime: fmtLap(sec), lapTimeSec: sec,
      s1: s1.toFixed(3), s2: (sec - s1).toFixed(3),
      timestamp: `${date}T${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}:00`,
    });
  }
  return laps;
}

// Генерація сесій за кілька днів
function generateAllSessions(): SessionData[] {
  const sessions: SessionData[] = [];
  const dates = ['2025-03-11', '2025-03-12', '2025-03-13'];

  for (const date of dates) {
    const sessionsPerDay = 3 + Math.floor(Math.random() * 3); // 3-5 сесій на день
    for (let s = 0; s < sessionsPerDay; s++) {
      const hour = 16 + s;
      const pilotsInSession = PILOTS.slice(0, 4 + Math.floor(Math.random() * 4));
      const allLaps: SessionLap[] = [];

      pilotsInSession.forEach((pilot, idx) => {
        const base = 40.5 + idx * 0.5;
        const kart = KARTS[idx % KARTS.length];
        const count = 8 + Math.floor(Math.random() * 7);
        allLaps.push(...genLaps(pilot, kart, count, base, `${date}-${s}`, date, hour));
      });

      // Деякі сесії — змагання
      const compTypes: Array<{ type: SessionData['type']; name: string | null }> = [
        { type: 'prokat', name: null },
        { type: 'prokat', name: null },
        { type: 'qualifying', name: 'Лайт Ліга' },
        { type: 'race', name: 'Лайт Ліга' },
        { type: 'gonzales_round', name: 'Гонзалес' },
      ];
      const comp = compTypes[s % compTypes.length];

      sessions.push({
        id: `${date}-${s}`,
        number: s,
        date,
        startTime: `${String(hour).padStart(2, '0')}:00:00`,
        endTime: `${String(hour).padStart(2, '0')}:${10 + Math.floor(Math.random() * 20)}:00`,
        durationSec: 600 + Math.floor(Math.random() * 300),
        pilots: pilotsInSession,
        laps: allLaps.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
        type: comp.type,
        competitionName: comp.name,
      });
    }
  }
  return sessions;
}

export const ALL_SESSIONS = generateAllSessions();

export function getSessionsByDate(date: string): SessionData[] {
  return ALL_SESSIONS.filter((s) => s.date === date);
}

export function getSessionById(id: string): SessionData | undefined {
  return ALL_SESSIONS.find((s) => s.id === id);
}

export function getTodaySessions(): SessionData[] {
  return getSessionsByDate(new Date().toISOString().split('T')[0]);
}

export function getAllDates(): string[] {
  return [...new Set(ALL_SESSIONS.map((s) => s.date))].sort();
}

// ============================================================
// Pilot profiles
// ============================================================

export function getPilotProfile(name: string): PilotProfile {
  const pilotSessions = ALL_SESSIONS.filter((s) => s.pilots.includes(name));
  const pilotLaps = pilotSessions.flatMap((s) => s.laps.filter((l) => l.pilot === name));

  let bestLapSec: number | null = null;
  let bestLap: string | null = null;
  for (const l of pilotLaps) {
    if (bestLapSec === null || l.lapTimeSec < bestLapSec) {
      bestLapSec = l.lapTimeSec;
      bestLap = l.lapTime;
    }
  }

  return {
    name,
    totalSessions: pilotSessions.length,
    totalLaps: pilotLaps.length,
    bestLap,
    bestLapSec,
    sessions: pilotSessions.map((s) => {
      const sLaps = s.laps.filter((l) => l.pilot === name);
      let sBest = Infinity;
      let sBestStr = '—';
      let kartUsed = 0;
      for (const l of sLaps) {
        if (l.lapTimeSec < sBest) { sBest = l.lapTimeSec; sBestStr = l.lapTime; }
        kartUsed = l.kart; // останній карт
      }
      return {
        sessionId: s.id, date: s.date, sessionNumber: s.number,
        laps: sLaps.length, bestLap: sBestStr,
        kart: kartUsed,
        competitionName: s.competitionName,
      };
    }),
  };
}

export function getAllPilotNames(): string[] {
  return [...new Set(ALL_SESSIONS.flatMap((s) => s.pilots))].sort();
}

export function getPilotLapsInSession(sessionId: string, pilotName: string): SessionLap[] {
  const s = getSessionById(sessionId);
  if (!s) return [];
  return s.laps.filter((l) => l.pilot === pilotName);
}
