/**
 * Pure helpers for competition session linking — frontend mirror of
 * `collector/src/competition-link-utils.js`.
 *
 * Frontend additionally has helpers for analysing a *sequence* of sessions
 * across a day (used by SessionTypeChanger.autoLinkSurroundingSessions
 * and Onboard's autoGroups detection).
 */

// ============================================================
// Format-level constants
// ============================================================

export const FORMAT_MAX_GROUPS: Record<string, number> = {
  gonzales: 2,
  light_league: 3,
  champions_league: 2,
  sprint: 3,
  marathon: 1,
};

export const FORMAT_DEFAULT_RACE_PILOTS: Record<string, number> = {
  champions_league: 24,
  light_league: 36,
  sprint: 36,
};

export const GONZALES_DEFAULT_ROUND_COUNT = 12;

// ============================================================
// Phase building
// ============================================================

export interface BuildPhasesOpts {
  gonzalesRoundCount?: number;
}

export function buildFullPhases(format: string, opts: BuildPhasesOpts = {}): string[] {
  const { gonzalesRoundCount = GONZALES_DEFAULT_ROUND_COUNT } = opts;

  if (format === 'gonzales') {
    const phases = ['qualifying_1', 'qualifying_2'];
    for (let r = 1; r <= gonzalesRoundCount; r++) {
      phases.push(`round_${r}_group_2`);
      phases.push(`round_${r}_group_1`);
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

export function filterPhases(
  phases: string[],
  groupCount: number | null | undefined,
  format: string,
  opts: BuildPhasesOpts = {}
): string[] {
  const { gonzalesRoundCount = GONZALES_DEFAULT_ROUND_COUNT } = opts;
  if (groupCount == null && format !== 'gonzales') return phases;

  const gc = groupCount ?? 99;

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

    if (format !== 'sprint' && format !== 'gonzales' && p.startsWith('qualifying_')) {
      const num = parseInt(p.split('_')[1]);
      return num <= gc;
    }

    const gm = p.match(/group_(\d+)/);
    if (gm) return parseInt(gm[1]) <= gc;

    return true;
  });
}

export function findNextPhase(phases: string[], usedPhases: Iterable<string | null | undefined>): string | null {
  const used = new Set([...usedPhases].filter((p): p is string => p != null));
  let lastUsedIdx = -1;
  for (const p of used) {
    const idx = phases.indexOf(p);
    if (idx > lastUsedIdx) lastUsedIdx = idx;
  }
  return lastUsedIdx < phases.length - 1 ? phases[lastUsedIdx + 1] : null;
}

export function allPhasesFilled(phases: string[], usedPhases: Iterable<string | null | undefined>): boolean {
  if (phases.length === 0) return false;
  const used = new Set([...usedPhases].filter((p): p is string => p != null));
  return phases.every(p => used.has(p));
}

// ============================================================
// Group detection (overlap analysis)
// ============================================================

const KART_NAME_RE = /^Карт\s+\d+$/i;

export function isKartName(name: string | null | undefined): boolean {
  return KART_NAME_RE.test((name ?? '').trim());
}

/**
 * See note in collector/src/competition-link-utils.js:
 * `realNames > 0.5 || maxLaps >= 5 (when finished)` → "qualifying" branch.
 */
export function isGonzalesQualifying(
  pilots: string[],
  lapCounts: Map<string, number> | Record<string, number> | null | undefined,
  isFinished: boolean,
): boolean {
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

export interface OverlapDetectionArgs {
  cumulativeQualifyingPilots: Set<string> | string[];
  newPilots: Set<string> | string[];
  qualifyingCount: number;
  format: string;
  threshold?: number;
}

export interface OverlapDetectionResult {
  groupCount: number | null;
  action: 'race' | 'qualifying' | 'unknown';
}

export function detectGroupCountFromOverlap(args: OverlapDetectionArgs): OverlapDetectionResult {
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
    return { groupCount: null, action: 'unknown' };
  }

  let overlap = 0;
  for (const p of fresh) if (cumulative.has(p)) overlap++;
  const ratio = overlap / fresh.size;

  if (ratio >= threshold) {
    const max = FORMAT_MAX_GROUPS[format] ?? 3;
    const gc = Math.min(Math.max(qualifyingCount, 1), max);
    return { groupCount: gc, action: 'race' };
  }

  return { groupCount: null, action: 'qualifying' };
}

export function capGroupCount(desired: number, format: string): number {
  const max = FORMAT_MAX_GROUPS[format] ?? 3;
  return Math.min(Math.max(desired, 1), max);
}

// ============================================================
// Frontend-specific: sequential overlap analysis across the day
// ============================================================

export interface SequentialSession {
  /** Stable id (use merged_session_ids[0] || id). */
  id: string;
  /** Distinct pilot names in this session. */
  pilots: Set<string>;
  /** Pilot → lap count (only used for Gonzales). */
  lapCounts: Map<string, number>;
  /** True when the session is finished (has end_time). */
  isFinished: boolean;
}

/**
 * Walk a chronologically-ordered sequence of sessions and decide how many
 * qualifying groups exist before the first "race" overlap is detected.
 *
 * Stops counting on the first `>=50% overlap` (LL/CL/Sprint) or on the first
 * "round" detection (Gonzales).
 *
 * @returns groupCount capped to FORMAT_MAX_GROUPS, qualifyingCount, indexAtStop
 */
export function detectGroupsFromSessionSequence(
  sessions: SequentialSession[],
  format: string,
): { groupCount: number; qualifyingCount: number; stoppedAtIndex: number } {
  const cumulativePilots = new Set<string>();
  let qualiCount = 0;
  let stoppedAtIndex = sessions.length;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    if (s.pilots.size === 0) continue;

    if (cumulativePilots.size === 0) {
      qualiCount = 1;
      for (const p of s.pilots) cumulativePilots.add(p);
      continue;
    }

    if (format === 'gonzales') {
      const treatAsQualifying = isGonzalesQualifying([...s.pilots], s.lapCounts, s.isFinished);
      if (treatAsQualifying) {
        qualiCount++;
        for (const p of s.pilots) cumulativePilots.add(p);
      } else {
        stoppedAtIndex = i;
      }
      break;
    }

    const detection = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: cumulativePilots,
      newPilots: s.pilots,
      qualifyingCount: qualiCount,
      format,
    });

    if (detection.action === 'race') {
      stoppedAtIndex = i;
      break;
    }

    qualiCount++;
    for (const p of s.pilots) cumulativePilots.add(p);
  }

  return {
    groupCount: capGroupCount(qualiCount, format),
    qualifyingCount: qualiCount,
    stoppedAtIndex,
  };
}

