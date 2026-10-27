import { randomUUID } from 'node:crypto';
import type { QueryAdapter } from '../adapters/contracts.js';
import { DataAgent } from '../agents/data.js';
import { policyGate } from '../agents/policyGate.js';
import { policyTerms, probeSummaries } from '../agents/modelPayloads.js';
import type { PluviaMemory } from '../memory/pluviaMemory.js';
import { runProbes } from '../probes/index.js';
import type { Claim, DailySeries, Decision, Policy } from '../types.js';
import { CaseStore, readReplay, type Case, type CaseEvent, type PlanStep, type Segment } from './cases.js';
import { guardSql } from './sqlGuard.js';
import type { WatchCase } from './watcher.js';

// Payouts above this need a person; so does every refusal and every inspection close-out.
export const SIGNOFF_ABOVE_NGN = 1_000_000;
const STEP_BUDGET = 24;
const RESUME_BUDGET = 10;
const MESSAGE_BUDGET = 10;
const PLAN_STEPS = 10;
// Turns spent only on the plan don't use up the step budget, up to this many.
const PLAN_TURNS = 20;

export interface ModelRoute {
  url: string;
  token: string;
  primary: string;
  fallback: string;
}

export type Message = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
type ToolCall = { id: string; type?: 'function'; function: { name: string; arguments: string } };

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const text = { type: 'string' };
const TOOLS = [
  fn('set_plan', 'Write your plan for the case before anything else, or rewrite it when the evidence changes your course. Give the reason for every rewrite.', {
    steps: { type: 'array', items: { type: 'object', properties: { text, status: { type: 'string', enum: ['todo', 'doing', 'done', 'dropped'] } }, required: ['text'] } },
    reason: { type: 'string', description: 'Why the plan changed. Required when rewriting.' },
  }, ['steps']),
  fn('mark_step', 'Mark one step of your plan as started, done or dropped. Dropping a step needs a note saying why.', {
    step: { type: 'integer', description: 'The step number, from 1' },
    status: { type: 'string', enum: ['doing', 'done', 'dropped'] },
    note: text,
  }, ['step', 'status']),
  fn('reply_to_officer', 'Answer the claims officer. Find the answer with your other tools first; quote the figures you found.', { text }, ['text']),
  fn('list_tables', 'List the rainfall views you can query.'),
  fn('describe_table', 'Show the columns of one view.', { table: text }, ['table']),
  fn('sql_query', 'Run one read-only SELECT over the pluvia views. Returns a summary and up to 30 rows.', { sql: text }, ['sql']),
  fn('run_checks', "Run the eight record checks on the policy's gauge and satellite series for the cover window."),
  fn('recall_station', 'Read what memory holds about this station from earlier cases.'),
  fn('propose_settlement', 'Propose how to settle. The policy gate checks it with the contract evidence and answers with the verdict and payout it allows. To argue that the satellite should settle a disagreement, cite figures with the exact SQL that produces each one; the code reruns them.', {
    verdict: { type: 'string', enum: ['PAY', 'PAY_ANYWAY', 'NO_PAY', 'INSPECT'] },
    source: { type: 'string', enum: ['ghcn', 'power'], description: 'ghcn for the gauge, power for the satellite' },
    rationale: text,
    counter_case: { type: 'string', description: 'The strongest case for paying. Required to refuse.' },
    figures: { type: 'array', items: { type: 'object', properties: { label: text, sql: text, value: { type: 'number' } }, required: ['label', 'sql', 'value'] } },
  }, ['verdict', 'rationale']),
  fn('open_inspection', 'Send an inspector to the farm. Name the exact dates and readings to verify.', { dates: { type: 'array', items: text }, instructions: text }, ['dates', 'instructions']),
  fn('draft_letter', 'Write the letter to the farmer group about the outcome.', { body: text }, ['body']),
  fn('notify_operator', 'Tell the station operator about a gauge fault, naming the dates.', { body: text }, ['body']),
  fn('request_signoff', 'Ask a claims officer to approve before the payout or refusal takes effect.', { summary: text }, ['summary']),
  fn('escalate', 'Hand the case to a person with one precise question.', { question: text }, ['question']),
  fn('finish_case', 'End your work on this case with a two-sentence summary.', { summary: text }, ['summary']),
];

