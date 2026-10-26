import type { Baseline, DailySeries, Policy } from '../types.js';
import { normalizeSeries, policyWindow } from './series.js';
import { payout } from './payout.js';
export function stationOnly(series: DailySeries, policy: Policy): Baseline {
  const index_mm = normalizeSeries(series,policyWindow(policy)).total;
  const payout_ngn = payout(index_mm,policy);
  return {verdict: payout_ngn>0?'PAY':'NO_PAY',payout_ngn,index_mm};
}
export function satelliteOnly(series: DailySeries|null, policy: Policy): Baseline {
  if (!series || normalizeSeries(series,policyWindow(policy)).missing>0) return {verdict:'INSPECT',payout_ngn:0,index_mm:null};
  return stationOnly(series,policy);
}
