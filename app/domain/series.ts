import type { DailySeries, DayValue, Policy, Window } from '../types.js';
const DAY = 86_400_000;
export function dateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ISO date: ${value}`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value) throw new Error(`Invalid ISO date: ${value}`);
  return time;
}
export function windowDates(window: Window): string[] {
  const start = dateTime(window.start), end = dateTime(window.end);
  if (end < start || (end-start)/DAY > 3660) throw new Error('Invalid or excessive observation window');
  return Array.from({length: (end-start)/DAY+1}, (_,i) => new Date(start+i*DAY).toISOString().slice(0,10));
}
export function policyWindow(policy: Pick<Policy,'window_start'|'window_end'>): Window { return {start: policy.window_start, end: policy.window_end}; }
export function validMm(day: DayValue | undefined): day is DayValue & {mm: number} {
  return !!day && typeof day.mm === 'number' && Number.isFinite(day.mm) && day.mm >= 0 && (day.q_flag==null||(typeof day.q_flag==='string'&&!day.q_flag.trim())) && !day.fill;
}
export interface NormalizedSeries { days: DayValue[]; valid: (DayValue & {mm:number})[]; total: number; missing: number; duplicates: number; invalid_dates: number }
export function normalizeSeries(series: DailySeries, window: Window = series.window): NormalizedSeries {
  const dates = windowDates(window), allowed = new Set(dates), rows = new Map<string,DayValue[]>();
  let invalid_dates = 0;
  for (const candidate of Array.isArray(series.days) ? series.days : []) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.date !== 'string') { invalid_dates++; continue; }
    const day = candidate;
    try { dateTime(day.date); } catch { invalid_dates++; continue; }
    if (!allowed.has(day.date)) continue;
    rows.set(day.date,[...(rows.get(day.date) ?? []),day]);
  }
  let duplicates = 0;
  const days = dates.map(date => {
    const matches = rows.get(date) ?? [];
    if (matches.length > 1) { duplicates += matches.length-1; return {date, mm:null}; }
    const day = matches[0];
    return validMm(day) ? {...day} : {date,mm:null};
  });
  const valid = days.filter(validMm);
  return {days, valid, total: valid.reduce((sum,d) => sum+d.mm,0), missing: dates.length-valid.length, duplicates, invalid_dates};
}
export function haversineKm(lat1:number, lon1:number, lat2:number, lon2:number): number {
  if (![lat1,lon1,lat2,lon2].every(Number.isFinite) || Math.abs(lat1)>90 || Math.abs(lat2)>90 || Math.abs(lon1)>180 || Math.abs(lon2)>180) throw new Error('Invalid coordinates');
  const rad = (x:number) => x*Math.PI/180;
  const a = Math.sin(rad(lat2-lat1)/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,a)));
}
