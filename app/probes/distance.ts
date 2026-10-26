import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { haversineKm } from '../domain/series.js';

// Evaluates haversine distance between reference station and insured farm point.
export function distance(station: DailySeries, policy: Policy): ProbeResult {
  let km: number;
  try {
    km = haversineKm(policy.farm_lat, policy.farm_lon, station.lat, station.lon);
  } catch {
    return {
      id: 'P5',
      name: 'Station distance',
      status: 'fail',
      metric: { distance_km: 'unknown' },
      evidence: 'Station distance cannot be established from invalid coordinates.',
    };
  }

  return {
    id: 'P5',
    name: 'Station distance',
    status: km > policy.max_station_km ? 'warn' : 'pass',
    metric: { distance_km: km, max_station_km: policy.max_station_km },
    evidence: `Station is ${km.toFixed(1)} km from the farm; sole-index limit is ${policy.max_station_km} km.`,
  };
}
