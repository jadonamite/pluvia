import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type {
  Claim,
  DailySeries,
  Decision,
  Policy,
  ProbeResult,
  TraceEvent,
} from './types.js';
import type {
  AdapterHealth,
  ModelAdapter,
  QueryAdapter,
} from './adapters/contracts.js';
import { createTrace } from './trace.js';
import { PluviaMemory } from './memory/pluviaMemory.js';
import { DataAgent } from './agents/data.js';
import { modelJson } from './agents/modelJson.js';
import { runProbes } from './probes/index.js';
import { policyGate } from './agents/policyGate.js';
import { normalizeSeries, policyWindow, windowDates } from './domain/series.js';
import { validatePolicy } from './domain/payout.js';

export interface RunInput {
  claim_id?: string;
  policy_id?: string;
  event_text?: string;
  window_override?: { start: string; end: string };
}

export interface RunOptions {
  max_extra_rounds?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  run_id: string;
  status: 'success' | 'partial' | 'error';
  output?: {
    decision: Decision;
    probes: ProbeResult[];
    naive: Decision['naive'];
    card: Record<string, unknown>;
    letter_markdown: string;
    evidence: { station: DailySeries; satellite: DailySeries | null };
    policy: Policy;
    claim: Claim;
  };
  memory: {
    recalled: unknown[];
    written: string[];
    conflicts: unknown[];
  };
  agents: { name: string; role: string }[];
  trace: TraceEvent[];
  log_file: string;
  execution_time_seconds: number;
  error?: { type: string; message: string; recoverable: boolean };
}

