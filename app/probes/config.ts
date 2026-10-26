// Deterministic thresholds for data quality and agreement probes.
export const PROBE_THRESHOLDS = Object.freeze({
  missing_days: 3,
  suspect_zero_days: 2,
  satellite_wet_mm: 5,
  record_end_days: 3,
  divergence_relative: 0.4,
  divergence_absolute_mm: 50,
  satellite_fill_warn: 3,
  satellite_fill_fail: 6,
  memory_confidence: 0.7,
});
