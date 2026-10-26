import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main, readClaimArgument } from '../run.js';
import type { Runtime } from '../app/runtime.js';
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});
describe('claim command input', () => {
  it('accepts an ID and a wrapped JSON input file', async () => {
    expect(await readClaimArgument('CLM-001')).toEqual({ input: { claim_id: 'CLM-001' } });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pluvia-cli-'));
    temporary.push(directory);
    const file = path.join(directory, 'claim.json');
    await writeFile(
      file,
      JSON.stringify({ input: { claim_id: 'CLM-002' }, options: { max_extra_rounds: 1 } })
    );
    expect(await readClaimArgument(file)).toEqual({
      input: { claim_id: 'CLM-002' },
      options: { max_extra_rounds: 1 }
    });
  });
  it('rejects invalid input and prevents accidental startup', async () => {
    await expect(
      readClaimArgument('{"input":{"claim_id":"x"},"options":{"max_extra_rounds":99}}')
    ).rejects.toThrow('max_extra_rounds');
    const factory = vi.fn();
    const out = vi.fn(),
      error = vi.fn();
    expect(await main(['unknown'], { out, error }, factory)).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(error.mock.calls[0]![0].error.type).toBe('invalid_command');
  });
  it('closes the adapter after a failed claim and preserves structured output', async () => {
    const close = vi.fn();
    const result = { status: 'error', error: { type: 'run_error' } };
    const runtime = {
      orchestrator: { run: vi.fn().mockResolvedValue(result) },
      close
    } as unknown as Runtime;
    const out = vi.fn(),
      error = vi.fn();
    expect(await main(['claim', 'CLM-001'], { out, error }, async () => runtime)).toBe(1);
    expect(out).toHaveBeenCalledWith(result);
    expect(close).toHaveBeenCalledOnce();
  });
});
