import type { DailySeries, Policy, ProbeResult } from '../types.js';
import { coverage } from './coverage.js';
import { missingAsZero } from './missingAsZero.js';
import { flags } from './flags.js';
import { recordEnd } from './recordEnd.js';
import { distance } from './distance.js';
import { divergence } from './divergence.js';
import { satelliteFill } from './satelliteFill.js';
import { borderline } from './borderline.js';

export {
  coverage,
  missingAsZero,
  flags,
  recordEnd,
  distance,
  divergence,
  satelliteFill,
  borderline,
};

export interface ProbeInput {
  policy: Policy;
  station: DailySeries;
  satellite: DailySeries | null;
  index_mm?: number | null;
}

// Executes all deterministic evidence probes for a claim.
export function runProbes({
  policy,
  station,
  satellite,
  index_mm = null,
}: ProbeInput): ProbeResult[] {
  return [
    coverage(station, policy),
    missingAsZero(station, satellite, policy),
    flags(station, policy),
    recordEnd(station, policy),
    distance(station, policy),
    divergence(station, satellite, policy),
    satelliteFill(satellite, policy),
    borderline(index_mm, policy),
  ];
}
