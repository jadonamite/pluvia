import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZetarisSampleAdapter } from '../app/adapters/zetarisSample.js';
import { lagosData } from './lagosData.js';
import { PluviaMemory } from '../app/memory/pluviaMemory.js';
import { CaseAgent } from '../app/agent/caseAgent.js';
import { CaseStore } from '../app/agent/cases.js';
import { Watcher } from '../app/agent/watcher.js';
import { createApp } from '../app/server.js';
import type { Orchestrator } from '../app/orchestrator.js';

function app(perVisitor: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-visitors-'));
  const query = new ZetarisSampleAdapter({ dataDirectory: lagosData() });
  const agent = new CaseAgent({ query, memory: new PluviaMemory(path.join(dir, 'memory')), store: new CaseStore(path.join(dir, 'cases')), replayDirectory: path.join(lagosData(), 'replays'), live: false });
  const watcher = new Watcher({ query, directory: dir, perVisitor });
  return createApp({} as Orchestrator, true, agent, watcher);
}

// A browser: keeps the cookie the server gives it.
function browser(server: ReturnType<typeof app>) {
  let cookie = '';
  return async (route: string, body?: unknown) => {
    const response = await server.request(route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return { status: response.status, body: await response.json(), set };
  };
}

describe('one calendar per visitor', () => {
  it('in sample mode, steps, resets and lists cases per visitor', async () => {
    const server = app(true);
    const a = browser(server), b = browser(server);
    const first = await a('/watch');
    expect(first.set).toMatch(/pluvia_visitor=[0-9a-f-]{36}; .*HttpOnly/);
    await a('/watch/advance', { days: 5 });
    await b('/watch/advance', { days: 2 });
    expect((await a('/watch')).body.today).toBe('2025-07-05');
    expect((await b('/watch')).body.today).toBe('2025-07-02');
    await b('/watch/reset', {});
    expect((await b('/watch')).body.today).toBeNull();
    expect((await a('/watch')).body.today).toBe('2025-07-05');
    const started = await a('/cases', { claim_id: 'CLM-LAG-2025-001' });
    expect(started.status).toBe(202);
    expect((await a('/cases')).body.cases).toHaveLength(1);
    expect((await b('/cases')).body.cases).toHaveLength(0);
    expect((await b(`/cases/${started.body.id}`)).status).toBe(404);
  });

  it('live keeps the single shared calendar and sets no cookie', async () => {
    const server = app(false);
    const a = browser(server), b = browser(server);
    await a('/watch/advance', { days: 3 });
    const seen = await b('/watch');
    expect(seen.body.today).toBe('2025-07-03');
    expect(seen.set).toBeNull();
  });
});
