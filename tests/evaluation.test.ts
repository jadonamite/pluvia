import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { faultVariants } from '../eval/build_cases.js';
import { missingAsZero } from '../app/probes/missingAsZero.js';
import type { DailySeries } from '../app/types.js';
import { policy, series } from './fixtures.js';
import type { EvaluationCase } from '../eval/types.js';
describe('evaluation labels and dated negative evidence', () => {
  it('retains clean contractual labels and makes explicit fault variants without mutating the reference', () => {
    const clean: EvaluationCase = {
      id: 'test',
      category: 'clean',
      policy,
      station: series(),
      satellite: series('power'),
      label: { payout_due: true, expected_inspection: false, basis: 'known clean test' },
      provenance: { station_url: 'test', satellite_url: 'test' }
    };
    const variants = faultVariants(clean);
    expect(variants).toHaveLength(8);
    for (const category of ['satellite_dry_days', 'satellite_outlier']) {
      const v = variants.find((x) => x.category === category)!;
      expect(v.station.days).toEqual(clean.station.days);
      expect(v.satellite!.days).not.toEqual(clean.satellite!.days);
      expect(v.label.expected_inspection).toBe(false);
    }
    expect(variants.every((v) => v.label.payout_due)).toBe(true);
    expect(clean.station.days).toHaveLength(10);
    expect(variants.find((v) => v.category === 'drop_days')!.station.days.length).toBeLessThan(10);
  });
  it('does not diagnose corroborated Dodoma reported zeros while preserving missing calendar dates', () => {
    const fixture = JSON.parse(readFileSync('eval/data/dodoma-zero-run.json', 'utf8')) as {
      station: DailySeries;
      satellite: DailySeries;
    };
    const result = missingAsZero(fixture.station, fixture.satellite, {
      window_start: '2004-04-26',
      window_end: '2004-12-12'
    });
    expect(result.metric.suspect_zero_days).toBe(0);
    expect(result.metric.missing_days).toBe(56);
    expect(result.status).toBe('fail');
  });
});
