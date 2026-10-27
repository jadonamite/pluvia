import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZetarisSampleAdapter } from '../app/adapters/zetarisSample.js';
import { lagosData } from './lagosData.js';
import { PluviaMemory } from '../app/memory/pluviaMemory.js';
import { CaseAgent, type Message } from '../app/agent/caseAgent.js';
import { CaseStore } from '../app/agent/cases.js';
import { Watcher } from '../app/agent/watcher.js';

type Step = [string, Record<string, unknown>];
const GAUGE_DAYS = "SELECT COUNT(*) AS n FROM pluvia.ghcn_prcp WHERE station_id = 'NIM00065201' AND obs_date BETWEEN '2025-07-01' AND '2025-07-04'";

// A scripted model that records every conversation it is shown.
function scripted(steps: Step[], seen: Message[][]) {
  let i = 0;
  return async (messages: Message[]) => {
    seen.push(structuredClone(messages));
    const [name, args] = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return { model: 'scripted', message: { role: 'assistant', content: `Calling ${name}.`, tool_calls: [{ id: `call_${i}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }] } };
  };
}

function setup(steps: Step[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-watch-agent-'));
  const seen: Message[][] = [];
  const query = new ZetarisSampleAdapter({ dataDirectory: lagosData() });
  let watcher!: Watcher;
  const agent = new CaseAgent({
    query,
    memory: new PluviaMemory(path.join(dir, 'memory')),
    store: new CaseStore(path.join(dir, 'cases')),
    replayDirectory: path.join(dir, 'replays'),
    live: true,
    watch: id => watcher.casesFor(id),
    chat: scripted(steps, seen),
  });
  watcher = new Watcher({
    query,
    directory: dir,
    stations: [{ id: 'NIM00065201', name: 'MURTALA MUHAMMED' }],
    handoff: {
      open: async (item, today, notice) => (await agent.startWatch({ watch: item, today, fallbackNotice: notice, findings: item.findings })).id,
      wake: async (item, finding, today) => {
        await agent.wakeWatch(item.agent_case_id!, finding.summary, today);
        return true;
      },
    },
  });
  return { agent, watcher, seen };
}

async function settle(agent: CaseAgent, id: string) {
  for (let i = 0; i < 400 && agent.isRunning(id); i++) await new Promise(r => setTimeout(r, 25));
  return agent.store.get(id)!;
}

const WATCH_RUN: Step[] = [
  ['propose_settlement', { verdict: 'PAY', rationale: 'x' }],
  ['set_plan', { steps: [{ text: 'Count the gauge days so far' }, { text: 'Tell the operator' }] }],
  ['sql_query', { sql: "SELECT * FROM pluvia.ghcn_prcp WHERE obs_date = '2025-07-20'" }],
  ['sql_query', { sql: GAUGE_DAYS }],
  ['record_lesson', { lesson: 'Five gauge days.', figures: [{ label: 'Gauge days', sql: GAUGE_DAYS, value: 5 }] }],
  ['record_lesson', { lesson: 'One gauge reading in the first four days of July.', figures: [{ label: 'Gauge days', sql: GAUGE_DAYS, value: 1 }] }],
  ['notify_operator', { body: 'Your gauge sent one reading in four days.' }],
  ['finish_case', { summary: 'The gauge went quiet on 2 July.' }],
];

describe('the agent on a watch case', () => {
  it('starts on 4 July, keeps to watch tools and today, and records only lessons that reproduce', async () => {
    const { agent, watcher } = setup(WATCH_RUN);
    await watcher.advance(3);
    expect(watcher.view().cases).toHaveLength(0);
    await watcher.advance();
    const watch = watcher.view().cases[0]!;
    expect(watch.agent_case_id).toBeDefined();
    expect(watch.outbox).toHaveLength(0);
    const item = await settle(agent, watch.agent_case_id!);
    expect(item.kind).toBe('watch');
    const refused = item.events.filter(e => e.summary.startsWith('Refused')).map(e => e.summary);
    expect(refused).toEqual([
      'Refused: not part of a watch case.',
      'Refused a query: it reaches 2025-07-20, after today.',
      'Refused a lesson: 1 of 1 figures did not reproduce.',
    ]);
    expect(item.lessons?.map(l => l.text)).toEqual(['One gauge reading in the first four days of July.']);
    expect(item.outbox.map(m => [m.to, m.day])).toEqual([['station_operator', '2025-07-04']]);
    expect(item.state).toBe('closed');
    expect(item.events.every(e => e.day === '2025-07-04')).toBe(true);
  });

  it('wakes on a later finding with a note from the watcher', async () => {
    const { agent, watcher } = setup([...WATCH_RUN, ['finish_case', { summary: 'Silent again from 9 July.' }]]);
    await watcher.advance(4);
    const id = watcher.view().cases[0]!.agent_case_id!;
    await settle(agent, id);
    await watcher.advance(7);
    const item = await settle(agent, id);
    const note = item.events.find(e => e.kind === 'watcher');
    expect(note?.day).toBe('2025-07-11');
    expect(note?.summary).toContain('since 9 July');
    expect(item.summary).toBe('Silent again from 9 July.');
    expect(item.segments.map(s => [s.trigger, s.day])).toEqual([['watch', '2025-07-04'], ['message', '2025-07-11']]);
  });

  it('hands a later claim the findings, the summary and the lessons', async () => {
    const seen: Message[][] = [];
    const { agent, watcher, seen: log } = setup([...WATCH_RUN, ['set_plan', { steps: [{ text: 'Build on the watch case' }] }], ['recall_station', {}], ['escalate', { question: 'x' }], ['finish_case', { summary: 'x' }]]);
    await watcher.advance(4);
    await settle(agent, watcher.view().cases[0]!.agent_case_id!);
    const claim = await settle(agent, (await agent.start('CLM-LAG-2025-001')).id);
    seen.push(...log);
    const brief = String(seen.find(m => m[1]?.content?.startsWith('New claim'))?.[1]?.content);
    expect(brief).toContain('"watch_cases"');
    expect(brief).toContain('since 2 July');
    expect(brief).toContain('The gauge went quiet on 2 July.');
    expect(brief).toContain('One gauge reading in the first four days of July.');
    expect(claim.watch?.[0]?.opened_on).toBe('2025-07-04');
    const recalled = JSON.stringify(claim.events.find(e => e.tool === 'recall_station')?.output);
    expect(recalled).toContain('One gauge reading in the first four days of July.');
  });

  it('falls back to the watcher notice when the model fails', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-watch-agent-'));
    const query = new ZetarisSampleAdapter({ dataDirectory: lagosData() });
    const agent = new CaseAgent({
      query,
      memory: new PluviaMemory(path.join(dir, 'memory')),
      store: new CaseStore(path.join(dir, 'cases')),
      replayDirectory: dir,
      live: true,
      chat: async () => { throw new Error('model down'); },
    });
    const watcher = new Watcher({
      query,
      directory: dir,
      handoff: { open: async (item, today, notice) => (await agent.startWatch({ watch: item, today, fallbackNotice: notice, findings: item.findings })).id, wake: async () => true },
    });
    await watcher.advance(4);
    const item = await settle(agent, watcher.view().cases[0]!.agent_case_id!);
    expect(item.state).toBe('failed');
    expect(item.outbox[0]?.body).toContain('has sent no reading for 3 days');
  });

  it('plays a recorded investigation back cut to the calendar day', async () => {
    const { agent, watcher } = setup([...WATCH_RUN, ['finish_case', { summary: 'Silent again from 9 July.' }]]);
    await watcher.advance(4);
    const id = watcher.view().cases[0]!.agent_case_id!;
    await settle(agent, id);
    await watcher.advance(7);
    const recorded = await settle(agent, id);
    const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-watch-agent-'));
    const replay = new CaseAgent({ query: new ZetarisSampleAdapter({ dataDirectory: lagosData() }), memory: new PluviaMemory(path.join(dir, 'm')), store: new CaseStore(path.join(dir, 'c')), replayDirectory: dir, live: false, recordedInvestigations: [recorded] });
    expect(replay.investigation(id, '2025-07-03')?.events).toHaveLength(0);
    const day4 = replay.investigation(id, '2025-07-04')!;
    expect(day4.events.some(e => e.kind === 'watcher')).toBe(false);
    expect(day4.summary).toBeUndefined();
    expect(replay.investigation(id, '2025-07-31')?.summary).toBe('Silent again from 9 July.');
  });
});
