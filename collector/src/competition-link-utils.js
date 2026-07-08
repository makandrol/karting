/**
 * Pure helpers for competition session linking.
 *
 * Витягнуто зі `storage.js` щоб:
 * - усунути дубль FULL_PHASES + filterPhases у `autoLinkSessionToActiveCompetition` і `recheckSessionPhase`
 * - покрити логіку юніт-тестами
 * - дати фронтенду спільний джерело правди (через окремий ts-файл-дзеркало)
 *
 * НЕ робить ніяких I/O — тільки чисті функції.
 */

// ============================================================
// Format-level constants
// ============================================================

export const FORMAT_MAX_GROUPS = {
  gonzales: 2,
  light_league: 3,
  champions_league: 2,
  sprint: 3,
  marathon: 1,
};

export const FORMAT_DEFAULT_RACE_PILOTS = {
  champions_league: 24,
  light_league: 36,
  sprint: 36,
};

export const GONZALES_DEFAULT_ROUND_COUNT = 12;

// ============================================================
// Phase building
// ============================================================

/**
 * Build the full ordered phase list for a competition format.
 *
 * @param {string} format
 * @param {object} [opts]
 * @param {number} [opts.gonzalesRoundCount=12]
 * @returns {string[]} ordered phase ids (empty for unknown format)
 */
export function buildFullPhases(format, opts = {}) {
  const { gonzalesRoundCount = GONZALES_DEFAULT_ROUND_COUNT } = opts;

  if (format === 'gonzales') {
    // Гонзалес НЕ має груп — 1 заїзд на раунд. Кількість раундів = MAX(12, пілотів).
    // Карти завжди 12; якщо пілотів більше, додаються раунди для повної ротації.
    const phases = ['qualifying_1', 'qualifying_2'];
    for (let r = 1; r <= gonzalesRoundCount; r++) {
      phases.push(`round_${r}`);
    }
    return phases;
  }

  if (format === 'light_league') {
    return [
      'qualifying_1', 'qualifying_2', 'qualifying_3', 'qualifying_4',
      'race_1_group_3', 'race_1_group_2', 'race_1_group_1',
      'race_2_group_3', 'race_2_group_2', 'race_2_group_1',
    ];
  }

  if (format === 'champions_league') {
    return [
      'qualifying_1', 'qualifying_2',
      'race_1_group_2', 'race_1_group_1',
      'race_2_group_2', 'race_2_group_1',
      'race_3_group_2', 'race_3_group_1',
    ];
  }

  if (format === 'sprint') {
    return [
      'qualifying_1_group_1', 'qualifying_1_group_2', 'qualifying_1_group_3',
      'race_1_group_3', 'race_1_group_2', 'race_1_group_1',
      'qualifying_2_group_1', 'qualifying_2_group_2', 'qualifying_2_group_3',
      'race_2_group_3', 'race_2_group_2', 'race_2_group_1',
      'final_group_3', 'final_group_2', 'final_group_1',
    ];
  }

  if (format === 'marathon') return ['race'];

  return [];
}

/**
 * Filter phases by groupCount.
 *
 * Rules:
 * - LL/CL: drop `qualifying_N` if N > qualiCount (квалі ≠ race-групи! LL може
 *   мати 4 квалі-групи, що зливаються в 3 race-групи); fallback на groupCount
 *   якщо qualiCount не переданий. Будь-яку фазу з `group_M` — якщо M > groupCount.
 * - Sprint: drop `*_group_M` if M > groupCount (qualifying phases теж мають group_M).
 * - Gonzales: drop `qualifying_N` if N > groupCount; drop `round_N` if N > gonzalesRoundCount
 *   (раунди НЕ мають груп — групи стосуються лише кількості кваліфікацій).
 *
 * groupCount=null/undefined → no filtering (returns full list).
 *
 * @param {string[]} phases
 * @param {number|null|undefined} groupCount
 * @param {string} format
 * @param {object} [opts]
 * @param {number} [opts.gonzalesRoundCount=12]
 * @param {number|null} [opts.qualiCount=null] к-сть кваліфікацій (LL/CL); fallback на groupCount
 * @returns {string[]}
 */
