/**
 * Парсер JSON з NFS timing API (nfs.playwar.com:3333/getmaininfo.json)
 *
 * Зберігає оригінальні назви полів з API.
 */

const EMPTY_TIME_SENTINEL = '8:20:00.000';

function cleanTime(val) {
  if (!val || val === '0' || val === '0.0' || val === EMPTY_TIME_SENTINEL) return null;
  return val.replace(/(\.\d{3})\d*$/, '$1');
}

/**
 * Поля, які змінюються на кожному поллі (час на трасі і т.д.)
 * При порівнянні даних ці поля ігноруються — якщо змінилися тільки вони, це poll_ok.
 */
export const VOLATILE_TEAM_FIELDS = new Set([
  'totalOnTrack',
  'secondsFromPit',
  'timeFromLassPassing',
  'lastPitMainTime',
]);

export const VOLATILE_META_FIELDS = new Set([
  'totalRaceTime',
]);

/**
 * @param {object} json — raw JSON від nfs.playwar.com:3333/getmaininfo.json
 * @returns {{ onTablo: object, teams: Array, entries: Array, raw: object } | null}
 */
export function parseTimingJson(json) {
  try {
    const { onTablo, onBoard } = json;
    if (!onTablo) return null;

    const meta = {
      raceNumber: onTablo.raceNumber ?? null,
      totalRaceTime: onTablo.totalRaceTime || null,
      isRace: !!onTablo.isRace,
      finish: !!onTablo.finish,
      raceStartedButtonTimestamp: onTablo.raceStartedButtonTimestamp ?? null,
      raceFinishedTimestamp: onTablo.raceFinishedTimestamp ?? null,
      bestLapRace: cleanTime(onTablo.bestLapRace),
      bestS1Race: cleanTime(onTablo.bestS1Race),
      bestS2Race: cleanTime(onTablo.bestS2Race),
      bestLapRaceNameTeam: onTablo.bestLapRaceNameTeam || null,
      bestLapRaceNumberTeam: onTablo.bestLapRaceNumberTeam || null,
      bestLapRaceNamePilot: onTablo.bestLapRaceNamePilot || null,
      karts: onTablo.karts || [],
    };

    const rawTeams = Array.isArray(onTablo.teams) ? onTablo.teams : [];

    const teams = rawTeams.map(t => ({
      transponderId: t.transponderId,
      position: t.position || 0,
      number: t.number || 0,
      kart: t.kart || 0,
      teamName: t.teamName || '',
      pilotName: t.pilotName || '',
      lastLap: cleanTime(t.lastLap),
      lastLapS1: cleanTime(t.lastLapS1),
      lastLapS2: cleanTime(t.lastLapS2),
      bestLap: cleanTime(t.bestLap),
      bestLapOnSegment: cleanTime(t.bestLapOnSegment),
      midLap: cleanTime(t.midLap),
      lapCount: parseInt(t.lapCount) || 0,
      lag: cleanTime(t.lag),
      isOnPit: !!t.isOnPit,
      isRaketa: !!t.isRaketa,
      pitstops: t.pitstops || 0,
      totalOnTrack: t.totalOnTrack || null,
      secondsFromPit: t.secondsFromPit ?? null,
      lastPitMainTime: t.lastPitMainTime || null,
      timeFromLassPassing: t.timeFromLassPassing ?? null,
    }));

    const entries = teams.map(t => ({
      position: t.position,
      pilot: t.pilotName || t.teamName || `Карт ${t.number}`,
      kart: t.number || t.kart || 0,
      lastLap: t.lastLap,
      s1: t.lastLapS1,
      s2: t.lastLapS2,
      bestLap: t.bestLap,
      lapNumber: t.lapCount,
    }));

    return { meta, teams, entries, raw: { onTablo, onBoard } };
  } catch (err) {
    console.error('Parse error:', err.message);
    return null;
  }
}
