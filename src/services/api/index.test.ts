import { describe, it, expect } from 'vitest';
import { normalizeCompetition, type CompetitionDto } from './index';

describe('normalizeCompetition', () => {
  it('повертає null для null/undefined', () => {
    expect(normalizeCompetition(null)).toBe(null);
    expect(normalizeCompetition(undefined)).toBe(null);
  });

  it('parses sessions string → array', () => {
    const dto = {
      id: 'c1', name: 'Test', format: 'light_league', date: '2026-01-01', status: 'live',
      sessions: '[{"sessionId":"s1","phase":"qualifying_1"}]',
      results: null,
    } as unknown as CompetitionDto;
    const c = normalizeCompetition(dto);
    expect(c?.sessions).toEqual([{ sessionId: 's1', phase: 'qualifying_1' }]);
  });

  it('migrates legacy ["s1", "s2"] → [{sessionId, phase: null}]', () => {
    const dto = {
      id: 'c1', name: 'T', format: 'sprint', date: '2026-01-01', status: 'live',
      sessions: '["s1","s2"]',
      results: null,
    } as unknown as CompetitionDto;
    const c = normalizeCompetition(dto);
    expect(c?.sessions).toEqual([
      { sessionId: 's1', phase: null },
      { sessionId: 's2', phase: null },
    ]);
  });

  it('parses results string → object', () => {
    const dto = {
      id: 'c1', name: 'T', format: 'gonzales', date: '2026-01-01', status: 'live',
      sessions: [],
      results: '{"groupCountOverride":2}',
    } as unknown as CompetitionDto;
    expect(normalizeCompetition(dto)?.results).toEqual({ groupCountOverride: 2 });
  });

  it('null results → empty object', () => {
    const dto = {
      id: 'c1', name: 'T', format: 'sprint', date: '2026-01-01', status: 'live',
      sessions: [], results: null,
    } as unknown as CompetitionDto;
    expect(normalizeCompetition(dto)?.results).toEqual({});
  });

  it('idempotent — already-parsed dto passes through', () => {
    const dto = {
      id: 'c1', name: 'T', format: 'champions_league', date: '2026-01-01', status: 'live',
      sessions: [{ sessionId: 's1', phase: 'qualifying_1' }],
      results: { groupCountOverride: 2 },
      uploaded_results: { foo: 'bar' },
    } as unknown as CompetitionDto;
    const c1 = normalizeCompetition(dto);
    const c2 = normalizeCompetition(c1!);
    expect(c2).toEqual(c1);
  });

  it('uploaded_results parsed з рядка', () => {
    const dto = {
      id: 'c1', name: 'T', format: 'sprint', date: '2026-01-01', status: 'live',
      sessions: [], results: null,
      uploaded_results: '{"pilots":[]}',
    } as unknown as CompetitionDto;
    expect(normalizeCompetition(dto)?.uploaded_results).toEqual({ pilots: [] });
  });

  it('малформований JSON у sessions → пустий масив', () => {
    const dto = {
      id: 'c1', name: 'T', format: 'sprint', date: '2026-01-01', status: 'live',
      sessions: 'broken json',
      results: null,
    } as unknown as CompetitionDto;
    expect(normalizeCompetition(dto)?.sessions).toEqual([]);
  });

  it('малформований JSON у results → пустий об\'єкт', () => {
    const dto = {
      id: 'c1', name: 'T', format: 'sprint', date: '2026-01-01', status: 'live',
      sessions: [],
      results: 'broken',
    } as unknown as CompetitionDto;
    expect(normalizeCompetition(dto)?.results).toEqual({});
  });
});