export function filterPhases(phases, groupCount, format, opts = {}) {
  const { gonzalesRoundCount = GONZALES_DEFAULT_ROUND_COUNT, qualiCount = null } = opts;
  if (groupCount == null && format !== 'gonzales') return phases;

  const gc = groupCount ?? 99;
  // Квалі ріжемо по qualiCount (квалі ≠ race-групи); fallback на gc — стара поведінка.
  const qc = qualiCount ?? gc;

  return phases.filter(p => {
    if (format === 'gonzales') {
      if (p.startsWith('qualifying_')) {
        const num = parseInt(p.split('_')[1]);
        return num <= gc;
      }
      const rm = p.match(/^round_(\d+)/);
      if (rm) {
        const roundNum = parseInt(rm[1]);
        if (roundNum > gonzalesRoundCount) return false;
      }
    }

    // LL/CL: qualifying_N → cap by qualiCount (НЕ groupCount)
    if (format !== 'sprint' && format !== 'gonzales' && p.startsWith('qualifying_')) {
      const num = parseInt(p.split('_')[1]);
      return num <= qc;
    }

    // Sprint + everywhere: group_M
    const gm = p.match(/group_(\d+)/);
    if (gm) return parseInt(gm[1]) <= gc;

    return true;
  });
}

/**
 * Find next phase to assign — first phase from the ordered list not yet used.
 *
 * @param {string[]} phases ordered list (already filtered by groupCount)
 * @param {Iterable<string>} usedPhases
 * @returns {string|null}
 */
export function findNextPhase(phases, usedPhases) {
  const used = new Set(usedPhases);
  let lastUsedIdx = -1;
  for (const p of used) {
    const idx = phases.indexOf(p);
    if (idx > lastUsedIdx) lastUsedIdx = idx;
  }
  return lastUsedIdx < phases.length - 1 ? phases[lastUsedIdx + 1] : null;
}

/**
 * Check if all expected phases are filled — used as a guard
 * against late sessions hijacking a finished competition.
 *
 * @param {string[]} phases ordered list (already filtered)
 * @param {Iterable<string>} usedPhases
 * @returns {boolean}
 */
export function allPhasesFilled(phases, usedPhases) {
  if (phases.length === 0) return false;
  const used = new Set(usedPhases);
  return phases.every(p => used.has(p));
}

// ============================================================
// Group detection (overlap analysis)
// ============================================================

const KART_NAME_RE = /^Карт\s+\d+$/i;

export function isKartName(name) {
  return KART_NAME_RE.test((name || '').trim());
}

/**
 * Decide if a Gonzales session should be treated as a "qualifying"
 * (collector incrementing groupCount) or a "round" (groupCount stays).
 *
 * Mirrors current `storage.js` behaviour — see the original
 * `isRealNames || isHighLapCount` branch at lines 632-642:
 * - real names ratio > 0.5  → qualifying
 * - max lap count >= 5 (when finished) → qualifying
 *
 * NOTE: the docs/competition-detection.md description ("kart names + many laps = rounds")
 * is *inverted* relative to the actual code. We keep the code-truth here
 * and address the doc/code mismatch separately if needed.
 *
 * @param {string[]} pilots distinct pilot names
 * @param {Map<string,number>|object} lapCounts pilot → lap count
 * @param {boolean} isFinished
 * @returns {boolean} true = treat as qualifying, false = treat as round
 */
export function isGonzalesQualifying(pilots, lapCounts, isFinished) {
  const realNames = pilots.filter(p => !isKartName(p)).length;
  const isRealNames = pilots.length > 0 && realNames / pilots.length > 0.5;

  let isHighLapCount = false;
  if (isFinished && lapCounts) {
    const counts = lapCounts instanceof Map
      ? [...lapCounts.values()]
      : Object.values(lapCounts);
    if (counts.length > 0) {
      const maxLaps = Math.max(...counts);
      isHighLapCount = maxLaps >= 5;
    }
  }

  return isRealNames || isHighLapCount;
}