// ============================================================
// Auto-link planner — used by SessionTypeChanger
// ============================================================

export interface PlanAutoLinkArgs {
  format: string;
  groupCount: number | null;
  /** Index of the *current* session's phase in the filtered phases list. */
  currentPhaseIdx: number;
  /** Sessions available *after* the current one, chronologically ordered. */
  availableSessionsAfter: { id: string }[];
  gonzalesRoundCount?: number;
}

export interface PlannedLink {
  sessionId: string;
  phaseId: string;
}

/**
 * Plan how to assign remaining phases to available sessions after the
 * "current" linked session. Stops when phases or sessions run out.
 */
export function planAutoLink(args: PlanAutoLinkArgs): PlannedLink[] {
  const { format, groupCount, currentPhaseIdx, availableSessionsAfter, gonzalesRoundCount } = args;
  const allPhases = buildFullPhases(format, { gonzalesRoundCount });
  const phases = filterPhases(allPhases, groupCount, format, { gonzalesRoundCount });

  const remaining = phases.length - currentPhaseIdx - 1;
  const result: PlannedLink[] = [];
  for (let i = 0; i < remaining && i < availableSessionsAfter.length; i++) {
    const phaseId = phases[currentPhaseIdx + 1 + i];
    if (!phaseId) break;
    result.push({
      sessionId: availableSessionsAfter[i].id,
      phaseId,
    });
  }
  return result;
}
