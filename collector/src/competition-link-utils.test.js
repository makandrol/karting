import { describe, it, expect } from 'vitest';
import {
  FORMAT_MAX_GROUPS,
  FORMAT_DEFAULT_RACE_PILOTS,
  buildFullPhases,
  filterPhases,
  findNextPhase,
  allPhasesFilled,
  isKartName,
  isGonzalesQualifying,
  detectGroupCountFromOverlap,
  capGroupCount,
  COMPETITION_SCHEDULE,
  COMPETITION_AUTO_START_HOUR_KYIV,
  COMPETITION_AUTO_START_MIN_KYIV,
  getKyivLocalParts,
  getScheduledFormat,
  isCompetitionTime,
  buildAutoCompetitionId,
  buildAutoCompetitionName,
  getKyivIsoDate,
} from './competition-link-utils.js';

// ============================================================
// FORMAT_MAX_GROUPS / FORMAT_DEFAULT_RACE_PILOTS
// ============================================================

describe('FORMAT_MAX_GROUPS', () => {
  it('каже champions_league = 2', () => {
    expect(FORMAT_MAX_GROUPS.champions_league).toBe(2);
  });
  it('каже sprint = 3', () => {
    expect(FORMAT_MAX_GROUPS.sprint).toBe(3);
  });
  it('каже gonzales = 2', () => {
    expect(FORMAT_MAX_GROUPS.gonzales).toBe(2);
  });
  it('каже light_league = 3', () => {
    expect(FORMAT_MAX_GROUPS.light_league).toBe(3);
  });
});

describe('FORMAT_DEFAULT_RACE_PILOTS', () => {
  it('CL = 24, LL/Sprint = 36', () => {
    expect(FORMAT_DEFAULT_RACE_PILOTS.champions_league).toBe(24);
    expect(FORMAT_DEFAULT_RACE_PILOTS.light_league).toBe(36);
    expect(FORMAT_DEFAULT_RACE_PILOTS.sprint).toBe(36);
  });
});

// ============================================================
// buildFullPhases
// ============================================================

describe('buildFullPhases', () => {
  it('LL: 4 quali + 2 races × 3 groups = 10 фаз', () => {
    const phases = buildFullPhases('light_league');
    expect(phases).toHaveLength(10);
    expect(phases[0]).toBe('qualifying_1');
    expect(phases.filter(p => p.startsWith('qualifying_'))).toHaveLength(4);
    expect(phases.filter(p => p.startsWith('race_1_'))).toHaveLength(3);
    expect(phases.filter(p => p.startsWith('race_2_'))).toHaveLength(3);
  });

  it('CL: 2 quali + 3 races × 2 groups = 8 фаз', () => {
    const phases = buildFullPhases('champions_league');
    expect(phases).toHaveLength(8);
    expect(phases.filter(p => p.startsWith('race_3_'))).toHaveLength(2);
  });

  it('Sprint: q1×3 + r1×3 + q2×3 + r2×3 + final×3 = 15 фаз', () => {
    const phases = buildFullPhases('sprint');
    expect(phases).toHaveLength(15);
    expect(phases.filter(p => p.startsWith('qualifying_1_'))).toHaveLength(3);
    expect(phases.filter(p => p.startsWith('final_'))).toHaveLength(3);
  });

  it('Sprint: всередині раунду race_*_group_3 → race_*_group_1 (зворотний порядок)', () => {
    const phases = buildFullPhases('sprint');
    const r1 = phases.filter(p => p.startsWith('race_1_'));
    expect(r1).toEqual(['race_1_group_3', 'race_1_group_2', 'race_1_group_1']);
  });

  it('Gonzales: 2 quali + 12 раундів (1 фаза на раунд, без груп) = 14', () => {
    const phases = buildFullPhases('gonzales');
    expect(phases).toHaveLength(2 + 12);
    expect(phases[2]).toBe('round_1');
    expect(phases[3]).toBe('round_2');
    expect(phases).not.toContain('round_1_group_1');
    expect(phases).not.toContain('round_1_group_2');
  });

  it('Gonzales: кастомний roundCount (більше пілотів → більше раундів)', () => {
    const phases = buildFullPhases('gonzales', { gonzalesRoundCount: 18 });
    expect(phases).toHaveLength(2 + 18);
    expect(phases[phases.length - 1]).toBe('round_18');
  });

  it('Marathon: 1 фаза', () => {
    expect(buildFullPhases('marathon')).toEqual(['race']);
  });

  it('Невідомий формат: пустий масив', () => {
    expect(buildFullPhases('unknown')).toEqual([]);
  });
});

