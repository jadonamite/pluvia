import { AdapterError, type AdapterHealth, type ModelAdapter, type ModelRequest, type ModelResponse } from './contracts.js';
import type { Policy, ProbeResult } from '../types.js';

export class NightshiftSampleAdapter implements ModelAdapter {
  readonly configuredRoute = 'sample-rules';
  constructor(_options: { dataDirectory?: string } = {}) {}
  async health(): Promise<AdapterHealth> { return 'sample'; }
  async complete(request: ModelRequest, options: { signal?: AbortSignal } = {}): Promise<ModelResponse> {
    options.signal?.throwIfAborted();
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(request.prompt).payload as Record<string, unknown>; }
    catch { throw new AdapterError('sample_prompt', 'The sample model requires a structured agent payload.', false); }
    let output: unknown;
    const probes = (Array.isArray(payload.probes) ? payload.probes : []) as ProbeResult[];
    if (request.agent === 'IntakeAgent') {
      const policies = payload.policies as Policy[]; const text = String(payload.event_text ?? '').toLowerCase();
      const matches = policies.filter(policy => text.includes(policy.policy_id.toLowerCase()) || text.includes(policy.group_name.replace(/\s*\(synthetic\)/i, '').toLowerCase()));
      output = { policy_id: matches.length === 1 ? matches[0]!.policy_id : '', event: /drought|rain|dry/.test(text) ? 'drought' : 'other', confidence: matches.length === 1 ? 1 : 0 };
    } else if (request.agent === 'PlannerAgent') output = { sources: ['ghcn', 'power'], notes: 'Compare independent satellite evidence with the contractual ground record, including coverage and source disagreement.' };
    else if (request.agent === 'AuditorAgent') output = { explanation: probes.map(probe => `${probe.id}: ${probe.status}; ${probe.evidence}`).join(' ').split(/\s+/).slice(0, 115).join(' ') };
    else if (request.agent === 'AdjudicatorAgent') {
      const divergent = probes.some(probe => probe.id === 'P6' && probe.status === 'fail');
      if (divergent && Number(payload.round ?? 0) === 0 && !(Array.isArray(payload.recalled) && payload.recalled.length)) output = { action: 'request_evidence', kind: 'prior_years', params: {}, rationale: 'P6: compare prior-year satellite evidence before evaluating the unresolved source disagreement.' };
      else {
        const failed = probes.filter(probe => ['P1', 'P2', 'P4', 'P5'].includes(probe.id) && probe.status !== 'pass');
        output = { action: 'decide', proposed_source: divergent ? 'none' : failed.length ? 'power' : 'ghcn', rationale: `${failed.map(probe => `${probe.id}: ${probe.evidence}`).join(' ')}${divergent ? ' P6 remains unresolved; prior-year context cannot repair the missing station record. Inspect.' : ' Apply the contractual trigger only after the deterministic checks.'}`, counter_case: 'A named station measures one point, and a satellite estimates an area. Neither proves the rain received on the farm. Missing records or source disagreement may conceal a real loss, so any refusal needs a human review of the farmer’s account.' };
      }
    } else if (request.agent === 'ReporterAgent') output = { summary: 'The code gate has recorded its decision. Review the evidence and the case for paying before settlement.' };
    else throw new AdapterError('sample_agent', 'No sample rule exists for this agent.', false);
    return { content: JSON.stringify(output), model: 'sample-rules', route: 'sample-rules' };
  }
}
