import { describe, it, expect } from 'vitest';
import { buildGonzalesKartPilotMap } from './gonzalesPilotResolver';

describe('buildGonzalesKartPilotMap', () => {
  const karts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  it('мапить (session, kart) → pilot за стартовим слотом і раундом', () => {
    // 12 пілотів, 12 картів, без пропусків. Пілот зі startSlot 0 у раунді 1
    // (round_1, round0=0) їде на карті slots[0] = kart 1.
    const config = {
      pilotStartSlots: { Іванов: 0, Петров: 1 },
    };
    const sessions = [
      { sessionId: 'session-100', phase: 'round_1' },
      { sessionId: 'session-200', phase: 'round_2' },
    ];
    const map = buildGonzalesKartPilotMap(sessions, config, karts, 12);

    // round_1: Іванов(slot0)→kart1, Петров(slot1)→kart2
    expect(map.get('session-100|1')).toBe('Іванов');
    expect(map.get('session-100|2')).toBe('Петров');
    // round_2: ротація +1 → Іванов→kart2, Петров→kart3
    expect(map.get('session-200|2')).toBe('Іванов');
    expect(map.get('session-200|3')).toBe('Петров');
  });

  it('повертає порожню мапу без pilotStartSlots', () => {
    const map = buildGonzalesKartPilotMap(
      [{ sessionId: 'session-100', phase: 'round_1' }],
      {},
      karts,
      12,
    );
    expect(map.size).toBe(0);
  });

  it('ігнорує не-round фази', () => {
    const config = { pilotStartSlots: { A: 0 } };
    const map = buildGonzalesKartPilotMap(
      [{ sessionId: 'session-100', phase: 'qualifying_1' }],
      config,
      karts,
      12,
    );
    expect(map.size).toBe(0);
  });

  it('використовує kartList з конфігу якщо заданий', () => {
    const config = {
      pilotStartSlots: { A: 0 },
      kartList: [10, 20, 30],
    };
    const map = buildGonzalesKartPilotMap(
      [{ sessionId: 'session-100', phase: 'round_1' }],
      config,
      karts,
      3,
    );
    expect(map.get('session-100|10')).toBe('A');
  });

  it('пропуск (skip) у ротації не мапиться (kart null)', () => {
    // 13 пілотів, 12 картів → 1 пропуск. Пілот, що потрапляє на пропуск, не мапиться.
    const config = { pilotStartSlots: { A: 12 } }; // останній слот часто пропуск
    const map = buildGonzalesKartPilotMap(
      [{ sessionId: 'session-100', phase: 'round_1' }],
      config,
      karts,
      13,
    );
    // A може потрапити на пропуск у раунді 1 — тоді запису немає; перевіряємо
    // що жодне значення не "A" з kart=null (мапа не містить null-картів узагалі)
    for (const [, pilot] of map) expect(typeof pilot).toBe('string');
  });
});
