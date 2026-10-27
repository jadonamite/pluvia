import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZetarisSampleAdapter } from '../app/adapters/zetarisSample.js';
import { lagosData } from './lagosData.js';
import { PluviaMemory } from '../app/memory/pluviaMemory.js';
import { CaseAgent, type Message } from '../app/agent/caseAgent.js';
import { CaseStore } from '../app/agent/cases.js';

// A scripted model: each turn calls the next tool in the list.
function scripted(steps: [string, Record<string, unknown>][]) {
  let i = 0;
  return async (_messages: Message[]) => {
    const [name, args] = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return { model: 'scripted', message: { role: 'assistant', content: `Calling ${name}.`, tool_calls: [{ id: `call_${i}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] } };
  };
}

const PLAN: [string, Record<string, unknown>] = ['set_plan', { steps: [{ text: 'Check the gauge record' }, { text: 'Propose a settlement' }] }];

function agentWith(chat: ReturnType<typeof scripted>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-agent-'));
  return new CaseAgent({
    query: new ZetarisSampleAdapter({ dataDirectory: lagosData() }),
    memory: new PluviaMemory(path.join(dir, 'memory')),
    store: new CaseStore(path.join(dir, 'cases')),
    replayDirectory: path.join(dir, 'replays'),
    live: true,
    chat,
  });
}

async function settle(agent: CaseAgent, id: string) {
  for (let i = 0; i < 200 && agent.isRunning(id); i++) await new Promise(r => setTimeout(r, 25));
  return agent.store.get(id)!;
}

describe('the claims agent', () => {
  it('cannot finish before acting, and the gate sends an unfit gauge to inspection with payment held', async () => {
    const agent = agentWith(scripted([
      PLAN,
      ['run_checks', {}],
      ['finish_case', { summary: 'Too early.' }],
      ['propose_settlement', { verdict: 'PAY', source: 'ghcn', rationale: 'The gauge shows a dry July.' }],
      ['open_inspection', { dates: ['2025-07-02', '2025-07-03'], instructions: 'Check the silent days.' }],
      ['notify_operator', { body: 'The gauge was silent on 21 days.' }],
      ['finish_case', { summary: 'Sent to inspection.' }],
    ]));
    const item = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    expect(item.events.some(e => e.summary.startsWith('Refused to finish'))).toBe(true);
    expect(item.decision?.verdict).toBe('INSPECT');
    expect(item.state).toBe('inspection_open');
    expect(item.payment).toEqual({ amount_ngn: 0, status: 'held' });
    expect(item.outbox.map(m => m.to)).toEqual(['station_operator']);
    expect(item.summary).toBe('Sent to inspection.');
  });

  it('refuses SQL that writes, and records the refusal in the case', async () => {
    const agent = agentWith(scripted([
      PLAN,
      ['sql_query', { sql: 'DROP VIEW pluvia.claims' }],
      ['escalate', { question: 'Stop here.' }],
      ['finish_case', { summary: 'Escalated.' }],
    ]));
    const item = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    expect(item.events.some(e => e.summary.startsWith('Refused a query'))).toBe(true);
    expect(item.state).toBe('escalated');
  });

  it('cannot open an inspection or ask for sign-off before the gate has answered', async () => {
    const agent = agentWith(scripted([
      PLAN,
      ['open_inspection', { dates: [], instructions: 'x' }],
      ['request_signoff', { summary: 'x' }],
      ['escalate', { question: 'x' }],
      ['finish_case', { summary: 'x' }],
    ]));
    const item = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    expect(item.events.filter(e => e.summary.startsWith('Refused')).length).toBe(2);
    expect(item.inspection).toBeUndefined();
  });

  it('releases a held payout only when a claims officer approves', async () => {
    const agent = agentWith(scripted([PLAN, ['escalate', { question: 'x' }], ['finish_case', { summary: 'x' }]]));
    const item = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    Object.assign(item, {
      state: 'awaiting_signoff',
      decision: { ...(item.decision ?? {}), verdict: 'PAY', payout_ngn: 2_500_000 },
      signoff: { reason: 'a payout above NGN 1,000,000', summary: 'x', status: 'pending' },
      payment: { amount_ngn: 2_500_000, status: 'held' },
      outbox: [{ to: 'farmer_group', body: 'x', status: 'held', at: '' }],
    });
    agent.store.save(item);
    const approved = await agent.signoff(item.id, true, 'Checked.');
    expect(approved.state).toBe('settled');
    expect(approved.payment?.status).toBe('released');
    expect(approved.outbox[0]!.status).toBe('sent');
    await expect(agent.signoff(item.id, true)).rejects.toThrow('Nothing on this case');
  });

  it('writes a plan before it acts, ticks it off and gives a reason to change course', async () => {
    const agent = agentWith(scripted([
      ['run_checks', {}],
      PLAN,
      ['mark_step', { step: 1, status: 'done' }],
      ['mark_step', { step: 2, status: 'dropped' }],
      ['set_plan', { steps: [{ text: 'Send an inspector', status: 'doing' }] }],
      ['set_plan', { steps: [{ text: 'Send an inspector', status: 'doing' }], reason: 'The gauge was silent for 21 days.' }],
      ['escalate', { question: 'x' }],
      ['finish_case', { summary: 'x' }],
    ]));
    const item = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    const refusals = item.events.filter(e => e.summary.startsWith('Refused')).map(e => e.summary);
    expect(refusals).toEqual(['Refused: no plan yet.', 'Refused to drop a step without a reason.', 'Refused a new plan without a reason.']);
    expect(item.plan?.steps).toEqual([{ text: 'Send an inspector', status: 'doing' }]);
    expect(item.plan?.revisions.map(r => r.reason)).toEqual(['The gauge was silent for 21 days.']);
    expect(item.events.some(e => e.kind === 'plan' && e.summary === 'Changed course: The gauge was silent for 21 days.')).toBe(true);
  });

  it('answers the officer at rest and carries on, keeping the conversation in the case', async () => {
    const agent = agentWith(scripted([
      PLAN,
      ['escalate', { question: 'x' }],
      ['finish_case', { summary: 'First pass.' }],
      ['run_checks', {}],
      ['reply_to_officer', { text: 'The gauge was silent on 21 of 31 days.' }],
      ['finish_case', { summary: 'Answered.' }],
    ]));
    const started = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    await agent.message(started.id, 'Why not trust the gauge?');
    expect(agent.isRunning(started.id)).toBe(true);
    const item = await settle(agent, started.id);
    const talk = item.events.filter(e => e.kind === 'officer' || e.kind === 'reply').map(e => [e.kind, e.summary]);
    expect(talk).toEqual([['officer', 'Why not trust the gauge?'], ['reply', 'The gauge was silent on 21 of 31 days.']]);
    expect(item.summary).toBe('Answered.');
    expect(item.segments.map(s => s.trigger)).toEqual(['start', 'message']);
  });

  it('reads a message sent mid-run before its next step', async () => {
    let seen = '';
    const steps = scripted([PLAN, ['run_checks', {}], ['reply_to_officer', { text: 'Checked.' }], ['escalate', { question: 'x' }], ['finish_case', { summary: 'x' }]]);
    let agent!: CaseAgent;
    let id = '';
    let turn = 0;
    agent = agentWith(async messages => {
      if (++turn === 2) await agent.message(id, 'Check the neighbouring station.');
      seen = JSON.stringify(messages.at(-1));
      if (turn === 3) expect(seen).toContain('Check the neighbouring station.');
      return steps(messages);
    });
    id = (await agent.start('CLM-LAG-2025-001')).id;
    const item = await settle(agent, id);
    expect(item.events.filter(e => e.kind === 'officer')).toHaveLength(1);
    expect(item.inbox).toEqual([]);
  });

  it('cannot change a settlement once the payment is released', async () => {
    const agent = agentWith(scripted([
      PLAN,
      ['escalate', { question: 'x' }],
      ['finish_case', { summary: 'x' }],
      ['propose_settlement', { verdict: 'NO_PAY', source: 'ghcn', rationale: 'x', counter_case: 'x' }],
      ['finish_case', { summary: 'x' }],
    ]));
    const item = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    item.payment = { amount_ngn: 383_333.33, status: 'released' };
    agent.store.save(item);
    await agent.message(item.id, 'Refuse it instead.');
    const after = await settle(agent, item.id);
    expect(after.events.some(e => e.summary === 'Refused: the payment was already released.')).toBe(true);
    expect(after.payment?.status).toBe('released');
  });

  it('does not spend the step budget on plan bookkeeping', async () => {
    const marks: [string, Record<string, unknown>][] = Array.from({ length: 15 }, () => ['mark_step', { step: 1, status: 'doing' }]);
    const queries: [string, Record<string, unknown>][] = Array.from({ length: 15 }, () => ['list_tables', {}]);
    const agent = agentWith(scripted([PLAN, ...marks, ...queries, ['escalate', { question: 'x' }], ['finish_case', { summary: 'Done.' }]]));
    const item = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    expect(item.summary).toBe('Done.');
    expect(item.events.some(e => e.summary.includes('step budget'))).toBe(false);
  });
});
