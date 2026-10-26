import { afterEach, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runEvaluation } from '../eval/run_eval.js';
import type { ModelAdapter } from '../app/adapters/contracts.js';

const originalCwd = process.cwd();
const temporary: string[] = [];
afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('raw-totals model baseline', () => {
  it('is measured when only Nightshift is live, while Pluvia keeps sample-rules', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pluvia-eval-baseline-'));
    temporary.push(dir);
    await mkdir(path.join(dir, 'eval/cases'), { recursive: true });
    const name = 'KE000063661-2021-08-15-basis-risk.json';
    await copyFile(path.join(originalCwd, 'eval/cases', name), path.join(dir, 'eval/cases', name));
    const calls: string[] = [];
    const model: ModelAdapter = {
      health: async () => 'online',
      complete: async (request) => {
        calls.push(request.agent);
        return { content: 'Reasoning first. {"source":"power"}', model: 'nvidia/test-model' };
      },
    };
    process.chdir(dir);
    const result = (await runEvaluation(
      { config: { sampleMode: true, sample: { nightshift: false } }, model },
      'eval/cases'
    )) as unknown as { metrics: Record<string, { cases: number } | null>; rows: { deciders: Record<string, any> }[] };
    expect(calls).toEqual(['RawTotalsBaseline']);
    expect(result.metrics.raw_totals_model?.cases).toBe(1);
    expect(result.rows[0]!.deciders.raw_totals_model.model).toBe('nvidia/test-model');
    expect(result.rows[0]!.deciders.pluvia.verdict).toBe('PAY_ANYWAY');
    expect(await readFile('eval/results.md', 'utf8')).toContain('0 of 1 baseline calls');
  });
});
