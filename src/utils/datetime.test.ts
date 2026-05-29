import { describe, it, expect } from 'vitest';
import {
  fmtTime, fmtTimeShort, fmtDateTime, fmtDateISO, fmtDateDM,
  fmtDuration, fmtDurationMs, fmtDateLabel,
} from './datetime';

describe('fmtTime / fmtTimeShort', () => {
  it('formats with seconds', () => {
    const ms = new Date('2026-04-15T14:30:45').getTime();
    expect(fmtTime(ms)).toMatch(/14:30:45/);
  });

  it('formats without seconds', () => {
    const ms = new Date('2026-04-15T14:30:45').getTime();
    expect(fmtTimeShort(ms)).toMatch(/^14:30/);
    expect(fmtTimeShort(ms)).not.toMatch(/45/);
  });
});

describe('fmtDateISO', () => {
  it('formats date as YYYY-MM-DD', () => {
    expect(fmtDateISO(new Date(2026, 3, 5))).toBe('2026-04-05');
    expect(fmtDateISO(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses local time, not UTC', () => {
    // Date constructor with year/month/day creates local-time date
    const d = new Date(2026, 0, 1);
    expect(fmtDateISO(d)).toBe('2026-01-01');
  });
});

describe('fmtDateDM', () => {
  it('formats as DD.MM', () => {
    const d = new Date(2026, 3, 5);
    expect(fmtDateDM(d.getTime())).toBe('05.04');
  });
});

describe('fmtDateTime', () => {
  it('combines date and time', () => {
    const ms = new Date(2026, 3, 15, 14, 30, 45).getTime();
    expect(fmtDateTime(ms)).toMatch(/^15\.04, 14:30:45$/);
  });
});

describe('fmtDuration', () => {
  it('formats seconds only when < 1 minute', () => {
    expect(fmtDuration(0, 30_000)).toBe('30с');
  });

  it('formats minutes and seconds', () => {
    expect(fmtDuration(0, 90_000)).toBe('1хв 30с');
    expect(fmtDuration(0, 600_000)).toBe('10хв 0с');
  });

  it('default whenActive = "—"', () => {
    expect(fmtDuration(1000, null)).toBe('—');
    expect(fmtDuration(1000, undefined)).toBe('—');
  });

  it('respects custom whenActive', () => {
    expect(fmtDuration(1000, null, { whenActive: 'active' })).toBe('active');
  });
});

describe('fmtDurationMs', () => {
  it('formats from ms duration', () => {
    expect(fmtDurationMs(45_000)).toBe('45с');
    expect(fmtDurationMs(90_000)).toBe('1хв 30с');
  });
});

describe('fmtDateLabel', () => {
  it('returns "Сьогодні" for today', () => {
    const today = fmtDateISO(new Date());
    expect(fmtDateLabel(today)).toBe('Сьогодні');
  });

  it('returns "Вчора" for yesterday', () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    expect(fmtDateLabel(fmtDateISO(y))).toBe('Вчора');
  });

  it('returns full label for other dates', () => {
    const result = fmtDateLabel('2026-04-15');
    // example: "Ср 15.04.2026"
    expect(result).toMatch(/^[А-Яа-я]{2} 15\.04\.2026$/);
  });
});
