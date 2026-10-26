import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app/server.js';
import type { Orchestrator } from '../app/orchestrator.js';

describe('HTTP boundary', () => {
  it('rejects an invalid input and a per-request mode change before the orchestrator runs', async () => {
    const run = vi.fn();
    const app = createApp({ run } as unknown as Orchestrator, true);
    const invalid = await app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} })
    });
    expect(invalid.status).toBe(400);
    const mode = await app.request('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { claim_id: 'CLM-1' }, options: { sample_mode: false } })
    });
    expect(mode.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
  it('keeps a recorded decision unchanged when feedback is sent', async () => {
    const result = {
      run_id: 'run-1',
      output: { decision: { verdict: 'PAY', payout_ngn: 100 } },
      memory: { written: ['memory-1', 'memory-2'] }
    };
    const feedback = vi.fn();
    const app = createApp({ getRun: () => result, feedback } as unknown as Orchestrator, true);
    const response = await app.request('/runs/run-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'wrong' })
    });
    expect(response.status).toBe(200);
    expect(feedback.mock.calls).toEqual([
      ['memory-1', 'wrong'],
      ['memory-2', 'wrong']
    ]);
    expect(result.output.decision).toEqual({ verdict: 'PAY', payout_ngn: 100 });
  });
  it('rejects oversized streamed bodies without relying on Content-Length', async () => {
    const run = vi.fn(),
      feedback = vi.fn();
    const app = createApp(
      {
        run,
        feedback,
        getRun: () => ({ memory: { written: ['memory-1'] } })
      } as unknown as Orchestrator,
      true
    );
    for (const [route, size] of [
      ['/run', 21000],
      ['/runs/run-1/feedback', 4500]
    ] as const) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(size)));
          controller.close();
        }
      });
      const request = new Request(`http://localhost${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half'
      } as RequestInit);
      const response = await app.request(request);
      expect(response.status).toBe(413);
      expect((await response.json()).error.type).toBe('invalid_input');
    }
    expect(run).not.toHaveBeenCalled();
    expect(feedback).not.toHaveBeenCalled();
  });
  it('returns an actionable missing-run error', async () => {
    const app = createApp({ getRun: () => undefined } as unknown as Orchestrator, true);
    const response = await app.request('/runs/missing');
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toContain('Run the claim again');
  });
});
