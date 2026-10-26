import { describe, expect, it } from 'vitest';
import { policyTerms, probeSummaries, summarizeExtra } from '../app/agents/modelPayloads.js';
import type { Policy, ProbeResult } from '../app/types.js';

const policy = {
  policy_id: 'POL-1', group_name: 'Group (synthetic)', crop: 'maize', synthetic: true,
  farm_lat: 6.577, farm_lon: 3.321, ref_station_id: 'NIM00065201',
  window_start: '2025-07-01', window_end: '2025-07-03', trigger_mm: 10, exit_mm: 2,
  sum_insured_ngn: 1000, borderline_band_mm: 1, min_coverage: 0.8, max_station_km: 20,
  power_table: 'power_lagos_2025_daily',
} as Policy;

describe('model payloads', () => {
  it('drops probe metrics and contract fields the models do not reason about', () => {
    const probe: ProbeResult = { id: 'P1', name: 'coverage', status: 'fail', metric: { coverage: 0.3 }, evidence: '1 of 3 days' };
    expect(probeSummaries([probe])).toEqual([{ id: 'P1', name: 'coverage', status: 'fail', evidence: '1 of 3 days' }]);
    const terms = policyTerms(policy);
    expect(terms).not.toHaveProperty('sum_insured_ngn');
    expect(terms).not.toHaveProperty('farm_lat');
    expect(terms.trigger_mm).toBe(10);
  });

  it('reduces prior-year rows to complete contractual-window totals', () => {
    const rows = [
      ...['2023-07-01', '2023-07-02', '2023-07-03'].map(obs_date => ({ obs_date, mm: 2 })),
      ...['2024-07-01', '2024-07-02', '2024-07-03'].map(obs_date => ({ obs_date, mm: 4 })),
      { obs_date: '2022-07-01', mm: 9 },
      { obs_date: '2022-07-02', mm: null },
      { obs_date: '2024-08-01', mm: 50 },
    ];
    expect(summarizeExtra('prior_years', rows, policy)).toEqual({
      kind: 'prior_years',
      row_count: 9,
      window: '07-01 to 07-03',
      complete_years: [{ year: 2023, total_mm: 6 }, { year: 2024, total_mm: 12 }],
      median_mm: 9,
    });
  });

  it('totals station rows per station for neighbour and shifted-window requests', () => {
    const rows = [
      { station_id: 'A', obs_date: '2025-07-01', mm: 1.25 },
      { station_id: 'A', obs_date: '2025-07-02', mm: 2 },
      { station_id: 'B', obs_date: '2025-07-01', mm: null },
    ];
    expect(summarizeExtra('neighbor_station', rows, policy)).toEqual({
      kind: 'neighbor_station',
      row_count: 3,
      stations: [
        { station_id: 'A', valid_days: 2, total_mm: 3.3 },
        { station_id: 'B', valid_days: 0, total_mm: 0 },
      ],
    });
  });
});
