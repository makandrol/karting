/**
 * Storage utilities — pure helper functions used by storage.js.
 * Extracted from storage.js to keep main file focused on DB operations.
 */

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
 * Build kart statistics — top-5 fastest laps per pilot per kart.
 * Input: rows with { kart, pilot, lap_time, lap_sec, ts }.
 * Output: [{ kart, top5: [{pilot, lap_time, lap_sec, ts}, ...] }]
 */
export function buildKartStats(rows) {
  const byKart = new Map();
  for (const r of rows) {
    if (!byKart.has(r.kart)) byKart.set(r.kart, new Map());
    const pilots = byKart.get(r.kart);
    if (!pilots.has(r.pilot) || r.lap_sec < pilots.get(r.pilot).lap_sec) {
      pilots.set(r.pilot, { pilot: r.pilot, lap_time: r.lap_time, lap_sec: r.lap_sec, ts: r.ts || null });
    }
  }
  const result = [];
  for (const [kart, pilots] of byKart) {
    const top5 = [...pilots.values()].sort((a, b) => a.lap_sec - b.lap_sec).slice(0, 5);
    result.push({ kart, top5 });
  }
  return result.sort((a, b) => a.kart - b.kart);
}