// ============================================================
// filterPhases
// ============================================================

describe('filterPhases', () => {
  it('LL з 1 групою: тільки qualifying_1, без race_*_group_2/3', () => {
    const filtered = filterPhases(buildFullPhases('light_league'), 1, 'light_league');
    expect(filtered).toContain('qualifying_1');
    expect(filtered).not.toContain('qualifying_2');
    expect(filtered).not.toContain('race_1_group_2');
    expect(filtered).not.toContain('race_1_group_3');
    expect(filtered).toContain('race_1_group_1');
    expect(filtered).toContain('race_2_group_1');
  });

  it('LL з 2 групами: дропає group_3 і qualifying_3/4', () => {
    const filtered = filterPhases(buildFullPhases('light_league'), 2, 'light_league');
    expect(filtered).toContain('qualifying_1');
    expect(filtered).toContain('qualifying_2');
    expect(filtered).not.toContain('qualifying_3');
    expect(filtered).not.toContain('race_1_group_3');
    expect(filtered).toContain('race_1_group_2');
  });

  it('LL з 3 групами: 4-та квала фільтрується (parseInt(4)>3), решта залишається', () => {
    const filtered = filterPhases(buildFullPhases('light_league'), 3, 'light_league');
    // qualifying_1, _2, _3 + race_1×3 + race_2×3 = 9
    expect(filtered).toHaveLength(9);
    expect(filtered).toContain('qualifying_3');
    expect(filtered).not.toContain('qualifying_4');
    expect(filtered).toContain('race_1_group_3');
    expect(filtered).toContain('race_2_group_3');
  });

  it('LL з 3 race-групами + 4 квалі (qualiCount=4): quali_4 НЕ ріжеться, 10 фаз', () => {
    // Реальний кейс LL 19.05: 4 квалі-групи зливаються в 3 race-групи.
    // Без qualiCount quali_4 обрізалась би → 6-та гонка (race_2_group_1) не
    // влазила б у список фаз і не лінкувалась.
    const filtered = filterPhases(buildFullPhases('light_league'), 3, 'light_league', { qualiCount: 4 });
    expect(filtered).toHaveLength(10);
    expect(filtered).toContain('qualifying_4');
    // race-групи все одно обмежені 3 (group_4 не існує в шаблоні LL)
    expect(filtered).toContain('race_1_group_1');
    expect(filtered).toContain('race_2_group_1');
    expect(filtered.filter(p => p.startsWith('qualifying_'))).toHaveLength(4);
    expect(filtered.filter(p => p.includes('group_'))).toHaveLength(6);
  });

  it('qualiCount fallback на groupCount коли не переданий (стара поведінка)', () => {
    const a = filterPhases(buildFullPhases('light_league'), 3, 'light_league');
    const b = filterPhases(buildFullPhases('light_league'), 3, 'light_league', { qualiCount: null });
    expect(a).toEqual(b);
    expect(a).not.toContain('qualifying_4');
  });

  it('CL з 2 групами: 8 фаз (нічого не фільтрується)', () => {
    const filtered = filterPhases(buildFullPhases('champions_league'), 2, 'champions_league');
    expect(filtered).toHaveLength(8);
  });

  it('CL з 1 групою: тільки qualifying_1 + 3 race_*_group_1', () => {
    const filtered = filterPhases(buildFullPhases('champions_league'), 1, 'champions_league');
    expect(filtered).toEqual([
      'qualifying_1',
      'race_1_group_1',
      'race_2_group_1',
      'race_3_group_1',
    ]);
  });

  it('Sprint з 2 групами: дропає qualifying_*_group_3, race_*_group_3, final_group_3', () => {
    const filtered = filterPhases(buildFullPhases('sprint'), 2, 'sprint');
    expect(filtered).not.toContain('qualifying_1_group_3');
    expect(filtered).not.toContain('race_1_group_3');
    expect(filtered).not.toContain('final_group_3');
    expect(filtered).toContain('qualifying_1_group_2');
    expect(filtered).toContain('final_group_1');
  });

  it('Gonzales: обмежує round_N по gonzalesRoundCount', () => {
    const filtered = filterPhases(
      buildFullPhases('gonzales', { gonzalesRoundCount: 12 }),
      2,
      'gonzales',
      { gonzalesRoundCount: 5 }
    );
    const rounds = filtered.filter(p => p.startsWith('round_'));
    const rounds6plus = rounds.filter(p => parseInt(p.match(/round_(\d+)/)[1]) > 5);
    expect(rounds6plus).toHaveLength(0);
    expect(rounds).toHaveLength(5);
  });

  it('Gonzales з 1 групою: дропає qualifying_2, раунди залишаються (без груп)', () => {
    const filtered = filterPhases(buildFullPhases('gonzales'), 1, 'gonzales');
    expect(filtered).toContain('qualifying_1');
    expect(filtered).not.toContain('qualifying_2');
    expect(filtered).toContain('round_1');
    expect(filtered.filter(p => p.startsWith('round_'))).toHaveLength(12);
    expect(filtered.filter(p => p.includes('group_'))).toHaveLength(0);
  });

  it('Gonzales з 2 групами: 2 квали + 12 раундів = 14 фаз', () => {
    const filtered = filterPhases(buildFullPhases('gonzales'), 2, 'gonzales');
    expect(filtered).toContain('qualifying_1');
    expect(filtered).toContain('qualifying_2');
    expect(filtered.filter(p => p.startsWith('round_'))).toHaveLength(12);
    expect(filtered).toHaveLength(14);
  });

  it('groupCount=null для не-gonzales: повертає всі фази без змін', () => {
    const phases = buildFullPhases('light_league');
    expect(filterPhases(phases, null, 'light_league')).toEqual(phases);
    expect(filterPhases(phases, undefined, 'light_league')).toEqual(phases);
  });
});