const SYSTEM = `You are Pluvia's claims agent for weather-index crop insurance. Your goal is to settle each claim correctly or hand it to a person with one precise question.

How you work:
- Before anything else, write your plan with set_plan: the steps you will take for this claim, in order. Mark each step with mark_step as you start and finish it, in the same turn as the tool calls that do the work. When something you find changes your course, rewrite the plan with set_plan and say why.
- Investigate before deciding. Discover the views, write your own SQL, and do every sum and count in SQL, never in your head. Use GROUP BY to get many totals in one query rather than one query each.
- Views ending _prior_daily hold earlier years of the same satellite series, for comparing this season with past ones.
- The gauge record decides the claim unless it is unfit. Find the days the gauge was silent, look for zero readings on days the satellite saw rain, and check how the satellite compares with earlier years at the same place.
- propose_settlement is checked by the policy gate, which computes the payout from the contract. You cannot raise a payout. If you argue the satellite should settle a disagreement, cite each figure with the exact SQL that produces it; the code reruns your SQL and compares.
- After the gate answers, act on it: open an inspection naming the dates, request sign-off where it says one is needed, write to the farmer group, and tell the station operator about a failing gauge.
- Payouts above NGN ${SIGNOFF_ABOVE_NGN.toLocaleString('en')}, every refusal and every inspection close-out need a claims officer's sign-off.
- The claims officer can write to you at any point. Answer with reply_to_officer after checking with your tools, act on any instruction, then carry on. If they ask for something the data cannot show, say so plainly.
- End with finish_case. Write plainly and briefly; a claims officer reads every step.`;

const now = () => new Date().toISOString();
const round = (n: number) => Math.round(n * 100) / 100;

// Compact view of query rows: count, numeric ranges and a sample, so the model never reads thousands of rows.
function summarise(rows: Record<string, unknown>[]) {
  const columns = Object.keys(rows[0] ?? {});
  const numeric: Record<string, { min: number; max: number; sum: number }> = {};
  for (const column of columns) {
    const values = rows.map(r => r[column]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length === rows.length && values.length) {
      numeric[column] = { min: round(Math.min(...values)), max: round(Math.max(...values)), sum: round(values.reduce((a, b) => a + b, 0)) };
    }
  }
  return { row_count: rows.length, columns, numeric, rows: rows.slice(0, 30) };
}

// Every number in the first row of a result; a cited figure must equal one of them.
function firstRowNumbers(rows: Record<string, unknown>[]): number[] {
  return Object.values(rows[0] ?? {})
    .map(value => (typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN))
    .filter(Number.isFinite);
}

interface Context {
  claim: Claim;
  policy: Policy;
  series?: { station: DailySeries; satellite: DailySeries | null };
  proposals: number;
}

export class CaseAgent {
  private data: DataAgent;
  private running = new Set<string>();

  constructor(
    private deps: {
      query: QueryAdapter;
      memory: PluviaMemory;
      store: CaseStore;
      model?: ModelRoute;
      replayDirectory: string;
      live: boolean;
      // What the station watcher found before the claim arrived.
      watch?: (stationId: string) => WatchCase[];
      // Replaces the Nightshift call, for tests.
      chat?: (messages: Message[]) => Promise<{ message: Message; model: string }>;
    }
  ) {
    this.data = new DataAgent(deps.query);
  }

  get store() {
    return this.deps.store;
  }

  isRunning(id: string) {
    return this.running.has(id);
  }

  private async context(claimId: string): Promise<Context> {
    const claim = (await this.data.claims()).find(c => c.claim_id === claimId);
    if (!claim) throw new Error('This claim is not in the register.');
    const policy = (await this.data.policies()).find(p => p.policy_id === claim.policy_id);
    if (!policy) throw new Error('The policy for this claim is not in the register.');
    return { claim, policy, proposals: 0 };
  }

  private log(item: Case, event: Omit<CaseEvent, 'at'>) {
    item.events.push({ at: now(), ...event });
    this.deps.store.save(item);
  }

