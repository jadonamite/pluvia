import type { DailySeries, Policy } from '../app/types.js';
export interface EvaluationCase {
  id: string;
  category:
    | 'measured_basis_risk'
    | 'clean'
    | 'drop_days'
    | 'zero_fill'
    | 'truncate'
    | 'shift'
    | 'distant_station'
    | 'real_sparse'
    | 'true_negative';
  policy: Policy;
  station: DailySeries;
  satellite: DailySeries | null;
  label: { payout_due: boolean | null; expected_inspection: boolean; basis: string };
  provenance: { station_url: string; satellite_url: string; fault?: string };
}