// ============================================================
// findNextPhase
// ============================================================

describe('findNextPhase', () => {
  it('повертає першу фазу коли usedPhases пусте', () => {
    const phases = ['a', 'b', 'c'];
    expect(findNextPhase(phases, [])).toBe('a');
  });

  it('повертає наступну фазу після останньої використаної', () => {
    const phases = ['a', 'b', 'c', 'd'];
    expect(findNextPhase(phases, ['a', 'b'])).toBe('c');
  });

  it('повертає null коли всі фази використані', () => {
    const phases = ['a', 'b'];
    expect(findNextPhase(phases, ['a', 'b'])).toBe(null);
  });

  it('ігнорує usedPhases поза phases (custom phase id)', () => {
    const phases = ['a', 'b', 'c'];
    expect(findNextPhase(phases, ['x', 'y'])).toBe('a');
  });

  it('після непослідовно використаних фаз бере наступну після макс індексу', () => {
    const phases = ['a', 'b', 'c', 'd', 'e'];
    // Якщо used = ['a', 'c'] — це означає "пропустили b", беремо наступну після c
    expect(findNextPhase(phases, ['a', 'c'])).toBe('d');
  });
});

// ============================================================
// allPhasesFilled
// ============================================================

describe('allPhasesFilled', () => {
  it('true коли всі фази серед usedPhases', () => {
    expect(allPhasesFilled(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
    expect(allPhasesFilled(['a', 'b'], new Set(['b', 'a']))).toBe(true);
  });

  it('false коли хоча б одна не used', () => {
    expect(allPhasesFilled(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
  });

  it('false коли phases пусте', () => {
    expect(allPhasesFilled([], [])).toBe(false);
  });
});

// ============================================================
// isKartName / isGonzalesQualifying
// ============================================================

describe('isKartName', () => {
  it('matches "Карт N"', () => {
    expect(isKartName('Карт 1')).toBe(true);
    expect(isKartName('Карт 12')).toBe(true);
    expect(isKartName('  Карт 5  ')).toBe(true);
  });

  it('case-insensitive', () => {
    expect(isKartName('карт 5')).toBe(true);
    expect(isKartName('КАРТ 5')).toBe(true);
  });

  it('rejects real names', () => {
    expect(isKartName('Іванов')).toBe(false);
    expect(isKartName('Карт')).toBe(false); // без числа
    expect(isKartName('Karting Pro')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(isKartName(null)).toBe(false);
    expect(isKartName(undefined)).toBe(false);
    expect(isKartName('')).toBe(false);
  });
});

describe('isGonzalesQualifying (mirrors storage.js: isRealNames || isHighLapCount)', () => {
  it('реальні імена → треба інкрементити (qualifying branch)', () => {
    expect(isGonzalesQualifying(['Іванов', 'Петров', 'Сидоров'], new Map(), false)).toBe(true);
  });

  it('"Карт N" імена + не finished + без високих кіл → round branch', () => {
    expect(isGonzalesQualifying(['Карт 1', 'Карт 2', 'Карт 3'], new Map(), false)).toBe(false);
  });

  it('mixed: 60% реальних → qualifying branch', () => {
    expect(isGonzalesQualifying(['Іванов', 'Петров', 'Сидоров', 'Карт 1', 'Карт 2'], new Map(), false)).toBe(true);
  });

  it('mixed: 40% реальних, без високих кіл → round branch', () => {
    expect(isGonzalesQualifying(['Іванов', 'Петров', 'Карт 1', 'Карт 2', 'Карт 3'], new Map(), false)).toBe(false);
  });

  it('"Карт N" + isFinished + maxLaps>=5 → qualifying branch (за поточним кодом)', () => {
    const counts = new Map([['Карт 1', 5], ['Карт 2', 6]]);
    expect(isGonzalesQualifying(['Карт 1', 'Карт 2'], counts, true)).toBe(true);
  });

  it('"Карт N" + НЕ finished + 10 кіл (але finished=false) → round branch', () => {
    expect(isGonzalesQualifying(['Карт 1', 'Карт 2'], new Map([['Карт 1', 10]]), false)).toBe(false);
  });

  it('"Карт N" + isFinished + maxLaps<5 → round branch', () => {
    expect(isGonzalesQualifying(['Карт 1'], new Map([['Карт 1', 4]]), true)).toBe(false);
  });

  it('Реальні імена + високі lapCounts → qualifying', () => {
    expect(isGonzalesQualifying(['Іванов'], new Map([['Іванов', 10]]), true)).toBe(true);
  });

  it('plain object lapCounts: "Карт 1" + 6 кіл + finished → qualifying branch', () => {
    expect(isGonzalesQualifying(['Карт 1'], { 'Карт 1': 6 }, true)).toBe(true);
  });

  it('пустий список пілотів', () => {
    expect(isGonzalesQualifying([], new Map(), false)).toBe(false);
  });
});

// ============================================================
// detectGroupCountFromOverlap
// ============================================================

describe('detectGroupCountFromOverlap', () => {
  it('overlap ≥50% → це гонка, groupCount = qualiCount', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A', 'B', 'C', 'D']),
      newPilots: new Set(['A', 'B', 'C']),
      qualifyingCount: 2,
      format: 'light_league',
    });
    expect(result).toEqual({ groupCount: 2, action: 'race' });
  });

  it('overlap <50% → це нова квала, action=qualifying', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A', 'B', 'C']),
      newPilots: new Set(['X', 'Y', 'Z']),
      qualifyingCount: 1,
      format: 'light_league',
    });
    expect(result).toEqual({ groupCount: null, action: 'qualifying' });
  });

  it('overlap=50% boundary → це гонка (>= 0.5)', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A', 'B']),
      newPilots: new Set(['A', 'X']),
      qualifyingCount: 1,
      format: 'light_league',
    });
    expect(result.action).toBe('race');
    expect(result.groupCount).toBe(1);
  });

  it('LL з 4 квалями → groupCount обмежується 3 (FORMAT_MAX)', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A', 'B']),
      newPilots: new Set(['A', 'B']),
      qualifyingCount: 4,
      format: 'light_league',
    });
    expect(result.groupCount).toBe(3);
  });

  it('CL з 3 квалями → groupCount обмежується 2', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A', 'B']),
      newPilots: new Set(['A', 'B']),
      qualifyingCount: 3,
      format: 'champions_league',
    });
    expect(result.groupCount).toBe(2);
  });

  it('повертає unknown коли cumulative пусте', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(),
      newPilots: new Set(['A']),
      qualifyingCount: 0,
      format: 'light_league',
    });
    expect(result.action).toBe('unknown');
  });

  it('повертає unknown коли newPilots пусте', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: new Set(['A']),
      newPilots: new Set(),
      qualifyingCount: 1,
      format: 'light_league',
    });
    expect(result.action).toBe('unknown');
  });

  it('approves array input замість Set', () => {
    const result = detectGroupCountFromOverlap({
      cumulativeQualifyingPilots: ['A', 'B'],
      newPilots: ['A', 'B'],
      qualifyingCount: 2,
      format: 'light_league',
    });
    expect(result.action).toBe('race');
  });

  it('кастомний threshold', () => {
    const args = {
      cumulativeQualifyingPilots: new Set(['A', 'B', 'C']),
      newPilots: new Set(['A', 'X', 'Y']), // overlap = 1/3 ≈ 0.33
      qualifyingCount: 1,
      format: 'light_league',
    };
    expect(detectGroupCountFromOverlap({ ...args, threshold: 0.5 }).action).toBe('qualifying');
    expect(detectGroupCountFromOverlap({ ...args, threshold: 0.3 }).action).toBe('race');
  });
});

