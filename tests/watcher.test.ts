import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ZetarisSampleAdapter } from '../app/adapters/zetarisSample.js';
import { Watcher } from '../app/agent/watcher.js';

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
});
