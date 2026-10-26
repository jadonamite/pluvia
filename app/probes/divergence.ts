import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { normalizeSeries, policyWindow, validMm } from '../domain/series.js';
import { PROBE_THRESHOLDS as T } from './config.js';
export function divergence(station: DailySeries, satellite: DailySeries|null, policy: Policy): ProbeResult {
  if(!satellite) return {id:'P6',name:'Source divergence',status:'fail',metric:{overlap_days:0},evidence:'Satellite source unavailable; independent comparison cannot be performed.'};
  const s=normalizeSeries(station,policyWindow(policy)), sat=new Map(normalizeSeries(satellite,policyWindow(policy)).days.map(d=>[d.date,d]));
  let a=0,b=0,count=0;
  for(const day of s.valid) {const other=sat.get(day.date); if(validMm(other)){a+=day.mm;b+=other.mm;count++;}}
  const delta=Math.abs(a-b),relative=delta/Math.max(b,1);
  return {id:'P6',name:'Source divergence',status:!count||relative>T.divergence_relative||delta>T.divergence_absolute_mm?'fail':'pass',metric:{overlap_days:count,station_mm:a,satellite_mm:b,absolute_gap_mm:delta,relative_gap:relative},evidence:`On ${count} overlapping days station totals ${a.toFixed(1)} mm and satellite ${b.toFixed(1)} mm; gap ${delta.toFixed(1)} mm (${(relative*100).toFixed(1)}%).`};
}