const proposalSchema = z.object({
  action: z.enum(['decide', 'request_evidence']),
  proposed_source: z.enum(['ghcn', 'power', 'none']).optional(),
  rationale: z.string().optional(),
  counter_case: z.string().optional(),
  kind: z.enum(['neighbor_station', 'prior_years', 'shift_window']).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

// Coordinates multi-agent claim intake, planning, evidence retrieval, auditing, and gating.
export class Orchestrator {
  private data: DataAgent;
  private memory: PluviaMemory;
  private runs = new Map<string, RunResult>();

  constructor(
    private dependencies: {
      query: QueryAdapter;
      model: ModelAdapter;
      memory?: PluviaMemory;
      sampleMode?: boolean;
      logDirectory?: string;
      stdout?: boolean;
    }
  ) {
    this.data = new DataAgent(dependencies.query);
    this.memory =
      dependencies.memory ??
      new PluviaMemory(path.join(dependencies.logDirectory ?? 'logs', 'memory'));
  }

  // Lists all known claims from the data layer.
  listClaims(): Promise<Claim[]> {
    return this.data.claims();
  }

  // Lists all configured policies from the data layer.
  listPolicies(): Promise<Policy[]> {
    return this.data.policies();
  }

  // Reports adapter health status and whether sample mode is active.
  async health(): Promise<{
    zetaris: AdapterHealth;
    nightshift: AdapterHealth;
    sample_mode: boolean;
  }> {
    const [zetaris, nightshift] = await Promise.all([
      this.dependencies.query.health(),
      this.dependencies.model.health(),
    ]);
    return {
      zetaris,
      nightshift,
      sample_mode: Boolean(this.dependencies.sampleMode),
    };
  }

  // Records officer feedback on an existing memory entry.
  feedback(memoryId: string, outcome: 'helpful' | 'not_helpful' | 'wrong'): void {
    this.memory.feedback(memoryId, outcome);
  }

  // Retrieves a run result from the in-memory cache for this session.
  getRun(id: string): RunResult | undefined {
    return this.runs.get(id);
  }

  // Executes the full claim review workflow.
  async run(input: RunInput, options: RunOptions = {}): Promise<RunResult> {
    const started = Date.now();
    const run_id = `r_${randomUUID()}`;
    const trace = createTrace(run_id, {
      directory: this.dependencies.logDirectory,
      stdout: this.dependencies.stdout,
    });
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(240000)])
      : AbortSignal.timeout(240000);

    const result: RunResult = {
      run_id,
      status: 'error',
      memory: { recalled: [], written: [], conflicts: [] },
      agents: [],
      trace: trace.events,
      log_file: trace.logFile,
      execution_time_seconds: 0,
    };

    const event = (
      agent: string,
      action: string,
      status: 'ok' | 'warn' | 'partial' | 'fail' = 'ok',
      detail: Record<string, unknown> = {}
    ) => {
      trace.write({ agent, action, status, round: rounds, ...detail });
      if (!result.agents.some(a => a.name === agent)) {
        result.agents.push({ name: agent, role: action });
      }
    };

    let rounds = 0;
    let policy: Policy | undefined;
    let claim: Claim | undefined;
    let evidence: { station: DailySeries; satellite: DailySeries | null } | undefined;

    const lastModels = new Map<string, { model: string; route?: string }>();

    // Tracing model adapter wrapper.
    const model: ModelAdapter = {
      health: s => this.dependencies.model.health(s),
      validationEvent: (agent, action) =>
        event(
          agent,
          action === 'deterministic_fallback' ? 'model_json_fallback' : action,
          'warn',
          lastModels.get(agent) ?? { model: 'unavailable', route: 'unavailable' }
        ),
      complete: async (request, opts) => {
        const start = Date.now();
        event(request.agent, 'model_attempt', 'ok', {
          route: this.dependencies.model.configuredRoute ?? 'unavailable',
        });
        try {
          const response = await this.dependencies.model.complete(request, {
            ...opts,
            trace: entry => {
              const { agent, action, status, ...detail } = entry;
              event(agent, action, status, detail);
            },
          });
          lastModels.set(request.agent, {
            model: response.model,
            route: response.route,
          });
          event(request.agent, 'model_response', 'ok', {
            model: response.model,
            route: response.route,
            receipt: response.receipt,
            meterless: response.meterless,
            model_identity: response.model.startsWith('meterless/')
              ? 'route_only'
              : 'served_identifier',
            elapsed_ms: Date.now() - start,
          });
          return response;
        } catch (error) {
          event(request.agent, 'model_failed', 'warn', {
            model: 'unavailable',
            route: this.dependencies.model.configuredRoute ?? 'unavailable',
            elapsed_ms: Date.now() - start,
          });
          throw error;
        }
      },
    };

    // Tracing query adapter wrapper.
    const query: QueryAdapter = {
      ...(this.dependencies.query.ensurePower
        ? {
            ensurePower: (p: Policy, opts?: { prior?: boolean; signal?: AbortSignal }) =>
              this.dependencies.query.ensurePower!(p, {
                ...opts,
                trace: entry => {
                  const { agent, action, status, ...detail } = entry;
                  event(agent, action, status, detail);
                },
              }),
          }
        : {}),
      health: s => this.dependencies.query.health(s),
      query: async <T extends Record<string, unknown>>(
        sql: string,
        opts?: import('./adapters/contracts.js').QueryOptions
      ) => {
        const start = Date.now();
        try {
          const rows = await this.dependencies.query.query<T>(sql, {
            ...opts,
            trace: entry => {
              const { agent, action, status, ...detail } = entry;
              event(agent, action, status, detail);
            },
          });
          event('DataAgent', 'sql_query', 'ok', {
            sql,
            row_count: rows.length,
            elapsed_ms: Date.now() - start,
          });
          return rows;
        } catch (error) {
          event('DataAgent', 'sql_query_failed', 'warn', {
            sql,
            elapsed_ms: Date.now() - start,
          });
          throw error;
        }
      },
    };

    const data = new DataAgent(query);

    try {
      const policies = await data.policies(signal);
      claim = input.claim_id
        ? (await data.claims(signal)).find(c => c.claim_id === input.claim_id)
        : undefined;

      if (input.claim_id && !claim) throw new Error('Claim not found');

      let policyId = claim?.policy_id ?? input.policy_id;
      if (!policyId) {
        const intake = await modelJson(
          model,
          'IntakeAgent',
          {
            event_text: input.event_text,
            policies,
            contract: {
              policy_id: 'string',
              event: 'drought|other',
              confidence: 'number',
            },
          },
          z.object({
            policy_id: z.string(),
            event: z.enum(['drought', 'other']),
            confidence: z.number().min(0).max(1),
          }),
          () => ({ policy_id: '', event: 'other' as const, confidence: 0 }),
          signal
        );
        event('IntakeAgent', 'match_policy');
        if (intake.event !== 'drought' || intake.confidence < 0.7) {
          throw new Error('Choose a policy to resolve ambiguous intake');
        }
        policyId = intake.policy_id;
      }

      policy = policies.find(p => p.policy_id === policyId);
      if (!policy) throw new Error('Policy not found');

      claim = claim ?? {
        claim_id: `CLM-${randomUUID()}`,
        policy_id: policyId!,
        submitted_at: new Date().toISOString(),
        event_text: input.event_text ?? 'Drought claim',
        synthetic: true,
      };

      const override = input.window_override ?? claim.window_override;
      const alteredWindow =
        override !== undefined &&
        (override.start !== policy.window_start || override.end !== policy.window_end);

      validatePolicy(policy);
      windowDates(policyWindow(policy));

      // Recall prior precedents and station lessons from memory.
      const recalled = this.memory.recall(policy);
      result.memory.recalled = recalled;
      event('PlannerAgent', 'memory_recall', 'ok', {
        memory_op: 'recall',
        memory_ids: recalled.map(m => m.id),
      });

      await modelJson(
        model,
        'PlannerAgent',
        {
          policy,
          claim,
          recalled,
          contract: { sources: ['ghcn', 'power'], notes: 'string' },
        },
        z.object({
          sources: z.array(z.enum(['ghcn', 'power'])),
          notes: z.string(),
        }),
        () => ({
          sources: ['ghcn', 'power'],
          notes: 'Audit both independent sources for the contractual window.',
        }),
        signal
      );
      event('PlannerAgent', 'plan_sources');

      // Fetch primary observation series for station and satellite.
      evidence = await data.fetch(policy, policyWindow(policy), signal);
      event('DataAgent', 'fetch_evidence', 'ok', {
        sql: evidence.station.fetched_sql.join('\n'),
        satellite_sql: evidence.satellite?.fetched_sql.join('\n'),
      });

      let probes: ProbeResult[] = [];
      let proposal: z.infer<typeof proposalSchema> = {
        action: 'decide',
        proposed_source: 'none',
        rationale: 'Unresolved evidence requires inspection.',
      };

      const requestedRounds = options.max_extra_rounds ?? 2;
      if (!Number.isFinite(requestedRounds)) throw new Error('Invalid extra-round budget');
      const maxRounds = Math.max(0, Math.min(2, Math.floor(requestedRounds)));
      let extra: unknown[] = [];

      // Iterative audit and adjudication loop.
      for (;;) {
        probes = runProbes({ policy, ...evidence });
        event('AuditorAgent', 'deterministic_probes', 'ok', { probes });

        const explanation = await modelJson(
          model,
          'AuditorAgent',
          { probes, contract: { explanation: 'string citing probe IDs' } },
          z.object({
            explanation: z
              .string()
              .refine(s => s.split(/\s+/).length <= 120 && /\bP[1-8]\b/.test(s)),
          }),
          () => ({
            explanation: probes
              .filter(p => p.status !== 'pass')
              .map(p => `${p.id}: ${p.evidence}`)
              .join(' '),
          }),
          signal
        );
        event('AuditorAgent', 'explain_findings');

        proposal = await modelJson(
          model,
          'AdjudicatorAgent',
          {
            policy,
            probes,
            explanation,
            recalled,
            extra,
            round: rounds,
            contract: {
              action: 'decide|request_evidence',
              proposed_source: 'ghcn|power|none',
              rationale: 'cite failed probe IDs',
              counter_case: 'strongest case for paying before a refusal',
              kind: 'prior_years|neighbor_station|shift_window',
            },
          },
          proposalSchema,
          () => ({
            action: 'decide',
            proposed_source: 'none',
            rationale:
              'Model evidence unavailable; unresolved findings require inspection.',
          }),
          signal
        );
        event('AdjudicatorAgent', proposal.action, 'ok', { proposal });

        if (proposal.action !== 'request_evidence' || rounds >= maxRounds) break;
        rounds++;

        try {
          extra = await data.fetchExtra(policy, proposal.kind ?? 'prior_years', signal);
          event('DataAgent', 'extra_evidence', 'ok', {
            kind: proposal.kind,
            row_count: extra.length,
          });
        } catch {
          if (signal.aborted) signal.throwIfAborted();
          event('DataAgent', 'extra_evidence_unavailable', 'warn', {
            kind: proposal.kind,
          });
          extra = [];
        }
      }

      // Record source conflict in memory if P6 divergence fails.
      let conflicts = this.memory.conflictsFor(policy);
      if (probes.find(p => p.id === 'P6')?.status === 'fail' && evidence.satellite) {
        conflicts = this.memory.recordConflict(
          run_id,
          policy,
          normalizeSeries(evidence.station, policyWindow(policy)).total,
          normalizeSeries(evidence.satellite, policyWindow(policy)).total
        );
        event('Memory', 'record_conflict', 'warn', {
          memory_op: 'conflict',
          conflicts,
        });
      }
      result.memory.conflicts = conflicts;

      // Apply deterministic policy gate.
      let decision = policyGate({
        policy,
        ...evidence,
        proposal,
        memory_conflicts: conflicts,
        memory: {
          recalled: recalled.map(m => m.id),
          written: [],
          conflicts: conflicts.map(c => c.id),
        },
        rounds,
      });

      if (alteredWindow) {
        decision = {
          ...decision,
          inspection_question:
            'Confirm whether the requested event belongs to the existing contractual window or requires a separate policy review.',
          verdict: 'INSPECT',
          payout_ngn: 0,
          human_review_required: true,
          reasons: [
            ...decision.reasons,
            'Requested window differs from the contractual rainfall window. A human must review the request without changing the contractual index.',
          ],
        };
      }

      if (proposal.action === 'request_evidence') {
        decision = {
          ...decision,
          inspection_question:
            'Obtain the requested independent rainfall evidence for the contractual window and rerun the deterministic probes.',
          verdict: 'INSPECT',
          payout_ngn: 0,
          human_review_required: true,
          reasons: [
            ...decision.reasons,
            'The requested evidence remains unresolved after the permitted rounds.',
          ],
        };
      }

      event('PolicyGate', 'apply_contract', 'ok', {
        verdict: decision.verdict,
        payout_ngn: decision.payout_ngn,
      });

      // Write decision precedent and station reliability lesson to memory.
      const written = [
        this.memory.writePrecedent(run_id, claim, policy, decision),
        this.memory.writeStationLesson(run_id, policy, decision.probes),
      ];
      result.memory.written = written;
      decision.memory.written = written;
      event('Memory', 'write_precedent_and_lesson', 'ok', {
        memory_op: 'write',
        memory_ids: written,
      });
      this.memory.exportLedger(
        path.join(path.dirname(trace.logFile), `${run_id}.ledger.jsonl`)
      );

      // Generate reporter explanation prose.
      const report = await modelJson(
        model,
        'ReporterAgent',
        {
          decision,
          contract: {
            summary:
              'plain prose without numbers; final financial terms come from the decision',
          },
        },
        z.object({
          summary: z.string().refine(s => !/[0-9]/.test(s)),
        }),
        () => ({
          summary: 'Review the attached evidence and policy decision.',
        }),
        signal
      );
      event('ReporterAgent', 'report_decision');

      const labels = {
        PAY: 'Pay',
        PAY_ANYWAY: 'Pay anyway',
        INSPECT: 'Send an inspector',
        NO_PAY: 'Do not pay: human review required',
      };

      result.output = {
        decision,
        probes: decision.probes,
        naive: decision.naive,
        card: {
          title: labels[decision.verdict],
          payout_ngn: decision.payout_ngn,
          index_source: decision.index_source,
          index_mm: decision.index_mm,
          reasons: decision.reasons.slice(0, 3),
          human_review_required: decision.human_review_required,
          inspection_question: decision.inspection_question,
        },
        letter_markdown:
          `${labels[decision.verdict]}\n\nClaim ${claim.claim_id} for ${policy.group_name}. Policies and claims are synthetic.\n\n` +
          `Calculated payout: NGN ${decision.payout_ngn.toFixed(2)}. Index: ${
            decision.index_mm === null
              ? 'not selected'
              : `${decision.index_mm.toFixed(1)} mm`
          } (${decision.index_source}).\n\n` +
          `${decision.reasons.join('\n\n')}\n\n` +
          `${decision.inspection_question ? `Inspection question: ${decision.inspection_question}\n\n` : ''}` +
          `Reviewer explanation: ${report.summary}` +
          `${decision.counter_case ? `\n\nCase for paying: ${decision.counter_case}` : ''}\n\n` +
          `No funds have been transferred.`,
        evidence,
        policy,
        claim,
      };
      result.status = 'success';
    } catch {
      if (policy && claim && evidence) {
        const decision = policyGate({
          policy,
          ...evidence,
          proposal: { action: 'decide', proposed_source: 'none' },
        });
        decision.verdict = 'INSPECT';
        decision.inspection_question =
          'Complete the missing evidence and reconcile the rainfall records for the contractual window before settlement.';
        decision.payout_ngn = 0;
        decision.human_review_required = true;
        decision.reasons.push('Run incomplete; human inspection is required.');
        result.output = {
          decision,
          probes: decision.probes,
          naive: decision.naive,
          card: { title: 'Send an inspector' },
          letter_markdown:
            'This run could not complete. Review the available evidence before deciding.',
          evidence,
          policy,
          claim,
        };
        result.status = 'partial';
      }
      result.error = {
        type: signal.aborted ? 'budget_exhausted' : 'run_error',
        message: signal.aborted
          ? 'The run budget ended. Review available evidence.'
          : 'The run could not complete. Check policy selection and data/model adapter availability.',
        recoverable: true,
      };
      event('Orchestrator', 'run_incomplete', 'partial');
    }

    result.execution_time_seconds = (Date.now() - started) / 1000;
    this.runs.set(run_id, result);
    return result;
  }
}
