import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { normalizeSeries, policyWindow } from '../domain/series.js';

// Evaluates valid station days against the policy minimum coverage threshold.
export function coverage(station: DailySeries, policy: Policy): ProbeResult {
  const s = normalizeSeries(station, policyWindow(policy));
  const ratio = s.valid.length / s.days.length;

  return {
    id: 'P1',
    name: 'Station coverage',
    status: ratio < policy.min_coverage ? 'fail' : 'pass',
    metric: {
      valid_days: s.valid.length,
      window_days: s.days.length,
      coverage: ratio,
      duplicate_rows: s.duplicates,
      invalid_dates: s.invalid_dates,
    },
    evidence: `${s.valid.length} of ${s.days.length} station days valid (${(ratio * 100).toFixed(1)}%); minimum ${(policy.min_coverage * 100).toFixed(1)}%.`,
  };
}
