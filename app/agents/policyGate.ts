import type {
  AdjudicatorProposal,
  DailySeries,
  Decision,
  IndexSource,
  MemoryConflict,
  MemorySummary,
  Policy,
} from '../types.js';
import { normalizeSeries, policyWindow } from '../domain/series.js';
import { payout, validatePolicy } from '../domain/payout.js';
import { satelliteOnly, stationOnly } from '../domain/naive.js';
import { borderline, runProbes } from '../probes/index.js';
import { PROBE_THRESHOLDS } from '../probes/config.js';

export interface PolicyGateInput {
  policy: Policy;
  station: DailySeries;
  satellite: DailySeries | null;
  proposal: AdjudicatorProposal;
  memory_conflicts?: MemoryConflict[];
  memory?: MemorySummary;
  rounds?: number;
}

// Applies policy contract rules and guardrails to determine claim verdict.
export function policyGate({
  policy,
  station,
  satellite,
  proposal,
  memory_conflicts = [],
  memory = { recalled: [], written: [], conflicts: [] },
  rounds = 0,
}: PolicyGateInput): Decision {
  validatePolicy(policy);

  const window = policyWindow(policy);
  const stationData = normalizeSeries(station, window);
  const satelliteData = satellite ? normalizeSeries(satellite, window) : null;
  const probes = runProbes({ policy, station, satellite });

  const result: Decision = {
    verdict: 'INSPECT',
    payout_ngn: 0,
    index_source: 'none',
    index_mm: null,
    reasons: [],
    probes,
    naive: {
      station_only: stationOnly(station, policy),
      satellite_only: satelliteOnly(satellite, policy),
    },
    memory,
    rounds,
    human_review_required: true,
  };

  // Helper to construct an inspection decision with attached evidence.
  const inspect = (reason: string): Decision => {
    result.reasons.push(
      reason,
      ...probes
        .filter(p => p.id !== 'P8' && p.status !== 'pass')
        .map(p => `${p.id}: ${p.evidence}`)
    );
    result.inspection_question =
      `Establish rainfall at the insured farm (${policy.farm_lat}, ${policy.farm_lon}) ` +
      `from ${policy.window_start} through ${policy.window_end}. ` +
      `Reconcile missing or suspect station dates and any disagreement ` +
      `with the independent satellite record before settlement.`;
    return result;
  };

  const passed = (id: string) => probes.find(p => p.id === id)?.status === 'pass';

  // Validate source identities match the policy evidence contract.
  if (
    station.source !== 'ghcn' ||
    station.id !== policy.ref_station_id ||
    (satellite && satellite.source !== 'power')
  ) {
    return inspect('Source identities do not match the policy evidence contract.');
  }

  // Verify satellite coordinates match the farm location.
  if (
    satellite &&
    (!Number.isFinite(satellite.lat) ||
      !Number.isFinite(satellite.lon) ||
      satellite.lat !== policy.farm_lat ||
      satellite.lon !== policy.farm_lon)
  ) {
    return inspect('Satellite coordinates do not match the insured farm point.');
  }

  // Reject invalid observation dates.
  if (stationData.invalid_dates || satelliteData?.invalid_dates) {
    return inspect('Invalid observation dates require correction before settlement.');
  }

  // Unresolved or low-confidence memory conflicts force inspection.
  if (
    memory_conflicts.some(
      c =>
        c.status === 'open' ||
        !Number.isFinite(c.resolution_confidence) ||
        c.resolution_confidence < PROBE_THRESHOLDS.memory_confidence
    )
  ) {
    return inspect('Memory conflict remains unresolved or below 0.70 confidence.');
  }

  // Source divergence must be resolved by valid evidence passing probes.
  if (!passed('P6')) {
    return inspect('P6: source comparison failed; new evidence must pass the probes before this conflict can be cleared.');
  }

  let source: IndexSource = 'ghcn';
  const failedStation = ['P1', 'P2', 'P4'].filter(id => !passed(id));
  if (!passed('P5')) failedStation.push('P5');

  // Substitute satellite if station probes fail and model proposal cites all failed probes.
  if (failedStation.length) {
    const citations = failedStation.every(id =>
      new RegExp(`\\b${id}\\b`, 'i').test(proposal.rationale ?? '')
    );
    if (!passed('P7') || !satelliteData || satelliteData.missing > 0) {
      return inspect('Station is unreliable and the satellite lacks a complete usable window.');
    }
    if (!citations) {
      return inspect(`Satellite substitution requires a rationale citing ${failedStation.join(', ')}.`);
    }
    source = 'power';
    result.reasons.push(
      `Corrected index uses satellite evidence because ${failedStation.join(', ')} bars the station as sole index.`
    );
  }

  const index = source === 'ghcn' ? stationData.total : satelliteData!.total;
  const p8 = borderline(index, policy);
  probes[7] = p8;

  // Borderline index values force inspection.
  if (p8.status !== 'pass') {
    return inspect('P8: the index lies within the trigger inspection band.');
  }

  const amount = payout(index, policy);
  if (amount === 0) {
    // Contractual index does not trigger a payout; refusal guardrails apply.
    if (!satelliteData || satelliteData.missing > 0 || !passed('P7')) {
      return inspect('A refusal requires available, complete independent satellite evidence.');
    }
    if (!passed('P1')) {
      return inspect('P1: insufficient station coverage cannot support a refusal.');
    }
    if (!proposal.counter_case?.trim()) {
      return inspect('A refusal requires the strongest case for paying, attached for human review.');
    }
    result.counter_case = proposal.counter_case.trim();
    result.verdict = 'NO_PAY';
    result.reasons.push(
      'The contractual index does not trigger a payout. This proposed refusal requires human review of the counter-case.'
    );
  } else {
    // Contractual trigger is met; restore suppressed payout if station-only was NO_PAY.
    result.verdict =
      source === 'power' && result.naive.station_only.verdict === 'NO_PAY'
        ? 'PAY_ANYWAY'
        : 'PAY';
    result.human_review_required = false;
    result.reasons.push(
      result.verdict === 'PAY_ANYWAY'
        ? 'The corrected contractual index restores a payout suppressed by the station-only trigger.'
        : 'The contractual rainfall trigger is met.'
    );
  }

  result.index_source = source;
  result.index_mm = index;
  result.payout_ngn = amount;
  return result;
}
