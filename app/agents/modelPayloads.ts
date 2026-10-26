import type { Policy, ProbeResult } from '../types.js';

// Compact views of probe findings and evidence for model prompts. The gate keeps the
// full objects; models only need what they reason about, and smaller prompts finish
// inside the run budget.

export function probeSummaries(probes: ProbeResult[]) {
  return probes.map(({ id, name, status, evidence }) => ({ id, name, status, evidence }));
}

export function policyTerms(policy: Policy) {
  const {
    policy_id, crop, ref_station_id, window_start, window_end, trigger_mm, exit_mm,
    borderline_band_mm, min_coverage, max_station_km,
  } = policy;
  return {
    policy_id, crop, ref_station_id, window_start, window_end, trigger_mm, exit_mm,
    borderline_band_mm, min_coverage, max_station_km,
  };
}

const isoDate = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10);

const rainfall = (value: unknown): number | null => {
  const mm = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(mm) && mm >= 0 ? mm : null;
};

const round1 = (mm: number) => Math.round(mm * 10) / 10;

// Reduces requested extra evidence to totals: per prior year for the contractual
// calendar window, or per station for station rows. Raw daily rows stay out of prompts.
export function summarizeExtra(kind: string | undefined, rows: unknown[], policy: Policy) {
  const records = rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
  if (kind === 'prior_years') {
    const from = policy.window_start.slice(5), to = policy.window_end.slice(5);
    const expected = Math.round((Date.parse(`2001-${to}T00:00:00Z`) - Date.parse(`2001-${from}T00:00:00Z`)) / 86_400_000) + 1;
    const years = new Map<number, { total_mm: number; days: number }>();
    for (const row of records) {
      const date = isoDate(row.obs_date), mm = rainfall(row.mm), md = date.slice(5);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || mm === null || from > to || md < from || md > to) continue;
      const year = Number(date.slice(0, 4)), entry = years.get(year) ?? { total_mm: 0, days: 0 };
      entry.total_mm += mm;
      entry.days++;
      years.set(year, entry);
    }
    const complete = [...years.entries()]
      .filter(([, entry]) => entry.days === expected)
      .sort(([a], [b]) => a - b)
      .map(([year, entry]) => ({ year, total_mm: round1(entry.total_mm) }));
    const sorted = complete.map(entry => entry.total_mm).sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return {
      kind,
      row_count: records.length,
      window: `${from} to ${to}`,
      complete_years: complete,
      median_mm: sorted.length ? round1(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2) : null,
    };
  }
  const stations = new Map<string, { days: number; total_mm: number }>();
  for (const row of records) {
    const id = String(row.station_id ?? 'unknown'), mm = rainfall(row.mm), entry = stations.get(id) ?? { days: 0, total_mm: 0 };
    if (mm !== null) {
      entry.days++;
      entry.total_mm += mm;
    }
    stations.set(id, entry);
  }
  return {
    kind: kind ?? 'unknown',
    row_count: records.length,
    stations: [...stations.entries()].map(([station_id, entry]) => ({
      station_id, valid_days: entry.days, total_mm: round1(entry.total_mm),
    })),
  };
}
