/**
 * Storage utilities — pure helper functions used by storage.js.
 * Extracted from storage.js to keep main file focused on DB operations.
 */

/** Matches "Карт 1", "Карт 12", "карт 88" (case-insensitive). */
const KART_NAME_RE = /^Карт\s+\d+$/i;

/**
 * Remap "Карт N" pilots to real pilot names within the same (sessionId, kart).
 *
 * Картодром на табло на старті заїзду показує карти як "Карт N" поки оператор
 * не вписав ім'я. Перші 3-10 кіл записуються з pilot="Карт N", далі — реальне
 * ім'я. Це створює два "пілоти" в одній сесії на одному карті.
 *
 * Стратегія: групуємо лапи по (session_id, kart). Якщо у групі знайдено
 * РІВНО ОДНЕ реальне ім'я + хоча б один "Карт N" — замінюємо "Карт N" на
 * це реальне ім'я. Усе інше (тільки "Карт N", або 2+ реальних імен на
 * одному карті) — залишаємо без змін, щоб не ризикувати помилковим merge.
 *
 * @param {Array<{session_id?: string, kart: number, pilot: string}>} laps
 * @returns {Array} new array (input not mutated)
 */
export function remapKartNamesToPilots(laps) {
  if (!laps || laps.length === 0) return laps;

  // Build map (session_id, kart) -> set of pilots
  const groups = new Map();
  for (const lap of laps) {
    const key = `${lap.session_id ?? ''}|${lap.kart}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = { real: new Set(), kartNames: new Set() };
      groups.set(key, entry);
    }
    if (KART_NAME_RE.test((lap.pilot || '').trim())) {
      entry.kartNames.add(lap.pilot);
    } else {
      entry.real.add(lap.pilot);
    }
  }

  // Build remap table: (session_id, kart, kartName) -> realName
  const remap = new Map();
  for (const [key, entry] of groups) {
    if (entry.real.size === 1 && entry.kartNames.size > 0) {
      const realName = [...entry.real][0];
      for (const kartName of entry.kartNames) {
        remap.set(`${key}|${kartName}`, realName);
      }
    }
  }

  if (remap.size === 0) return laps.map(lap => ({ ...lap, resolved_pilot: null }));

  return laps.map(lap => {
    const key = `${lap.session_id ?? ''}|${lap.kart}|${lap.pilot}`;
    const realName = remap.get(key);
    // Недеструктивно: `pilot` лишається raw (як у таймінгу), а знайдене
    // реальне ім'я кладемо в `resolved_pilot` (null якщо нічого не змінилось).
    return { ...lap, resolved_pilot: realName ?? null };
  });
}

export const MERGE_GAP_MS = 5 * 60 * 1000; // 5 minutes

/** Parse a row from competitions table — JSON-decode sessions/results. */
export function parseCompetitionRow(row) {
  let sessions = row.sessions ? JSON.parse(row.sessions) : [];
  // Migrate old format: ["session-123"] → [{sessionId: "session-123", phase: null}]
  if (sessions.length > 0 && typeof sessions[0] === 'string') {
    sessions = sessions.map(id => ({ sessionId: id, phase: null }));
  }
  return {
    ...row,
    sessions,
    results: row.results ? JSON.parse(row.results) : null,
    uploaded_results: row.uploaded_results ? JSON.parse(row.uploaded_results) : null,
    status: row.status || 'live',
  };
}

/** Parse lap time string like "42.574" or "1:02.222" → seconds. */
export function parseLapTimeSec(t) {
  if (!t) return null;
  const m = t.match(/^(\d+):(\d+\.\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseFloat(m[2]);
  const s = t.match(/^\d+\.\d+$/);
  if (s) return parseFloat(t);
  return null;
}

/**
 * Merge sessions with the same race_number within a 5-minute gap.
 * Timing API sometimes briefly drops, creating multiple DB sessions for one race.
 */
export function mergeSessions(sessions) {
  if (sessions.length <= 1) return sessions;

  const result = [];
  const used = new Set();

  for (let i = 0; i < sessions.length; i++) {
    if (used.has(i)) continue;
    const current = { ...sessions[i], _merged_ids: [sessions[i].id] };
    used.add(i);

    if (current.race_number !== null) {
      for (let j = i + 1; j < sessions.length; j++) {
        if (used.has(j)) continue;
        const s = sessions[j];
        if (s.race_number !== current.race_number) continue;
        const currentEnd = current.end_time || s.start_time;
        const gap = s.start_time - currentEnd;
        if (gap < 0 || gap >= MERGE_GAP_MS) continue;

        current.end_time = s.end_time || current.end_time;
        current.pilot_count = Math.max(current.pilot_count || 0, s.pilot_count || 0);
        if (s.real_pilot_count) {
          current.real_pilot_count = Math.max(current.real_pilot_count || 0, s.real_pilot_count);
          current.pilot_count = current.real_pilot_count;
        }
        if (s.best_lap_time && s.best_lap_pilot) {
          const curSec = parseLapTimeSec(current.best_lap_time);
          const newSec = parseLapTimeSec(s.best_lap_time);
          if (newSec !== null && (curSec === null || newSec < curSec)) {
            current.best_lap_time = s.best_lap_time;
            current.best_lap_pilot = s.best_lap_pilot;
            current.best_lap_kart = s.best_lap_kart;
          }
        }
        current._merged_ids.push(s.id);
        used.add(j);
      }
    }

    // Fix stuck live: if no end_time but there's a next session after, close it
    if (!current.end_time) {
      const nextIdx = sessions.findIndex((s, idx) => idx > i && !used.has(idx));
      if (nextIdx >= 0) {
        current.end_time = current.start_time;
      }
    }

    result.push(current);
  }

  result.sort((a, b) => a.start_time - b.start_time);

  return result.map(s => {
    const merged = s._merged_ids;
    delete s._merged_ids;
    if (merged.length > 1) s.merged_session_ids = merged;
    return s;
  });
}

/**
 * Build kart statistics — найкраще коло кожного пілота на цьому карті,
 * відсортовано за швидкістю, до 10 пілотів (поле `top5` — історична назва).
 *
 * Для кожного пілота:
 *  - lap_time/lap_sec + s1/s2 — найшвидше реальне коло та його сектори
 *  - tb_s1/tb_s2/tb_sec — theoretical best (найкращий S1 + найкращий S2 окремо)
 *
 * Input: rows with { session_id, kart, pilot, lap_time, s1, s2, lap_sec, ts }.
 * @param {Iterable<string>} [excludedLaps] keys "sessionId|pilot|ts" to skip
 * Output: [{ kart, top5: [{pilot, lap_time, lap_sec, s1, s2, tb_s1, tb_s2, tb_sec, ts}, ...] }]
 */
export function buildKartStats(rows, excludedLaps, editedLaps) {
  const excluded = excludedLaps instanceof Set ? excludedLaps : new Set(excludedLaps || []);
  const edited = editedLaps instanceof Map ? editedLaps : new Map(Object.entries(editedLaps || {}));
  const byKart = new Map();
  for (const r of rows) {
    if (excluded.size > 0 && r.session_id != null && r.ts != null
        && excluded.has(`${r.session_id}|${r.pilot}|${r.ts}`)) continue;
    // Відредаговане коло: підміняємо час і перераховуємо lap_sec. Якщо
    // редагування зробило коло невалідним (<38с або непарситься) — пропускаємо.
    if (edited.size > 0 && r.session_id != null && r.ts != null) {
      const edit = edited.get(`${r.session_id}|${r.pilot}|${r.ts}`);
      if (edit) {
        const sec = parseLapTimeSec(edit.lapTime);
        if (sec === null || sec < 38) continue;
        r.lap_time = edit.lapTime;
        r.lap_sec = sec;
      }
    }
    if (!byKart.has(r.kart)) byKart.set(r.kart, new Map());
    const pilots = byKart.get(r.kart);
    // Агрегуємо за канонічним іменем (resolved_pilot ?? pilot), щоб лапи
    // "Карт 5" і "Іванов" на одному карті злились у одного пілота.
    const canonical = r.resolved_pilot ?? r.pilot;
    let agg = pilots.get(canonical);
    if (!agg) {
      agg = {
        pilot: r.pilot, resolved_pilot: r.resolved_pilot ?? null,
        lap_time: null, lap_sec: Infinity, s1: null, s2: null, ts: null, session_id: null,
        bestS1: null, bestS1Sec: Infinity, bestS2: null, bestS2Sec: Infinity,
      };
      pilots.set(canonical, agg);
    }
    // Найшвидше коло (+ його сектори) — запам'ятовуємо raw pilot саме цього кола
    if (r.lap_sec != null && r.lap_sec < agg.lap_sec) {
      agg.lap_sec = r.lap_sec;
      agg.lap_time = r.lap_time;
      agg.s1 = r.s1 || null;
      agg.s2 = r.s2 || null;
      agg.ts = r.ts || null;
      agg.session_id = r.session_id ?? null;
      agg.pilot = r.pilot;
      agg.resolved_pilot = r.resolved_pilot ?? null;
    }
    // Найкращі сектори окремо → theoretical best
    const s1sec = parseLapTimeSec(r.s1);
    if (s1sec !== null && s1sec < agg.bestS1Sec) { agg.bestS1Sec = s1sec; agg.bestS1 = r.s1; }
    const s2sec = parseLapTimeSec(r.s2);
    if (s2sec !== null && s2sec < agg.bestS2Sec) { agg.bestS2Sec = s2sec; agg.bestS2 = r.s2; }
  }
  const result = [];
  for (const [kart, pilots] of byKart) {
    const top5 = [...pilots.values()]
      .map(a => {
        const hasTB = a.bestS1Sec < Infinity && a.bestS2Sec < Infinity;
        return {
          pilot: a.pilot,
          resolved_pilot: a.resolved_pilot,
          lap_time: a.lap_time,
          lap_sec: a.lap_sec === Infinity ? null : a.lap_sec,
          s1: a.s1,
          s2: a.s2,
          ts: a.ts,
          session_id: a.session_id,
          tb_s1: a.bestS1,
          tb_s2: a.bestS2,
          tb_sec: hasTB ? a.bestS1Sec + a.bestS2Sec : null,
        };
      })
      .sort((a, b) => (a.lap_sec ?? Infinity) - (b.lap_sec ?? Infinity))
      .slice(0, 10);
    result.push({ kart, top5 });
  }
  return result.sort((a, b) => a.kart - b.kart);
}
