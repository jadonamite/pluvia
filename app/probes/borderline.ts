import type { Policy, ProbeResult } from '../types.js';

// Evaluates whether the rainfall index sits within the policy borderline inspection band.
export function borderline(indexMm: number | null, policy: Policy): ProbeResult {
  const known = indexMm !== null && Number.isFinite(indexMm) && indexMm >= 0;
  const gap = known ? Math.abs(indexMm - policy.trigger_mm) : null;

  return {
    id: 'P8',
    name: 'Borderline index',
    status: gap === null ? 'warn' : gap <= policy.borderline_band_mm ? 'fail' : 'pass',
    metric: {
      index_mm: known ? indexMm : 'unselected',
      gap_mm: gap ?? 'unknown',
      band_mm: policy.borderline_band_mm,
    },
    evidence:
      gap === null
        ? 'No usable index selected.'
        : `Index ${indexMm!.toFixed(1)} mm is ${gap.toFixed(1)} mm from trigger; inspection band is ±${policy.borderline_band_mm} mm.`,
  };
}
