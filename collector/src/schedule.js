/**
 * Розклад змагань картодрому "Жага швидкості"
 *
 * Автоматичне визначення базується на:
 * 1. День тижня + час
 * 2. Значна перерва (зміна траси, розподіл по картах)
 * 3. Патерн заїздів після перерви
 */

export const COMPETITION_SCHEDULE = {
  // 0 = неділя, 1 = понеділок, ..., 6 = субота
  1: { // Понеділок
    format: 'gonzales',
    name: 'Гонзалес',
    startTime: '20:00',
    detectWindow: { from: '19:30', to: '20:30' }, // шукати перерву в цьому вікні
    pattern: {
      warmup: { minSessions: 1, maxSessions: 2, durationMin: 5 },
      pause: { minDurationMin: 3, maxDurationMin: 15 }, // перерва для зміни траси
      rounds: { min: 12, max: 24 }, // к-сть заїздів = к-сть пілотів
      lapsPerRound: 2, // 2 залікових кола (+ можливе розігрівочне)
    },
  },
  2: { // Вівторок
    format: 'light_league',
    name: 'Лайт Ліга',
    startTime: '19:30',
    detectWindow: { from: '19:00', to: '20:00' },
    pattern: {
      qualifying: { sessions: 1 },
      pause: { minDurationMin: 3, maxDurationMin: 15 },
      races: 2,
    },
  },
  3: { // Середа
    format: 'champions_league',
    name: 'Ліга Чемпіонів',
    startTime: '20:00',
    detectWindow: { from: '19:30', to: '20:30' },
    pattern: {
      qualifying: { sessions: 1 },
      pause: { minDurationMin: 3, maxDurationMin: 15 },
      races: 3,
    },
  },
};

/**
 * Стан активного змагання
 */
export const COMPETITION_STATES = {
  NONE: 'none',           // Немає змагання
  DETECTED: 'detected',   // Автоматично визначено початок
  WARMUP: 'warmup',       // Тренувальні заїзди
  QUALIFYING: 'qualifying', // Кваліфікація
  PAUSE: 'pause',         // Перерва між фазами
  RACE: 'race',           // Гонка
  FINISHED: 'finished',   // Завершено
  MANUAL: 'manual',       // Запущено вручну
};
