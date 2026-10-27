import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZetarisSampleAdapter } from '../app/adapters/zetarisSample.js';
import { Watcher, type WatchState } from '../app/agent/watcher.js';
import { createApp } from '../app/server.js';
import type { Orchestrator } from '../app/orchestrator.js';
import { CaseAgent } from '../app/agent/caseAgent.js';
import { CaseStore } from '../app/agent/cases.js';
import { PluviaMemory } from '../app/memory/pluviaMemory.js';

function watcher(directory = mkdtempSync(path.join(tmpdir(), 'pluvia-watch-'))) {
  return new Watcher({ query: new ZetarisSampleAdapter(), directory, stations: [{ id: 'NIM00065201', name: 'MURTALA MUHAMMED' }] });
}

describe('the station watcher', () => {
  it('opens a watch case on the third silent day, before any claim, and tells the operator', async () => {
    const w = watcher();
    await w.advance(3);
    expect(w.view().today).toBe('2025-07-03');
    expect(w.view().cases).toHaveLength(0);
    await w.advance();
    const [item] = w.view().cases;
    expect(item?.opened_on).toBe('2025-07-04');
    expect(item?.policy_ids).toEqual(['POL-LAG-2025-014', 'POL-LAG-2025-015', 'POL-LAG-2025-016']);
    expect(item?.findings[0]).toMatchObject({ kind: 'silent', dates: ['2025-07-02', '2025-07-03', '2025-07-04'] });
    expect(item?.outbox).toHaveLength(1);
  });

  it('reads only what had arrived by each day, and keeps one case per station through July', async () => {
    const w = watcher();
    await w.advance(31);
    const state = w.view();
    expect(state.today).toBe('2025-07-31');
    expect(state.checks).toHaveLength(31);
    expect(state.checks.find(c => c.date === '2025-07-08')).toMatchObject({ gauge_mm: 0, satellite_mm: 14.34 });
    expect(state.cases).toHaveLength(1);
    expect(state.cases[0]!.findings.map(f => f.kind)).toContain('divergence');
    await w.advance();
    expect(w.view().today).toBe('2025-07-31');
  });

  it('keeps the calendar across restarts and can start again', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'pluvia-watch-'));
    await watcher(directory).advance(5);
    const again = watcher(directory);
    expect(again.view().today).toBe('2025-07-05');
    expect(again.casesFor('NIM00065201')).toHaveLength(1);
    expect(again.reset().today).toBeNull();
  });

  it('plays back a recorded season one day at a time', async () => {
    const live = watcher();
    const days: WatchState[] = [];
    for (let i = 0; i < 5; i++) days.push(structuredClone(await live.advance()));
    const replay = new Watcher({ query: new ZetarisSampleAdapter(), directory: mkdtempSync(path.join(tmpdir(), 'pluvia-watch-')), recorded: days });
    expect(replay.view().recorded).toBe(true);
    expect((await replay.advance()).today).toBe('2025-07-01');
    expect((await replay.advance(3)).cases[0]?.opened_on).toBe('2025-07-04');
    expect((await replay.advance(10)).today).toBe('2025-07-05');
  });

  it('serves the calendar over HTTP and refuses a bad step', async () => {
    const app = createApp({} as Orchestrator, true, undefined, watcher());
    const post = (route: string, body: unknown) => app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/watch/advance', { days: 70 })).status).toBe(400);
    const moved = await (await post('/watch/advance', { days: 4 })).json();
    expect(moved).toMatchObject({ today: '2025-07-04', recorded: false });
    expect((await (await app.request('/watch')).json()).cases).toHaveLength(1);
    expect((await (await post('/watch/reset', {})).json()).today).toBeNull();
  });

  it('puts the open watch case in a new claim case', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-watch-'));
    const w = watcher(dir);
    await w.advance(4);
    const agent = new CaseAgent({
      query: new ZetarisSampleAdapter(),
      memory: new PluviaMemory(path.join(dir, 'memory')),
      store: new CaseStore(path.join(dir, 'cases')),
      replayDirectory: path.join(dir, 'replays'),
      live: true,
      watch: id => w.casesFor(id),
      chat: async () => ({ model: 'scripted', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'escalate', arguments: '{}' } }] } }),
    });
    const item = await agent.start('CLM-LAG-2025-001');
    expect(item.watch).toEqual([{ id: w.view().cases[0]!.id, station_id: 'NIM00065201', station_name: 'MURTALA MUHAMMED', opened_on: '2025-07-04' }]);
    for (let i = 0; i < 200 && agent.isRunning(item.id); i++) await new Promise(r => setTimeout(r, 25));
  });

  it('runs on to the filing day and picks each claim up once', async () => {
    const picked: string[][] = [];
    const filings = ['CLM-LAG-2025-001', 'CLM-LAG-2025-002', 'CLM-LAG-2025-003'].map(claim_id => ({ claim_id, filed_on: '2025-08-01' }));
    const w = new Watcher({ query: new ZetarisSampleAdapter(), directory: mkdtempSync(path.join(tmpdir(), 'pluvia-watch-')), filings, onFiled: async ids => { picked.push(ids); } });
    await w.advance(31);
    expect(w.view().today).toBe('2025-07-31');
    expect(picked).toEqual([]);
    await w.advance(5);
    expect(w.view()).toMatchObject({ today: '2025-08-01', last_day: '2025-08-01', picked: filings.map(f => f.claim_id) });
    expect(picked).toEqual([filings.map(f => f.claim_id)]);
    expect(w.view().checks).toHaveLength(31);
    await w.advance();
    expect(picked).toHaveLength(1);
    w.reset();
    await w.advance(40);
    expect(picked).toHaveLength(2);
  });
});
