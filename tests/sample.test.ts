import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRuntime, type Runtime } from '../app/runtime.js';
import { loadConfig } from '../app/config.js';
import { normalizeSeries } from '../app/domain/series.js';
let runtime: Runtime | undefined;
const directories: string[] = [];
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  await Promise.all(
    directories.splice(0).map((file) => rm(file, { recursive: true, force: true }))
  );
  vi.unstubAllGlobals();
});
describe('verified sample evidence', () => {
  it('executes the real SQL, gate and memory across independent runtime sessions without live calls', async () => {
    const network = vi.fn(() => {
      throw new Error('Sample mode must not contact a live service');
    });
    vi.stubGlobal('fetch', network);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pluvia-sample-'));
    directories.push(directory);
    const options = {
      config: loadConfig({ SAMPLE_MODE: 'true' }),
      logDirectory: directory,
      stdout: false
    };
    runtime = await createRuntime(options);
    const first = await runtime.orchestrator.run({ claim_id: 'CLM-LAG-2025-001' });
    expect(first.status).toBe('success');
    expect(first.output?.decision.verdict).toBe('INSPECT');
    expect(first.output?.decision.rounds).toBe(1);
    expect(first.output?.evidence.station.days).toHaveLength(10);
    expect(first.output?.evidence.satellite?.days).toHaveLength(31);
    expect(normalizeSeries(first.output!.evidence.station).total).toBeCloseTo(6.1);
    expect(normalizeSeries(first.output!.evidence.satellite!).total).toBeCloseTo(131.7, 0);
    expect(first.trace.some((event) => event.sql?.includes('FROM pluvia.ghcn_prcp'))).toBe(true);
    expect(
      first.trace
        .filter((event) => event.action === 'model_response')
        .every((event) => event.model === 'sample-rules')
    ).toBe(true);
    await runtime.close();
    runtime = await createRuntime(options);
    const second = await runtime.orchestrator.run({ claim_id: 'CLM-LAG-2025-002' });
    expect(second.status).toBe('success');
    expect(second.memory.recalled.length).toBeGreaterThan(0);
    expect(second.output?.decision.rounds).toBe(0);
    expect(second.output?.decision.verdict).toBe('INSPECT');
    expect(network).not.toHaveBeenCalled();
  });
});
