import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { dateTime, normalizeSeries, policyWindow } from '../domain/series.js';
import { PROBE_THRESHOLDS as T } from './config.js';
export function recordEnd(station: DailySeries, policy: Policy): ProbeResult {
  const s = normalizeSeries(station,policyWindow(policy)), last = s.valid.at(-1)?.date;
  const gap = last ? (dateTime(policy.window_end)-dateTime(last))/86400000 : s.days.length;
  return {id:'P4',name:'Record ends early',status:!last||gap>T.record_end_days?'fail':'pass',metric:{last_valid_date:last??'none',gap_days:gap},evidence:`Last valid station date: ${last??'none'}; ${gap} days before the window end.`};
}