// ============================================================
// capGroupCount
// ============================================================

describe('capGroupCount', () => {
  it('обмежує LL до 3', () => {
    expect(capGroupCount(5, 'light_league')).toBe(3);
    expect(capGroupCount(2, 'light_league')).toBe(2);
  });

  it('обмежує CL до 2', () => {
    expect(capGroupCount(5, 'champions_league')).toBe(2);
  });

  it('мінімум 1', () => {
    expect(capGroupCount(0, 'light_league')).toBe(1);
    expect(capGroupCount(-5, 'light_league')).toBe(1);
  });

  it('default max 3 для невідомого формату', () => {
    expect(capGroupCount(10, 'unknown')).toBe(3);
  });
});

// ============================================================
// Schedule + time-window helpers
// ============================================================

// Helpers to build timestamps in Kyiv time (UTC+3) for tests
// `Date.UTC(year, month-1, day, hour, minute) - offset_ms` gives unix-ms that,
// when shifted by +3h, lands exactly at the requested Kyiv time.
function kyivTs(year, month, day, hour = 0, minute = 0) {
  return Date.UTC(year, month - 1, day, hour - 3, minute);
}

describe('COMPETITION_SCHEDULE constants', () => {
  it('Пн → gonzales, Вт → light_league, Ср → champions_league', () => {
    expect(COMPETITION_SCHEDULE[1].format).toBe('gonzales');
    expect(COMPETITION_SCHEDULE[2].format).toBe('light_league');
    expect(COMPETITION_SCHEDULE[3].format).toBe('champions_league');
  });

  it('у subота/неділя/чт/пт нічого не заплановано', () => {
    expect(COMPETITION_SCHEDULE[0]).toBeUndefined();
    expect(COMPETITION_SCHEDULE[4]).toBeUndefined();
    expect(COMPETITION_SCHEDULE[5]).toBeUndefined();
    expect(COMPETITION_SCHEDULE[6]).toBeUndefined();
  });

  it('старт о 19:45 Kyiv', () => {
    expect(COMPETITION_AUTO_START_HOUR_KYIV).toBe(19);
    expect(COMPETITION_AUTO_START_MIN_KYIV).toBe(45);
  });
});

