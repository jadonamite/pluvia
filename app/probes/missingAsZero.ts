import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { normalizeSeries, policyWindow, validMm } from '../domain/series.js';
import { PROBE_THRESHOLDS as T } from './config.js';
export function missingAsZero(station: DailySeries, satellite: DailySeries|null, policy: Pick<Policy,'window_start'|'window_end'>): ProbeResult {
  const s = normalizeSeries(station,policyWindow(policy));
  const sat = satellite ? new Map(normalizeSeries(satellite,policyWindow(policy)).days.map(d=>[d.date,d])) : new Map();
  const suspect = s.valid.filter(d=> {const other = sat.get(d.date); return d.mm===0 && validMm(other) && other.mm>=T.satellite_wet_mm;}).length;
  return {id:'P2',name:'Missing treated as zero',status:s.missing>=T.missing_days || suspect>=T.suspect_zero_days?'fail':'pass',metric:{missing_days:s.missing,suspect_zero_days:suspect,naive_sum_mm:s.total},evidence:`${s.missing} missing station days would contribute zero to a naive sum; ${suspect} reported zeros coincide with satellite rain of at least ${T.satellite_wet_mm} mm. This identifies an unreliable record, not an instrument fault.`};
}
