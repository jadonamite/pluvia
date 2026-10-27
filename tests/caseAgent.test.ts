import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZetarisSampleAdapter } from '../app/adapters/zetarisSample.js';
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

function agentWith(chat: ReturnType<typeof scripted>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-agent-'));
  return new CaseAgent({
    query: new ZetarisSampleAdapter(),
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
    const agent = agentWith(scripted([['escalate', { question: 'x' }], ['finish_case', { summary: 'x' }]]));
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
});
