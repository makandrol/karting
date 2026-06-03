import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from './useLocalStorage';

describe('useLocalStorage', () => {
  beforeEach(() => localStorage.clear());

  it('returns default when nothing stored', () => {
    const { result } = renderHook(() => useLocalStorage('test', { a: 1 }));
    expect(result.current[0]).toEqual({ a: 1 });
  });

  it('persists value on update', () => {
    const { result } = renderHook(() => useLocalStorage('test', 0));
    act(() => result.current[1](42));
    expect(result.current[0]).toBe(42);
    expect(JSON.parse(localStorage.getItem('test')!)).toBe(42);
  });

  it('supports updater function', () => {
    const { result } = renderHook(() => useLocalStorage('test', 1));
    act(() => result.current[1](v => v + 10));
    expect(result.current[0]).toBe(11);
  });

  it('loads previously stored value on mount', () => {
    localStorage.setItem('test', JSON.stringify('hello'));
    const { result } = renderHook(() => useLocalStorage('test', 'default'));
    expect(result.current[0]).toBe('hello');
  });

  it('falls back to default if storage value is corrupted', () => {
    localStorage.setItem('test', 'NOT-JSON');
    const { result } = renderHook(() => useLocalStorage('test', { fallback: true }));
    expect(result.current[0]).toEqual({ fallback: true });
  });

  describe('endOfDayExpiry', () => {
    it('persists with expiry envelope', () => {
      const { result } = renderHook(() =>
        useLocalStorage('exp', 'default', { endOfDayExpiry: true })
      );
      act(() => result.current[1]('saved'));
      const raw = JSON.parse(localStorage.getItem('exp')!);
      expect(raw.value).toBe('saved');
      expect(raw.expiresAt).toBeGreaterThan(Date.now());
    });

    it('returns default and removes key when expired', () => {
      localStorage.setItem('exp', JSON.stringify({ value: 'old', expiresAt: Date.now() - 1000 }));
      const { result } = renderHook(() =>
        useLocalStorage('exp', 'default', { endOfDayExpiry: true })
      );
      expect(result.current[0]).toBe('default');
      expect(localStorage.getItem('exp')).toBe(null);
    });
  });

  describe('reviver / serializer', () => {
    it('uses serializer to write Set as array', () => {
      const { result } = renderHook(() =>
        useLocalStorage<Set<string>>('s', new Set(), {
          serializer: (s) => [...s],
          reviver: (raw) => new Set(raw as string[]),
        })
      );
      act(() => result.current[1](new Set(['a', 'b'])));
      expect(JSON.parse(localStorage.getItem('s')!)).toEqual(['a', 'b']);
    });

    it('uses reviver to read array as Set', () => {
      localStorage.setItem('s', JSON.stringify(['x', 'y']));
      const { result } = renderHook(() =>
        useLocalStorage<Set<string>>('s', new Set(), {
          reviver: (raw) => new Set(raw as string[]),
        })
      );
      expect(result.current[0].has('x')).toBe(true);
      expect(result.current[0].has('y')).toBe(true);
    });
  });
});