describe('getKyivLocalParts', () => {
  it('правильно конвертує UTC timestamp у Kyiv tz', () => {
    // 2026-06-03 12:00 UTC = 2026-06-03 15:00 Kyiv (середа)
    const ts = Date.UTC(2026, 5, 3, 12, 0);
    expect(getKyivLocalParts(ts)).toEqual({
      year: 2026, month: 6, day: 3, hour: 15, minute: 0, dayOfWeek: 3,
    });
  });

  it('перехід через північ Kyiv (23:30 UTC = 02:30 Kyiv наступного дня)', () => {
    const ts = Date.UTC(2026, 5, 3, 23, 30); // 23:30 UTC Wed
    const parts = getKyivLocalParts(ts);
    expect(parts.day).toBe(4);     // Thursday
    expect(parts.hour).toBe(2);
    expect(parts.minute).toBe(30);
    expect(parts.dayOfWeek).toBe(4);
  });
});

describe('getScheduledFormat', () => {
  it('Понеділок 19:00 Kyiv → gonzales', () => {
    expect(getScheduledFormat(kyivTs(2026, 6, 1, 19, 0))).toBe('gonzales');
  });

  it('Вівторок 20:30 Kyiv → light_league', () => {
    expect(getScheduledFormat(kyivTs(2026, 6, 2, 20, 30))).toBe('light_league');
  });

  it('Середа 19:55 Kyiv → champions_league', () => {
    expect(getScheduledFormat(kyivTs(2026, 6, 3, 19, 55))).toBe('champions_league');
  });

  it('П\'ятниця → null', () => {
    expect(getScheduledFormat(kyivTs(2026, 6, 5, 20, 0))).toBe(null);
  });

  it('Субота → null (Sprint manual only)', () => {
    expect(getScheduledFormat(kyivTs(2026, 6, 6, 10, 0))).toBe(null);
  });

  it('Неділя → null', () => {
    expect(getScheduledFormat(kyivTs(2026, 6, 7, 14, 0))).toBe(null);
  });
});

