import { describe, it, expect } from 'vitest';
import { payout } from '../app/domain/payout.js';
import { policy, series } from './fixtures.js';
import { dateTime, normalizeSeries, windowDates, haversineKm } from '../app/domain/series.js';
describe('payout and daily math', () => {
  it('uses exact trigger, exit, midpoint, above-trigger boundaries', () => {
    expect([150, 50, 100, 200, 0].map((mm) => payout(mm, policy))).toEqual([
      0, 10000, 5000, 0, 10000
    ]);
  });
  it('rejects nonfinite rainfall and invalid terms', () => {
    for (const value of [NaN, Infinity, -1]) expect(() => payout(value, policy)).toThrow();
    expect(() => payout(10, { ...policy, exit_mm: 150 })).toThrow();
  });
  it('aligns absent days, excludes duplicates and invalid numbers without overcounting', () => {
    const s = series();
    s.days.splice(0, 1);
    s.days.push({ ...s.days[0]! });
    s.days[2]!.mm = NaN;
    const n = normalizeSeries(s);
    expect(n.valid.length).toBe(7);
    expect(n.total).toBe(70);
    expect(n.missing).toBe(3);
  });
  it('uses inclusive UTC dates across leap days and rejects impossible dates', () => {
    expect(windowDates({ start: '2024-02-28', end: '2024-03-01' })).toHaveLength(3);
    expect(() => dateTime('2025-02-29')).toThrow();
    expect(() => windowDates({ start: '2025-07-10', end: '2025-07-01' })).toThrow();
  });
  it('validates coordinates and computes distance', () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0);
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2);
    expect(() => haversineKm(NaN, 0, 0, 0)).toThrow();
  });
});