  // Starts a case. Live, the agent works in the background and the case fills in as it goes;
  // otherwise a recorded live investigation of the same claim is replayed.
  async start(claimId: string): Promise<Case> {
    const ctx = await this.context(claimId);
    if (!this.deps.live) {
      const recorded = readReplay(this.deps.replayDirectory, claimId);
      const first = recorded?.segments.find(seg => seg.trigger === 'start');
      if (!recorded || !first?.snapshot) throw new Error('No recorded investigation exists for this claim.');
      const copy: Case = {
        id: `case_${randomUUID().slice(0, 8)}`,
        claim_id: claimId,
        policy_id: recorded.policy_id,
        created_at: now(),
        updated_at: now(),
        replay: {
          recorded_at: recorded.created_at,
          source_case: recorded.id,
          report: recorded.inspection?.report?.text,
          questions: recorded.segments.filter(seg => seg.trigger === 'message').map(seg => seg.input ?? ''),
          played: 0,
        },
        models: recorded.models,
        steps_used: recorded.steps_used,
        segments: [],
        evidence: recorded.evidence,
        watch: recorded.watch,
        events: recorded.events.slice(0, first.to_event).map(e => ({ ...e })),
        ...structuredClone(first.snapshot),
      };
      return this.deps.store.save(copy);
    }
    const item: Case = {
      id: `case_${randomUUID().slice(0, 8)}`,
      claim_id: claimId,
      policy_id: ctx.policy.policy_id,
      state: 'investigating',
      created_at: now(),
      updated_at: now(),
      models: [],
      steps_used: 0,
      events: [],
      segments: [],
      outbox: [],
    };
    const watch = this.deps.watch?.(ctx.policy.ref_station_id) ?? [];
    if (watch.length) item.watch = watch.map(w => ({ id: w.id, station_id: w.station_id, station_name: w.station_name, opened_on: w.opened_on }));
    this.log(item, { kind: 'start', summary: `Opened the case for ${ctx.policy.group_name.replace(/ \(synthetic\)$/, '')}.` });
    const segment: Segment = { trigger: 'start', messages: [], from_event: 0 };
    item.segments.push(segment);
    const briefing = {
      claim: { claim_id: ctx.claim.claim_id, statement: ctx.claim.event_text },
      policy: policyTerms(ctx.policy),
      sum_insured_ngn: ctx.policy.sum_insured_ngn,
      farm: { lat: ctx.policy.farm_lat, lon: ctx.policy.farm_lon },
      watch_cases: watch,
    };
    const messages: Message[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `New claim. Investigate it and carry it through.\n${JSON.stringify(briefing)}` },
    ];
    void this.loop(item, ctx, messages, segment, STEP_BUDGET);
    return item;
  }

  // A person submits the inspector's report; the agent reads it and resumes the case.
  async inspectionReport(id: string, report: string): Promise<Case> {
    const item = this.mustGet(id);
    if (item.state !== 'inspection_open' || !item.inspection) throw new Error('This case has no open inspection.');
    // A replay continues from the report the live agent was given.
    const text = item.replay?.report ?? report;
    item.inspection.report = { at: now(), text };
    item.state = 'investigating';
    this.log(item, { kind: 'person', summary: 'The inspector’s report arrived.', input: text });
    if (!this.deps.live) {
      return this.replaySegment(item, 'inspection_report');
    }
    const ctx = await this.context(item.claim_id);
    const segment: Segment = { trigger: 'inspection_report', input: report, messages: [], from_event: item.events.length };
    item.segments.push(segment);
    const prior = item.segments[0]?.messages as Message[] | undefined;
    const messages: Message[] = [
      ...(prior ?? [{ role: 'system', content: SYSTEM }]),
      { role: 'user', content: `The inspector's report has arrived:\n${report}\nRead it, settle the claim through propose_settlement, and finish. Closing an inspection needs sign-off.` },
    ];
    void this.loop(item, ctx, messages, segment, RESUME_BUDGET);
    return item;
  }

  // The officer asks or instructs. Mid-run, the agent reads it before its next step; at rest, it wakes to answer and carries on.
  async message(id: string, text: string): Promise<Case> {
    const item = this.mustGet(id);
    if (!this.deps.live && item.replay) return this.replayMessage(item);
    this.log(item, { kind: 'officer', summary: text });
    if (this.running.has(id)) {
      item.inbox = [...(item.inbox ?? []), text];
      return this.deps.store.save(item);
    }
    if (!this.deps.live) {
      this.log(item, { kind: 'note', summary: 'The agent needs the live services to answer. Run Pluvia live to continue.' });
      return item;
    }
    const ctx = await this.context(item.claim_id);
    if (item.state === 'failed') item.state = 'investigating';
    const segment: Segment = { trigger: 'message', input: text, messages: [], from_event: item.events.length - 1 };
    const prior = item.segments.at(-1)?.messages as Message[] | undefined;
    item.segments.push(segment);
    const messages: Message[] = [...(prior ?? [{ role: 'system', content: SYSTEM }]), { role: 'user', content: officerNote(text, true) }];
    void this.loop(item, ctx, messages, segment, MESSAGE_BUDGET);
    return item;
  }

  // A replay answers with the next question the officer put to the live agent, and what followed.
  private replayMessage(item: Case): Case {
    const recorded = readReplay(this.deps.replayDirectory, item.claim_id);
    const played = item.replay!.played ?? 0;
    const segment = recorded?.segments.filter(seg => seg.trigger === 'message')[played];
    if (!recorded || !segment?.snapshot) {
      this.log(item, { kind: 'note', summary: 'The recorded investigation has no further questions. Run Pluvia live to ask your own.' });
      return item;
    }
    item.replay!.played = played + 1;
    item.events.push(...recorded.events.slice(segment.from_event, segment.to_event).map(e => ({ ...e, at: now() })));
    Object.assign(item, structuredClone(segment.snapshot));
    return this.deps.store.save(item);
  }

  // A claims officer approves or declines what the agent asked them to sign.
  async signoff(id: string, approve: boolean, note?: string): Promise<Case> {
    const item = this.mustGet(id);
    if (item.state !== 'awaiting_signoff' || !item.signoff) throw new Error('Nothing on this case is waiting for sign-off.');
    item.signoff = { ...item.signoff, status: approve ? 'approved' : 'declined', note, at: now() };
    if (approve) {
      item.state = item.decision?.verdict === 'NO_PAY' ? 'closed' : 'settled';
      if (item.payment && item.payment.amount_ngn > 0) item.payment.status = 'released';
      item.outbox.forEach(m => (m.status = 'sent'));
      this.log(item, { kind: 'person', summary: `A claims officer approved${note ? `: ${note}` : '.'}` });
    } else {
      item.state = 'escalated';
      this.log(item, { kind: 'person', summary: `A claims officer declined${note ? `: ${note}` : '.'} The case is back with a person.` });
    }
    return this.deps.store.save(item);
  }

  private mustGet(id: string): Case {
    const item = this.deps.store.get(id);
    if (!item) throw new Error('This case does not exist.');
    return item;
  }

  // Replays the recorded stretch of work that followed this person's action in the source case.
  private replaySegment(item: Case, trigger: Segment['trigger']): Case {
    const recorded = readReplay(this.deps.replayDirectory, item.claim_id);
    const seg = recorded?.segments.find(x => x.trigger === trigger);
    if (!recorded || !seg?.snapshot) {
      this.log(item, { kind: 'note', summary: 'The recorded investigation does not cover this step. Run Pluvia live to continue.' });
      return item;
    }
    item.events.push(...recorded.events.slice(seg.from_event, seg.to_event).filter(e => e.kind !== 'person').map(e => ({ ...e, at: now() })));
    const report = item.inspection?.report;
    Object.assign(item, structuredClone(seg.snapshot));
    if (report && item.inspection) item.inspection.report = report;
    return this.deps.store.save(item);
  }

  private async callModel(messages: Message[]): Promise<{ message: Message; model: string }> {
    if (this.deps.chat) return this.deps.chat(messages);
    const route = this.deps.model!;
    let last = '';
    for (const model of [route.primary, route.fallback]) {
      try {
        const response = await fetch(`${route.url}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${route.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 1500, temperature: 0.2 }),
          signal: AbortSignal.timeout(180_000),
        });
        const body = (await response.json().catch(() => ({}))) as { choices?: { message?: Message }[]; model?: string; error?: { message?: string } };
        const message = body.choices?.[0]?.message;
        if (response.ok && message) return { message, model: body.model ?? model };
        last = body.error?.message ?? `HTTP ${response.status}`;
      } catch (error) {
        last = String(error);
      }
    }
    throw new Error(`The model did not answer: ${last.slice(0, 160)}`);
  }

  private async loop(item: Case, ctx: Context, messages: Message[], segment: Segment, budget: number) {
    this.running.add(item.id);
    let planTurns = 0;
    try {
      for (let step = 0; step < budget; step++) {
        for (const text of item.inbox?.splice(0) ?? []) messages.push({ role: 'user', content: officerNote(text, false) });
        const { message, model } = await this.callModel(messages);
        if (!item.models.includes(model)) item.models.push(model);
        const assistant: Message = { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls };
        messages.push(assistant);
        segment.messages = messages;
        item.steps_used++;
        const note = (message.content ?? '').replace(/<\/?think>/g, '').trim();
        if (note) this.log(item, { kind: 'thought', summary: note.slice(0, 600), model });
        const calls = message.tool_calls ?? [];
        if (!calls.length) {
          messages.push({ role: 'user', content: 'Continue by calling a tool. End with finish_case when the case is carried through.' });
          continue;
        }
        if (calls.every(call => ['set_plan', 'mark_step'].includes(call.function.name)) && planTurns++ < PLAN_TURNS) step--;
        let finished = false;
        for (const call of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }
          const result = await this.tool(item, ctx, call.function.name, args).catch(error => ({ error: String(error?.message ?? error) }));
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
          if (call.function.name === 'finish_case' && !(result as { error?: string }).error) finished = true;
        }
        this.deps.store.save(item);
        // A message that arrived during the last step still gets answered.
        if (finished && !item.inbox?.length) return;
      }
      item.state = 'escalated';
      this.log(item, { kind: 'note', summary: 'The agent reached its step budget. The case is with a person, with everything it found so far.' });
    } catch (error) {
      item.state = 'failed';
      this.log(item, { kind: 'note', summary: `The investigation stopped: ${String((error as Error).message ?? error)}` });
    } finally {
      segment.to_event = item.events.length;
      const { state, decision, proposal, inspection, signoff, payment, outbox, summary, plan } = item;
      segment.snapshot = structuredClone({ state, decision, proposal, inspection, signoff, payment, outbox, summary, plan });
      this.running.delete(item.id);
      this.deps.store.save(item);
    }
  }

  private async series(ctx: Context, item?: Case) {
    ctx.series ??= await this.data.fetch(ctx.policy);
    if (item && !item.evidence) item.evidence = ctx.series;
    return ctx.series;
  }

  private async tool(item: Case, ctx: Context, name: string, args: Record<string, unknown>): Promise<unknown> {
    const record = (summary: string, input: unknown, output: unknown, kind: CaseEvent['kind'] = 'tool') => {
      this.log(item, { kind, tool: name, input, output, summary });
      return output;
    };
    if (!item.plan && !['set_plan', 'reply_to_officer'].includes(name)) {
      return record('Refused: no plan yet.', args, { error: 'Write your plan with set_plan before anything else.' });
    }
    switch (name) {
      case 'set_plan': {
        const steps = (Array.isArray(args.steps) ? args.steps : [])
          .slice(0, PLAN_STEPS)
          .map(s => (typeof s === 'string' ? { text: s } : (s as Record<string, unknown>)))
          .map((s): PlanStep => ({ text: String(s.text ?? '').slice(0, 300), status: ['doing', 'done', 'dropped'].includes(String(s.status)) ? (s.status as PlanStep['status']) : 'todo' }))
          .filter(s => s.text);
        if (!steps.length) return record('Refused an empty plan.', args, { error: 'Give at least one step.' });
        const reason = String(args.reason ?? '').trim();
        const revising = Boolean(item.plan);
        if (revising && !reason) return record('Refused a new plan without a reason.', args, { error: 'Say why the plan changed.' });
        item.plan = item.plan ? { steps, revisions: [...item.plan.revisions, { at: now(), reason }] } : { steps, revisions: [] };
        return record(revising ? `Changed course: ${reason}` : `Wrote a plan of ${steps.length} steps.`, args, { ok: true, plan: steps.map((s, i) => `${i + 1}. [${s.status}] ${s.text}`) }, 'plan');
      }
      case 'mark_step': {
        const index = Number(args.step) - 1;
        const step = item.plan!.steps[index];
        if (!step) return record('Refused: no such step.', args, { error: `The plan has steps 1 to ${item.plan!.steps.length}.` });
        const status = String(args.status);
        if (!['doing', 'done', 'dropped'].includes(status)) return record('Refused a step status.', args, { error: 'Use doing, done or dropped.' });
        const note = String(args.note ?? '').trim();
        if (status === 'dropped' && !note) return record('Refused to drop a step without a reason.', args, { error: 'Say why the step is dropped.' });
        step.status = status as PlanStep['status'];
        if (note) step.note = note.slice(0, 300);
        const verb = { doing: 'Started', done: 'Finished', dropped: 'Dropped' }[status];
        return record(`${verb} step ${index + 1}: ${step.text}${note ? ` (${note})` : ''}`, args, { ok: true }, 'plan');
      }
      case 'reply_to_officer': {
        const answer = String(args.text ?? '').trim();
        if (!answer) return record('Refused an empty reply.', args, { error: 'Write the answer.' });
        this.log(item, { kind: 'reply', summary: answer.slice(0, 2000) });
        return { ok: true };
      }
      case 'list_tables': {
        const rows = await this.deps.query.query('SHOW TABLES FROM pluvia');
        const tables = rows.map(r => String(r.table_identifier ?? r.tableName ?? Object.values(r)[0]).toLowerCase());
        return record(`Listed ${tables.length} views.`, {}, { tables: tables.map(t => `pluvia.${t}`) });
      }
      case 'describe_table': {
        const table = String(args.table ?? '').replace(/^pluvia\./i, '');
        if (!/^[a-z0-9_]+$/i.test(table)) return record('Refused a table name.', args, { error: 'Give a plain view name.' });
        const rows = await this.deps.query.query(`DESCRIBE pluvia.${table}`);
        return record(`Read the columns of ${table}.`, args, { columns: rows.map(r => `${r.col_name} ${r.data_type}`) });
      }
      case 'sql_query': {
        const guarded = guardSql(String(args.sql ?? ''));
        if (!guarded.ok) return record(`Refused a query: ${guarded.reason}`, args, { error: guarded.reason });
        try {
          const rows = await this.deps.query.query(guarded.sql, { limit: 2000 });
          const summary = summarise(rows);
          return record(`Ran a query; ${summary.row_count} rows.`, { sql: guarded.sql }, summary);
        } catch (error) {
          const detail = String((error as { detail?: string }).detail ?? (error as Error).message).slice(0, 400);
          return record('A query failed; the error went back to the agent.', { sql: guarded.sql }, { error: detail });
        }
      }
      case 'run_checks': {
        const { station, satellite } = await this.series(ctx, item);
        const probes = runProbes({ policy: ctx.policy, station, satellite });
        const failed = probes.filter(p => p.status !== 'pass').map(p => p.id);
        return record(`Ran the eight record checks; ${failed.length ? `${failed.join(', ')} did not pass` : 'all passed'}.`, {}, { checks: probeSummaries(probes) });
      }
      case 'recall_station': {
        const memories = this.deps.memory.recall(ctx.policy);
        return record(memories.length ? `Recalled ${memories.length} lessons about this station.` : 'Memory holds nothing yet about this station.', {}, { memories });
      }
      case 'propose_settlement':
        return this.propose(item, ctx, args, record);
      case 'open_inspection': {
        if (item.decision?.verdict !== 'INSPECT') return record('Refused: no inspection decision yet.', args, { error: 'Propose a settlement first; open an inspection only when the gate sends the claim to inspection.' });
        const dates = Array.isArray(args.dates) ? args.dates.map(String).slice(0, 62) : [];
        item.inspection = { opened_at: now(), dates, instructions: String(args.instructions ?? '') };
        item.state = 'inspection_open';
        item.payment = { amount_ngn: 0, status: 'held' };
        return record(`Opened an inspection covering ${dates.length} dates; payment is held.`, args, { ok: true, state: item.state }, 'action');
      }
      case 'draft_letter': {
        const held = item.state === 'awaiting_signoff';
        item.outbox.push({ to: 'farmer_group', body: String(args.body ?? ''), status: held ? 'held' : 'sent', at: now() });
        return record(held ? 'Wrote to the farmer group; held until sign-off.' : 'Wrote to the farmer group.', args, { ok: true }, 'action');
      }
      case 'notify_operator': {
        item.outbox.push({ to: 'station_operator', body: String(args.body ?? ''), status: 'sent', at: now() });
        return record('Told the station operator about the gauge.', args, { ok: true }, 'action');
      }
      case 'request_signoff': {
        if (!item.decision || (item.decision.verdict === 'INSPECT' && !item.inspection?.report)) return record('Refused: nothing to sign yet.', args, { error: 'Sign-off follows a settlement the gate accepted. Propose one first.' });
        if (item.decision.verdict === 'INSPECT') return record('Refused: the gate still says inspect.', args, { error: 'The gate has not accepted a settlement. Propose again with figures that reproduce, or escalate.' });
        const needs = signoffReason(item);
        if (!needs) return record('Sign-off not needed.', args, { error: 'This outcome does not need sign-off.' });
        item.signoff = { reason: needs, summary: String(args.summary ?? ''), status: 'pending' };
        item.state = 'awaiting_signoff';
        item.outbox.forEach(m => m.to === 'farmer_group' && (m.status = 'held'));
        return record(`Asked a claims officer to sign off: ${needs}.`, args, { ok: true, state: item.state }, 'action');
      }
      case 'escalate': {
        item.state = 'escalated';
        return record('Handed the case to a person.', args, { ok: true }, 'action');
      }
      case 'finish_case': {
        const ready = ['inspection_open', 'awaiting_signoff', 'settled', 'escalated', 'closed'].includes(item.state);
        if (!ready) return record('Refused to finish: the case is not carried through yet.', args, { error: 'Act on the gate decision first: open an inspection, request sign-off, or settle.' });
        const first = item.summary === undefined;
        item.summary = String(args.summary ?? '');
        if (item.decision && first) {
          try {
            this.deps.memory.writePrecedent(item.id, ctx.claim, ctx.policy, item.decision);
            this.deps.memory.writeStationLesson(item.id, ctx.policy, item.decision.probes);
          } catch {
            // Memory is best effort; the case record holds everything.
          }
        }
        return record('Finished its work on the case.', args, { ok: true, state: item.state }, 'action');
      }
      default:
        return record(`Asked for an unknown tool ${name}.`, args, { error: 'Unknown tool.' });
    }
  }

  // Totals of the satellite for the policy window's days in every complete earlier year.
  private async priorContext(policy: Policy, satellite: DailySeries) {
    const view = policy.power_table.replace(/_daily$/, '_prior_daily');
    const from = policy.window_start.slice(5);
    const to = policy.window_end.slice(5);
    const days = Math.round((Date.parse(policy.window_end) - Date.parse(policy.window_start)) / 86_400_000) + 1;
    try {
      const rows = await this.deps.query.query(
        `SELECT year(obs_date) AS y, SUM(mm) AS total, COUNT(*) AS n FROM pluvia.${view} ` +
          `WHERE date_format(obs_date, 'MM-dd') BETWEEN '${from}' AND '${to}' GROUP BY year(obs_date)`
      );
      const totals = rows.filter(r => Number(r.n) === days).map(r => Number(r.total)).filter(Number.isFinite);
      const satelliteMm = round(satellite.days.reduce((sum, d) => sum + (Number.isFinite(d.mm) ? (d.mm as number) : 0), 0));
      if (totals.length < 10) return { years: totals.length, satellite_mm: satelliteMm, within: false, note: 'Fewer than ten complete earlier years.' };
      const min = round(Math.min(...totals));
      const max = round(Math.max(...totals));
      return { years: totals.length, min_mm: min, max_mm: max, satellite_mm: satelliteMm, within: satelliteMm >= min && satelliteMm <= max };
    } catch {
      return { years: 0, satellite_mm: undefined, within: false, note: 'No earlier years are available for this satellite series.' };
    }
  }

  private async propose(item: Case, ctx: Context, args: Record<string, unknown>, record: (s: string, i: unknown, o: unknown, k?: CaseEvent['kind']) => unknown) {
    if (item.payment?.status === 'released') return record('Refused: the payment was already released.', args, { error: 'This case is settled and paid. Escalate if you believe the settlement was wrong.' });
    if (++ctx.proposals > 3) return record('Refused a fourth proposal.', args, { error: 'Three proposals are the limit. Escalate the case.' });
    // A new proposal replaces whatever was waiting for sign-off.
    if (item.signoff?.status === 'pending') {
      item.signoff = undefined;
      item.state = 'investigating';
    }
    const verdict = String(args.verdict ?? 'INSPECT');
    const source = args.source === 'power' ? 'power' : 'ghcn';
    const rationale = String(args.rationale ?? '');

    // Rerun every figure the agent cited and compare.
    const figures = Array.isArray(args.figures) ? (args.figures as { label?: string; sql?: string; value?: number }[]).slice(0, 8) : [];
    const checked = [] as { label: string; claimed: number; reproduced?: number; match: boolean; reason?: string }[];
    for (const figure of figures) {
      const guarded = guardSql(String(figure.sql ?? ''));
      const claimed = Number(figure.value);
      if (!guarded.ok) {
        checked.push({ label: String(figure.label), claimed, match: false, reason: guarded.reason });
        continue;
      }
      try {
        const values = firstRowNumbers(await this.deps.query.query(guarded.sql, { limit: 50 }));
        const reproduced = values.find(v => Math.abs(v - claimed) <= 0.1) ?? values[0];
        const match = reproduced !== undefined && Math.abs(reproduced - claimed) <= 0.1;
        checked.push({ label: String(figure.label), claimed, reproduced, match });
      } catch (error) {
        checked.push({ label: String(figure.label), claimed, match: false, reason: String((error as Error).message) });
      }
    }
    const { station, satellite } = await this.series(ctx, item);
    // The code checks the argument itself: the satellite's total for the window must sit inside its
    // own range for the same weeks of earlier years before it can settle a disagreement.
    const context = source === 'power' && satellite ? await this.priorContext(ctx.policy, satellite) : undefined;
    const verified = checked.length > 0 && checked.every(c => c.match) && context?.within === true;

    const gate = policyGate({
      policy: ctx.policy,
      station,
      satellite,
      proposal: { action: 'decide', proposed_source: source, rationale, counter_case: typeof args.counter_case === 'string' ? args.counter_case : undefined },
      memory_conflicts: this.deps.memory.conflictsFor(ctx.policy),
      resolution: source === 'power'
        ? { verified, summary: context ? `satellite ${context.satellite_mm} mm against ${context.years} earlier years ranging ${context.min_mm} to ${context.max_mm} mm` : 'no prior-year context' }
        : undefined,
    });

    // The gate decides the money. The agent can only make the outcome more careful.
    let decision: Decision = gate;
    if (verdict === 'INSPECT' && gate.verdict !== 'INSPECT') {
      decision = { ...gate, verdict: 'INSPECT', payout_ngn: 0, human_review_required: true, reasons: [`The agent asked for an inspection: ${rationale}`, ...gate.reasons] };
    }
    const downgraded = verdict !== decision.verdict && decision.verdict === 'INSPECT';
    item.decision = decision;
    item.proposal = { verdict, source, rationale, figures_verified: figures.length ? verified : undefined };
    item.payment = { amount_ngn: decision.payout_ngn, status: decision.payout_ngn > 0 && !signoffReason(item) ? 'released' : decision.payout_ngn > 0 ? 'held' : 'none' };
    if (decision.verdict !== 'INSPECT' && !signoffReason(item)) item.state = 'settled';

    const failed = checked.filter(c => !c.match);
    const next =
      decision.verdict === 'INSPECT' && source === 'power' && failed.length
        ? `These figures did not reproduce: ${failed.map(f => `${f.label} (you said ${f.claimed}; your query returned ${f.reproduced ?? (f.reason || 'nothing')})`).join('; ')}. Every cited figure must come from one SQL query that returns it. Correct or drop them and propose again, or open an inspection.`
        : decision.verdict === 'INSPECT' && source === 'power' && context && !context.within
          ? 'The satellite total is outside its own range for earlier years, so it cannot settle the disagreement. Open an inspection naming the dates to verify.'
          : decision.verdict === 'INSPECT'
        ? 'Open an inspection naming the exact dates to verify, tell the operator if the gauge failed, write to the group, then finish.'
        : signoffReason(item)
          ? `This needs sign-off (${signoffReason(item)}). Request it, write to the group, then finish.`
          : 'The payout is released. Write to the group, tell the operator if the gauge failed, then finish.';
    const label = { PAY: 'Pay', PAY_ANYWAY: 'Pay anyway', NO_PAY: 'Do not pay', INSPECT: 'Inspect' }[decision.verdict];
    return record(
      downgraded
        ? `Proposed ${verdict}; the gate sent it to inspection.`
        : `Proposed ${verdict}; the gate agreed: ${label}, NGN ${decision.payout_ngn.toLocaleString('en')}.`,
      args,
      { verdict: decision.verdict, payout_ngn: decision.payout_ngn, index_source: decision.index_source, index_mm: decision.index_mm, reasons: decision.reasons.slice(0, 6), figures: checked, prior_years: context, next },
      'decision'
    );
  }
}

function signoffReason(item: Case): string | undefined {
  const d = item.decision;
  if (!d) return undefined;
  if (d.verdict === 'NO_PAY') return 'a refusal';
  if (item.inspection?.report) return 'closing an inspection';
  if (d.payout_ngn > SIGNOFF_ABOVE_NGN) return `a payout above NGN ${SIGNOFF_ABOVE_NGN.toLocaleString('en')}`;
  return undefined;
}

function officerNote(text: string, atRest: boolean): string {
  return `The claims officer writes: ${JSON.stringify(text)}\nAnswer with reply_to_officer after checking with your tools, act on it if it is an instruction, then ${atRest ? 'finish_case' : 'carry on with the case'}.`;
}
