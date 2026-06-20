/**
 * Резолв реального пілота для кіл із заїздів Гонзалеса.
 *
 * У Гонзалесі timing часто записує пілота як "Карт N" (бо учасник не залогінений
 * під іменем). Реального пілота можна відновити з конфігу змагання:
 * стартовий слот пілота (`pilotStartSlots`) + ротація картів по раундах визначають,
 * на якому карті був кожен пілот у кожному раунді.
 *
 * Будуємо мапу `(session_id, kart) → pilot` для всіх round-сесій змагання.
 */

import { buildGonzalesRotation, getGonzalesKartForRound } from '../data/competitions';

export interface GonzalesResolverConfig {
  /** pilot → стартовий слот (0-based індекс у ротаційному списку). */
  pilotStartSlots?: Record<string, number>;
  /** Кастомний порядок слотів (kart або null для пропуску). */
  slotOrder?: (number | null)[];
  /** Явний список картів (інакше — з даних). */
  kartList?: number[];
}

export interface GonzalesRoundSession {
  sessionId: string;
  /** Фаза `round_N` (1-based номер раунду в N). */
  phase: string | null;
}

/**
 * Будує мапу `${session_id}|${kart}` → real pilot для round-сесій Гонзалеса.
 *
 * @param roundSessions сесії з фазами round_N
 * @param config gonzalesConfig змагання
 * @param karts перелік картів (fallback якщо kartList порожній)
 * @param pilotCount кількість пілотів (для розрахунку пропусків у ротації)
 */
export function buildGonzalesKartPilotMap(
  roundSessions: GonzalesRoundSession[],
  config: GonzalesResolverConfig | undefined,
  karts: number[],
  pilotCount: number,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!config?.pilotStartSlots) return map;

  const effectiveKarts = config.kartList && config.kartList.length > 0 ? config.kartList : karts;
  if (effectiveKarts.length === 0) return map;

  const slots = buildGonzalesRotation(effectiveKarts, pilotCount, config.slotOrder);
  if (slots.length === 0) return map;

  for (const s of roundSessions) {
    const rm = s.phase?.match(/^round_(\d+)/);
    if (!rm) continue;
    const round0 = parseInt(rm[1]) - 1; // 0-based
    if (round0 < 0) continue;

    for (const [pilot, startSlot] of Object.entries(config.pilotStartSlots)) {
      const slot = getGonzalesKartForRound(slots, startSlot, round0);
      if (slot?.kart == null) continue;
      map.set(`${s.sessionId}|${slot.kart}`, pilot);
    }
  }

  return map;
}
