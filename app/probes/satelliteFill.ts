import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { normalizeSeries, policyWindow } from '../domain/series.js';
import { PROBE_THRESHOLDS as T } from './config.js';

// Evaluates completeness and fill values in the independent satellite retrieval.
export function satelliteFill(
  satellite: DailySeries | null,
  policy: Policy
): ProbeResult {
  if (!satellite) {
    return {
      id: 'P7',
      name: 'Satellite fill values',
      status: 'fail',
      metric: { available: 0 },
      evidence: 'Satellite source unavailable.',
    };
  }

  const s = normalizeSeries(satellite, policyWindow(policy));
  const status =
    s.missing > T.satellite_fill_fail
      ? 'fail'
      : s.missing > T.satellite_fill_warn
        ? 'warn'
        : 'pass';

  return {
    id: 'P7',
    name: 'Satellite fill values',
    status,
    metric: {
      missing_or_fill_days: s.missing,
      valid_days: s.valid.length,
      duplicate_rows: s.duplicates,
      invalid_dates: s.invalid_dates,
    },
    evidence: `${s.missing} satellite days missing, invalid, duplicated or filled; -999 fill values are excluded.`,
  };
}