describe('isCompetitionTime', () => {
  it('Понеділок 20:05 Kyiv → true (Гонзалес старт)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 1, 20, 5))).toBe(true);
  });

  it('Понеділок 20:04 → false (Гонзалес ще не почався)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 1, 20, 4))).toBe(false);
  });

  it('Понеділок 19:45 → false (Гонзалес о 20:05, не 19:45)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 1, 19, 45))).toBe(false);
  });

  it('Вівторок 19:45 Kyiv → true (ЛЛ)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 2, 19, 45))).toBe(true);
  });

  it('Вівторок 19:40 → true (ЛЛ поріг зсунуто на 19:40 — перша квала інколи о 19:40)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 2, 19, 40))).toBe(true);
  });

  it('Вівторок 19:39 → false', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 2, 19, 39))).toBe(false);
  });

  it('Понеділок 18:00 → false (зарано)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 1, 18, 0))).toBe(false);
  });

  it('Понеділок 23:59 → true (вечір змагання)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 1, 23, 59))).toBe(true);
  });

  it('Вівторок 21:05 → true (outlier від 24.03 — перевіряємо що покривається)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 2, 21, 5))).toBe(true);
  });

  it('Четвер 20:00 → false (нема в розкладі)', () => {
    expect(isCompetitionTime(kyivTs(2026, 6, 4, 20, 0))).toBe(false);
  });

  it('Понеділок 00:30 → false (наступного дня вже не Пн)', () => {
    // 00:30 Kyiv = 21:30 UTC попереднього дня — але dayOfWeek рахується по Kyiv
    // 2026-06-02 00:30 Kyiv = Tuesday — питаємо: Вт 00:30 → has schedule (LL),
    // але hour=0 < 19 → false
    expect(isCompetitionTime(kyivTs(2026, 6, 2, 0, 30))).toBe(false);
  });
});

