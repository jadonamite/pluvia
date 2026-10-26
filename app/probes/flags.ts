import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { policyWindow, windowDates } from '../domain/series.js';
export function flags(station: DailySeries, policy: Policy): ProbeResult {
  const dates = new Set(windowDates(policyWindow(policy))), metric: Record<string,number|string> = {quality_flagged:0};
  for (const day of (Array.isArray(station.days) ? station.days : []).filter(d=>!!d && typeof d === 'object' && typeof d.date === 'string' && dates.has(d.date))) {
    if(day.q_flag!=null&&(typeof day.q_flag!=='string'||day.q_flag.trim())) metric.quality_flagged = Number(metric.quality_flagged)+1;
    for (const key of ['m_flag','s_flag'] as const) if(day[key]!=null&&String(day[key]).trim()) {const name=`${key}:${String(day[key]).trim()}`; metric[name]=Number(metric[name]??0)+1;}
  }
  return {id:'P3',name:'Quality and measurement flags',status:Number(metric.quality_flagged)>0?'warn':'pass',metric,evidence:`${metric.quality_flagged} quality-flagged rows excluded. Measurement/source counts: ${JSON.stringify(metric)}. A is multi-day accumulation; B/D are partial-day measurements; a blank quality flag does not establish accuracy.`};
}
