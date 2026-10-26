import type { Policy } from '../types.js';
export function validatePolicy(policy: Policy): void {
  if (![policy.trigger_mm,policy.exit_mm,policy.sum_insured_ngn,policy.borderline_band_mm,policy.min_coverage,policy.max_station_km].every(Number.isFinite)
    || policy.exit_mm < 0 || policy.trigger_mm <= policy.exit_mm || policy.sum_insured_ngn < 0 || policy.borderline_band_mm < 0
    || policy.min_coverage <= 0 || policy.min_coverage > 1 || policy.max_station_km < 0) throw new Error('Invalid policy terms');
}
export function payout(indexMm: number, policy: Policy): number {
  validatePolicy(policy);
  if (!Number.isFinite(indexMm) || indexMm < 0) throw new Error('Invalid rainfall index');
  const fraction = Math.max(0,Math.min(1,(policy.trigger_mm-indexMm)/(policy.trigger_mm-policy.exit_mm)));
  return Math.round(policy.sum_insured_ngn*fraction*100)/100;
}