describe('buildAutoCompetitionId', () => {
  it('використовує Kyiv-дату', () => {
    const ts = kyivTs(2026, 6, 1, 19, 30);
    const id = buildAutoCompetitionId('gonzales', ts);
    expect(id).toMatch(/^gonzales-2026-06-01-[0-9a-z]+$/);
  });

  it('розрізняє різні timestamps', () => {
    const a = buildAutoCompetitionId('light_league', kyivTs(2026, 6, 2, 19, 30));
    const b = buildAutoCompetitionId('light_league', kyivTs(2026, 6, 2, 19, 31));
    expect(a).not.toBe(b);
  });

  it('пізно ввечері Kyiv — date уже наступного дня UTC', () => {
    // 2026-06-01 23:00 Kyiv = 2026-06-01 20:00 UTC, але дата лишається 06-01
    const ts = kyivTs(2026, 6, 1, 23, 0);
    expect(buildAutoCompetitionId('gonzales', ts)).toMatch(/^gonzales-2026-06-01-/);
  });
});

describe('buildAutoCompetitionName', () => {
  it('Гонзалес з shortName', () => {
    const ts = kyivTs(2026, 6, 1, 20, 15);
    expect(buildAutoCompetitionName('gonzales', ts, 7)).toBe('Гонз, 01.06.26, Тр. 7');
  });

  it('Лайт Ліга', () => {
    const ts = kyivTs(2026, 6, 2, 19, 50);
    expect(buildAutoCompetitionName('light_league', ts, '5R')).toBe('ЛЛ, 02.06.26, Тр. 5R');
  });

  it('Ліга Чемпіонів', () => {
    const ts = kyivTs(2026, 6, 3, 20, 5);
    expect(buildAutoCompetitionName('champions_league', ts, 1)).toBe('ЛЧ, 03.06.26, Тр. 1');
  });

  it('formatfallback для дня поза розкладом → format (не shortName)', () => {
    // Subota — нема в розкладі, нехай використовує format в fallback
    const ts = kyivTs(2026, 6, 6, 10, 0);
    expect(buildAutoCompetitionName('sprint', ts, 1)).toBe('sprint, 06.06.26, Тр. 1');
  });
});

describe('getKyivIsoDate', () => {
  it('повертає Kyiv-локальну дату', () => {
    expect(getKyivIsoDate(kyivTs(2026, 6, 1, 20, 0))).toBe('2026-06-01');
    expect(getKyivIsoDate(kyivTs(2026, 12, 31, 23, 59))).toBe('2026-12-31');
  });

  it('пізно UTC але рано Kyiv — використовує Kyiv-дату', () => {
    // 21:00 UTC Wed = 00:00 Kyiv Thu
    const ts = Date.UTC(2026, 5, 3, 21, 0);
    expect(getKyivIsoDate(ts)).toBe('2026-06-04');
  });
});
