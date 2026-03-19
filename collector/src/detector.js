/**
 * CompetitionDetector — автоматичне визначення змагань + ручне управління
 *
 * Логіка:
 * 1. Перевіряє день тижня + час → чи очікується змагання
 * 2. Слідкує за перервами в заїздах (зміна траси)
 * 3. Після перерви → позначає наступні заїзди як фази змагання
 * 4. Адмін може вручну запустити/зупинити/перевизначити
 */

import { COMPETITION_SCHEDULE, COMPETITION_STATES } from './schedule.js';
import { storage } from './storage.js';

export class CompetitionDetector {
  #state = COMPETITION_STATES.NONE;
  #activeCompetition = null; // { format, name, startTime, phases: [], manualMode: false }
  #lastSessionEnd = null;
  #todayOverride = false; // true = ручний режим на сьогодні

  constructor() {
    const saved = storage.getSystemState('active_competition');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const savedDate = data.competition?.startTime
          ? new Date(data.competition.startTime).toISOString().split('T')[0]
          : null;
        const today = new Date().toISOString().split('T')[0];

        if (savedDate === today) {
          this.#activeCompetition = data.competition;
          this.#state = data.state;
          this.#todayOverride = data.todayOverride || false;
        } else {
          storage.setSystemState('active_competition', '');
        }
      } catch {}
    }
  }

  getState() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const scheduled = COMPETITION_SCHEDULE[dayOfWeek];

    return {
      state: this.#state,
      competition: this.#activeCompetition,
      todayOverride: this.#todayOverride,
      scheduled: scheduled ? {
        format: scheduled.format,
        name: scheduled.name,
        startTime: scheduled.startTime,
      } : null,
    };
  }

  /**
   * Викликається коли починається/закінчується сесія.
   * Аналізує патерн для авто-визначення.
   */
  onSessionStart(sessionId, pilotCount, now = Date.now()) {
    if (this.#todayOverride) return; // ручний режим

    const date = new Date(now);
    const dayOfWeek = date.getDay();
    const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const scheduled = COMPETITION_SCHEDULE[dayOfWeek];

    if (!scheduled) return;
    if (this.#state === COMPETITION_STATES.FINISHED) return;

    // Перевірити чи є перерва перед цією сесією
    const pauseDuration = this.#lastSessionEnd ? (now - this.#lastSessionEnd) / 60000 : 0;

    // Чи в вікні очікуваного часу?
    const inWindow = timeStr >= scheduled.detectWindow.from && timeStr <= scheduled.detectWindow.to;

    if (inWindow && this.#state === COMPETITION_STATES.NONE) {
      // Можливо починається тренування
      console.log(`🏁 Competition possible: ${scheduled.name} (${timeStr})`);
      this.#state = COMPETITION_STATES.WARMUP;
      this.#activeCompetition = {
        format: scheduled.format,
        name: scheduled.name,
        startTime: now,
        phases: [],
        manualMode: false,
        sessionIds: [sessionId],
      };
      this.#persist();
    } else if (this.#state === COMPETITION_STATES.WARMUP && pauseDuration >= (scheduled.pattern.pause?.minDurationMin || 3)) {
      // Після перерви → це вже кваліфікація або перший раунд
      console.log(`🏁 Competition STARTED: ${scheduled.name} (pause was ${pauseDuration.toFixed(1)} min)`);
      if (scheduled.format === 'gonzales') {
        this.#state = COMPETITION_STATES.RACE;
        this.#addPhase('gonzales_round', 'Раунд 1', sessionId);
      } else {
        this.#state = COMPETITION_STATES.QUALIFYING;
        this.#addPhase('qualifying', 'Квала', sessionId);
      }
      this.#persist();
    } else if (this.#activeCompetition) {
      // Додати сесію до активного змагання
      this.#activeCompetition.sessionIds.push(sessionId);
      this.#autoAdvancePhase(pauseDuration, scheduled);
      this.#persist();
    }
  }

  onSessionEnd(sessionId, now = Date.now()) {
    this.#lastSessionEnd = now;
  }

  #autoAdvancePhase(pauseMinutes, scheduled) {
    const phases = this.#activeCompetition?.phases || [];
    const lastPhase = phases[phases.length - 1];

    if (!lastPhase) return;

    if (scheduled.format === 'gonzales') {
      // Кожна нова сесія — наступний раунд
      const roundNum = phases.length + 1;
      if (roundNum <= (scheduled.pattern.rounds?.max || 24)) {
        this.#addPhase('gonzales_round', `Раунд ${roundNum}`, null);
      }
    } else if (pauseMinutes >= 2) {
      // Після перерви → наступна фаза
      const racePhases = phases.filter(p => p.type === 'race');
      const maxRaces = scheduled.pattern.races || 2;

      if (lastPhase.type === 'qualifying' && racePhases.length < maxRaces) {
        this.#addPhase('race', `Гонка ${racePhases.length + 1}`, null);
        this.#state = COMPETITION_STATES.RACE;
      } else if (lastPhase.type === 'race' && racePhases.length < maxRaces) {
        this.#addPhase('race', `Гонка ${racePhases.length + 1}`, null);
      } else {
        this.#state = COMPETITION_STATES.FINISHED;
        console.log(`🏁 Competition FINISHED: ${this.#activeCompetition.name}`);
      }
    }
  }

  #addPhase(type, name, sessionId) {
    if (!this.#activeCompetition) return;
    this.#activeCompetition.phases.push({
      type, name, sessionId,
      startTime: Date.now(),
    });
  }

  // ============================================================
  // Manual controls (API)
  // ============================================================

  /** Вручну запустити змагання */
  manualStart(format, name) {
    this.#todayOverride = true;
    this.#state = COMPETITION_STATES.MANUAL;
    this.#activeCompetition = {
      format, name,
      startTime: Date.now(),
      phases: [],
      manualMode: true,
      sessionIds: [],
    };
    this.#persist();
    console.log(`🏁 Manual competition started: ${name}`);
  }

  /** Вручну зупинити змагання */
  manualStop() {
    this.#state = COMPETITION_STATES.FINISHED;
    this.#persist();
    console.log('🏁 Competition manually stopped');
  }

  /** Відмітити поточну сесію як конкретну фазу */
  markPhase(sessionId, type, name) {
    if (!this.#activeCompetition) {
      // Створити змагання якщо немає
      const date = new Date();
      const scheduled = COMPETITION_SCHEDULE[date.getDay()];
      this.manualStart(scheduled?.format || 'unknown', scheduled?.name || 'Змагання');
    }
    this.#addPhase(type, name, sessionId);
    this.#state = type === 'qualifying' ? COMPETITION_STATES.QUALIFYING : COMPETITION_STATES.RACE;
    this.#persist();
    console.log(`🏁 Phase marked: ${name} (${type})`);
  }

  /** Скинути автовизначення на сьогодні */
  resetToday() {
    this.#state = COMPETITION_STATES.NONE;
    this.#activeCompetition = null;
    this.#todayOverride = false;
    this.#lastSessionEnd = null;
    this.#persist();
    console.log('🏁 Competition detection reset');
  }

  #persist() {
    storage.setSystemState('active_competition', JSON.stringify({
      state: this.#state,
      competition: this.#activeCompetition,
      todayOverride: this.#todayOverride,
    }));
  }
}
