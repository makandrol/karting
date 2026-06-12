import { describe, it, expect } from 'vitest';
import {
  parseTime,
  toSeconds,
  toHundredths,
  getTimeColor,
  shortName,
  fmtBytes,
  mergePilotNames,
  isKartName,
  isValidSession,
  loadWithExpiry,
  saveWithExpiry,
} from './timing';

// ============================================================
// parseTime
// ============================================================

describe('parseTime', () => {
  it('parses simple seconds', () => {
    expect(parseTime('42.574')).toBe(42.574);
    expect(parseTime('39.800')).toBe(39.8);
  });

  it('parses minutes:seconds', () => {
    expect(parseTime('1:02.222')).toBeCloseTo(62.222, 3);
    expect(parseTime('2:00.000')).toBeCloseTo(120.0, 3);
  });

  it('returns null for invalid', () => {
    expect(parseTime(null)).toBe(null);
    expect(parseTime('')).toBe(null);
    expect(parseTime('garbage')).toBe(null);
  });
});

// ============================================================
// toSeconds / toHundredths
// ============================================================

describe('toSeconds', () => {
  it('formats with 3 decimals', () => {
    expect(toSeconds('42.574')).toBe('42.574');
    expect(toSeconds('1:00.500')).toBe('60.500');
  });

  it('handles null', () => {
    expect(toSeconds(null)).toBe('—');
  });
});

describe('toHundredths', () => {
  it('formats with 2 decimals', () => {
    expect(toHundredths('18.080')).toBe('18.08');
    expect(toHundredths('27.123')).toBe('27.12');
  });

  it('handles null', () => {
    expect(toHundredths(null)).toBe('—');
  });
});

// ============================================================
// getTimeColor
// ============================================================

describe('getTimeColor', () => {
  it('returns purple for overall best', () => {
    expect(getTimeColor('40.000', '40.500', 40.0)).toBe('purple');
  });

  it('returns green for personal best', () => {
    expect(getTimeColor('40.500', '40.500', 39.0)).toBe('green');
  });

  it('returns yellow for slower than PB', () => {
    expect(getTimeColor('41.000', '40.500', 39.0)).toBe('yellow');
  });

  it('returns none for null', () => {
    expect(getTimeColor(null, '40.500', 39.0)).toBe('none');
  });

  it('returns green when no PB', () => {
    expect(getTimeColor('40.500', null, 39.0)).toBe('green');
  });
});

// ============================================================
// shortName
// ============================================================

describe('shortName', () => {
  it('preserves short names', () => {
    expect(shortName('Іван')).toBe('Іван');
    expect(shortName('Карт 1')).toBe('Карт 1');
  });

  it('shortens long full names', () => {
    expect(shortName('Апанасенко Олексій')).toBe('Апанасенко О.');
  });

  it('keeps Карт X format', () => {
    expect(shortName('Карт 12')).toBe('Карт 12');
  });
});

// ============================================================
// fmtBytes
// ============================================================

describe('fmtBytes', () => {
  it('formats bytes', () => {
    expect(fmtBytes(500)).toBe('500 B');
  });

  it('formats KB', () => {
    expect(fmtBytes(2048)).toBe('2.0 KB');
  });

  it('formats MB', () => {
    expect(fmtBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('formats GB', () => {
    expect(fmtBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});

// ============================================================
// mergePilotNames
// ============================================================

describe('mergePilotNames', () => {
  it('replaces "Карт X" with real pilot name on same kart', () => {
    const laps = [
      { pilot: 'Карт 5', kart: 5, lap_time: '42.0' },
      { pilot: 'Карт 5', kart: 5, lap_time: '41.5' },
      { pilot: 'Іванов І.', kart: 5, lap_time: '41.0' },
    ];
    const result = mergePilotNames(laps);
    expect(result[0].pilot).toBe('Іванов І.');
    expect(result[1].pilot).toBe('Іванов І.');
    expect(result[2].pilot).toBe('Іванов І.');
  });

  it('does not affect different karts', () => {
    const laps = [
      { pilot: 'Карт 5', kart: 5, lap_time: '42.0' },
      { pilot: 'Іванов І.', kart: 6, lap_time: '41.0' },
    ];
    const result = mergePilotNames(laps);
    expect(result[0].pilot).toBe('Карт 5'); // не змерджено, інший карт
    expect(result[1].pilot).toBe('Іванов І.');
  });

  it('handles empty input', () => {
    expect(mergePilotNames([])).toEqual([]);
  });
});

// ============================================================
// isKartName
// ============================================================

describe('isKartName', () => {
  it('matches "Карт N" placeholders', () => {
    expect(isKartName('Карт 1')).toBe(true);
    expect(isKartName('Карт 12')).toBe(true);
    expect(isKartName('  Карт 5  ')).toBe(true);
    expect(isKartName('карт 7')).toBe(true);
  });

  it('does not match real pilot names', () => {
    expect(isKartName('Іванов І.')).toBe(false);
    expect(isKartName('Апанасенко Олексій')).toBe(false);
    expect(isKartName('Карт')).toBe(false);
    expect(isKartName('Карт 5 Іванов')).toBe(false);
    expect(isKartName('')).toBe(false);
  });
});

// ============================================================
// isValidSession
// ============================================================

describe('isValidSession', () => {
  it('rejects session shorter than 60 seconds', () => {
    expect(isValidSession({ start_time: 1000, end_time: 30000 })).toBe(false);
  });

  it('accepts session 60+ seconds', () => {
    expect(isValidSession({ start_time: 1000, end_time: 1000 + 60 * 1000 })).toBe(true);
    expect(isValidSession({ start_time: 1000, end_time: 1000 + 5 * 60 * 1000 })).toBe(true);
  });

  it('accepts active sessions (no end_time)', () => {
    expect(isValidSession({ start_time: 1000, end_time: null })).toBe(true);
    expect(isValidSession({ start_time: 1000 })).toBe(true);
  });
});

// ============================================================
// loadWithExpiry / saveWithExpiry
// ============================================================

describe('loadWithExpiry / saveWithExpiry', () => {
  function makeStorage(): Storage {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      removeItem: (key: string) => { data.delete(key); },
      clear: () => { data.clear(); },
      key: () => null,
      get length() { return data.size; },
    } as Storage;
  }

  it('saves and loads value within expiry', () => {
    const storage = makeStorage();
    saveWithExpiry(storage, 'test', { foo: 'bar' });
    expect(loadWithExpiry(storage, 'test')).toEqual({ foo: 'bar' });
  });

  it('returns null for non-existent key', () => {
    expect(loadWithExpiry(makeStorage(), 'missing')).toBe(null);
  });
});
