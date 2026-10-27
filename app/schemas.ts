import { z } from 'zod';
import { dateTime } from './domain/series.js';

const date = z.string().refine(value => {
  try {
    dateTime(value);
    return true;
  } catch {
    return false;
  }
}, 'Invalid ISO date');

// Schema for contract terms governing drought index policies.
export const policySchema = z.object({
  policy_id: z.string().min(1),
  group_name: z.string().min(1),
  crop: z.string().min(1),
  synthetic: z.literal(true),
  farm_lat: z.number().min(-90).max(90),
  farm_lon: z.number().min(-180).max(180),
  ref_station_id: z.string().min(1),
  window_start: date,
  window_end: date,
  trigger_mm: z.number().finite(),
  exit_mm: z.number().finite(),
  sum_insured_ngn: z.number().finite(),
  borderline_band_mm: z.number().finite(),
  min_coverage: z.number().finite(),
  max_station_km: z.number().finite(),
  power_table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  gauge_view: z.string().regex(/^eval_gauge_[a-z0-9_]+$/).optional(),
});

// Schema for submitted insurance claims.
export const claimSchema = z.object({
  claim_id: z.string().min(1),
  policy_id: z.string().min(1),
  submitted_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
  event_text: z.string().min(1),
  synthetic: z.literal(true),
  window_override: z.object({ start: date, end: date }).optional(),
});