/**
 * Detect group count for LL/CL/Sprint via pilot overlap.
 *
 * Compares the set of pilots in the new session against cumulative
 * pilots from all previous qualifying sessions:
 * - overlap >= 0.5 → it's a race, groupCount = qualifyingCount.
 * - overlap < 0.5 → it's another qualifying group, no decision yet.
 *
 * @param {object} args
 * @param {Set<string>|string[]} args.cumulativeQualifyingPilots
 * @param {Set<string>|string[]} args.newPilots
 * @param {number} args.qualifyingCount how many quali sessions already linked
 * @param {string} args.format
 * @param {number} [args.threshold=0.5]
 * @returns {{ groupCount: number|null, action: 'race' | 'qualifying' | 'unknown' }}
 */
export function detectGroupCountFromOverlap(args) {
  const {
    cumulativeQualifyingPilots,
    newPilots,
    qualifyingCount,
    format,
    threshold = 0.5,
  } = args;

  const cumulative = cumulativeQualifyingPilots instanceof Set
    ? cumulativeQualifyingPilots
    : new Set(cumulativeQualifyingPilots);
  const fresh = newPilots instanceof Set
    ? newPilots
    : new Set(newPilots);

  if (fresh.size === 0 || cumulative.size === 0) {
    if (process.env.LINK_DEBUG) console.log(`[LINK_DEBUG] overlap: fresh=${fresh.size} cumulative=${cumulative.size} → unknown (not enough data)`);
    return { groupCount: null, action: 'unknown' };
  }

  let overlap = 0;
  const missing = [];
  for (const p of fresh) { if (cumulative.has(p)) overlap++; else missing.push(p); }
  const ratio = overlap / fresh.size;

  if (process.env.LINK_DEBUG) {
    console.log(`[LINK_DEBUG] overlap: fresh=${fresh.size} cumulative=${cumulative.size} overlap=${overlap} ratio=${ratio.toFixed(3)} threshold=${threshold} qualifyingCount=${qualifyingCount}`);
    if (missing.length) console.log(`[LINK_DEBUG]   fresh NOT in cumulative (${missing.length}): ${JSON.stringify(missing)}`);
  }

  if (ratio >= threshold) {
    const max = FORMAT_MAX_GROUPS[format] ?? 3;
    const gc = Math.min(Math.max(qualifyingCount, 1), max);
    if (process.env.LINK_DEBUG) console.log(`[LINK_DEBUG]   → RACE (groupCount=${gc})`);
    return { groupCount: gc, action: 'race' };
  }

  if (process.env.LINK_DEBUG) console.log(`[LINK_DEBUG]   → QUALIFYING (ratio ${ratio.toFixed(3)} < ${threshold})`);
  return { groupCount: null, action: 'qualifying' };
}

/**
 * Cap groupCount by format max.
 *
 * @param {number} desired
 * @param {string} format
 * @returns {number}
 */
export function capGroupCount(desired, format) {
  const max = FORMAT_MAX_GROUPS[format] ?? 3;
  return Math.min(Math.max(desired, 1), max);
}

// ============================================================
// Auto-start competition: schedule, time windows, name builders
// ============================================================

/**
 * Weekly competition schedule. Day index: 0=Sunday, 1=Monday, ..., 6=Saturday.
 *
 * Reflects the karting club's actual operating pattern (analysed from real
 * sessions Apr-May 2026): Mon=Гонзалес, Tue=ЛЛ, Wed=ЛЧ. All start ≥19:45 Kyiv.
 *
 * Sprint/Marathon — manual only (rare special events, not regular).
 */
export const COMPETITION_SCHEDULE = {
  1: { format: 'gonzales',         shortName: 'Гонз', startHour: 20, startMin: 5 },  // Понеділок 20:05
  2: { format: 'light_league',     shortName: 'ЛЛ', startHour: 19, startMin: 40 },   // Вівторок (перша квала інколи о 19:40)
  3: { format: 'champions_league', shortName: 'ЛЧ', startHour: 19, startMin: 40 },   // Середа
};

