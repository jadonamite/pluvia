import type { DailySeries, Policy } from '../app/types.js';
export const policy: Policy = {
  policy_id: 'POL-TEST',
  group_name: 'Test cooperative (synthetic)',
  crop: 'maize',
  synthetic: true,
  farm_lat: 6.6,
  farm_lon: 3.35,
  ref_station_id: 'TEST',
  window_start: '2025-07-01',
  window_end: '2025-07-10',
  trigger_mm: 150,
  exit_mm: 50,
  sum_insured_ngn: 10000,
  borderline_band_mm: 5,
  min_coverage: 0.8,
  max_station_km: 20,
  power_table: 'power_test_2025_daily'
};
export function series(source: 'ghcn' | 'power' = 'ghcn', mm = 10): DailySeries {
  return {
    source,
    id: source === 'ghcn' ? 'TEST' : 'grid',
    lat: 6.6,
    lon: 3.35,
    window: { start: policy.window_start, end: policy.window_end },
    days: Array.from({ length: 10 }, (_, i) => ({
      date: `2025-07-${String(i + 1).padStart(2, '0')}`,
      mm
    })),
    fetched_sql: []
  };
}