/** Hour (Kyiv local time) at which competition window opens. */
export const COMPETITION_AUTO_START_HOUR_KYIV = 19;

/** Minute past the hour at which window opens. */
export const COMPETITION_AUTO_START_MIN_KYIV = 45;

/**
 * Kyiv UTC offset in hours.
 *
 * NOTE: this is currently hardcoded. Kyiv is UTC+3 in summer (EEST, last Sun
 * of March → last Sun of October) and UTC+2 in winter (EET). Adjust manually
 * on DST transitions, or replace with `Intl.DateTimeFormat` lookup.
 */
export const KYIV_UTC_OFFSET_HOURS = 3;

/**
 * Convert UTC unix-ms to Kyiv local Date components.
 *
 * @param {number} timestampMs
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number, dayOfWeek: number }}
 *   month is 1-12 (NOT 0-indexed); dayOfWeek is 0=Sunday..6=Saturday
 */
export function getKyivLocalParts(timestampMs) {
  const shifted = new Date(timestampMs + KYIV_UTC_OFFSET_HOURS * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

/**
 * Returns the format scheduled for the day of `timestampMs`, or null.
 *
 * @param {number} timestampMs
 * @returns {string|null}
 */
export function getScheduledFormat(timestampMs) {
  const { dayOfWeek } = getKyivLocalParts(timestampMs);
  return COMPETITION_SCHEDULE[dayOfWeek]?.format ?? null;
}

/**
 * Is `timestampMs` inside the competition window for its scheduled day?
 *
 * Поріг часу — per-day (startHour/startMin у COMPETITION_SCHEDULE), з
 * fallback на глобальний дефолт (19:45). Гонзалес стартує о 20:05.
 *
 * @param {number} timestampMs
 * @returns {boolean}
 */
export function isCompetitionTime(timestampMs) {
  const parts = getKyivLocalParts(timestampMs);
  const sched = COMPETITION_SCHEDULE[parts.dayOfWeek];
  if (!sched) return false;
  const startHour = sched.startHour ?? COMPETITION_AUTO_START_HOUR_KYIV;
  const startMin = sched.startMin ?? COMPETITION_AUTO_START_MIN_KYIV;
  if (parts.hour < startHour) return false;
  if (parts.hour === startHour && parts.minute < startMin) return false;
  return true;
}

/**
 * Build a competition id mirroring `SessionTypeChanger.handleCreateCompetition`:
 * `${format}-${YYYY-MM-DD}-${base36 of unix-ms}`.
 *
 * @param {string} format
 * @param {number} timestampMs
 * @returns {string}
 */
export function buildAutoCompetitionId(format, timestampMs) {
  const { year, month, day } = getKyivLocalParts(timestampMs);
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return `${format}-${isoDate}-${timestampMs.toString(36)}`;
}

/**
 * Build a human name like `"ЛЛ, 03.06.26, Тр. 7"`.
 *
 * @param {string} format
 * @param {number} timestampMs
 * @param {string|number} trackLabel — printable track id (e.g. "7" or "5R")
 * @returns {string}
 */
export function buildAutoCompetitionName(format, timestampMs, trackLabel) {
  const { year, month, day, dayOfWeek } = getKyivLocalParts(timestampMs);
  const shortName = COMPETITION_SCHEDULE[dayOfWeek]?.shortName ?? format;
  const dateStr = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${String(year).slice(2)}`;
  return `${shortName}, ${dateStr}, Тр. ${trackLabel}`;
}

/**
 * Build the local-date string `"YYYY-MM-DD"` for `timestampMs` in Kyiv tz.
 *
 * @param {number} timestampMs
 * @returns {string}
 */
export function getKyivIsoDate(timestampMs) {
  const { year, month, day } = getKyivLocalParts(timestampMs);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
