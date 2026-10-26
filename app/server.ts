import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Orchestrator } from './orchestrator.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const inputSchema = z.object({
  claim_id: z.string().min(1).max(120).optional(),
  policy_id: z.string().min(1).max(120).optional(),
  event_text: z.string().min(1).max(10000).optional(),
  window_override: z.object({ start: date, end: date }).strict().optional(),
}).strict().refine(input => Boolean(input.claim_id || input.event_text), 'Provide a claim_id or event_text');
const requestSchema = z.object({
  input: inputSchema,
  options: z.object({
    sample_mode: z.boolean().optional(),
    max_extra_rounds: z.number().int().min(0).max(2).optional(),
  }).strict().optional(),
}).strict();
const error = (type: string, message: string, recoverable = true) => ({ status: 'error', error: { type, message, recoverable } });

export function createApp(orchestrator: Orchestrator, sampleMode: boolean) {
  const app = new Hono();
  app.onError((_err, c) => c.json(error('service_error', 'The request could not be completed. Check the service status and the run trace.'), 503));
  app.get('/health', async c => c.json(await orchestrator.health()));
  app.get('/claims', async c => {
    const [claims, policies] = await Promise.all([orchestrator.listClaims(), orchestrator.listPolicies()]);
    return c.json({ claims, policies });
  });
  app.post('/run', bodyLimit({ maxSize: 20000, onError: c => c.json(error('invalid_input', 'The request is too large. Keep claim input below 20,000 bytes.'), 413) }), async c => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(error('invalid_input', parsed.error.issues.map(issue => issue.message).join('; ')), 400);
    if (parsed.data.options?.sample_mode !== undefined && parsed.data.options.sample_mode !== sampleMode) {
      return c.json(error('mode_mismatch', 'Set SAMPLE_MODE on the server to select the data and model adapters.'), 400);
    }
    const result = await orchestrator.run(parsed.data.input, { max_extra_rounds: parsed.data.options?.max_extra_rounds, signal: c.req.raw.signal });
    return c.json(result, result.status === 'error' ? 422 : 200);
  });
  app.get('/runs/:id', c => {
    const run = orchestrator.getRun(c.req.param('id'));
    return run ? c.json(run) : c.json(error('run_not_found', 'This run is unavailable in the current server session. Run the claim again.'), 404);
  });
  app.post('/runs/:id/feedback', bodyLimit({ maxSize: 4000, onError: c => c.json(error('invalid_input', 'The feedback request is too large. Keep it below 4,000 bytes.'), 413) }), async c => {
    const run = orchestrator.getRun(c.req.param('id'));
    if (!run) return c.json(error('run_not_found', 'Run the claim before recording officer feedback.'), 404);
    const parsed = z.object({ kind: z.enum(['helpful', 'wrong']), reason: z.string().max(2000).optional() }).strict().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(error('invalid_input', 'Choose helpful or wrong for the officer feedback.'), 400);
    for (const id of run.memory.written) orchestrator.feedback(id, parsed.data.kind);
    return c.json({ status: 'success', memory_ids: run.memory.written, message: 'Memory feedback recorded. The PolicyGate decision is unchanged.' });
  });
  app.get('/register/:name', async c => {
    const name = c.req.param('name');
    if (!['policies.json', 'claims.json', 'stations.json'].includes(name)) return c.json(error('not_found', 'Register not found.'), 404);
    const body = await readFile(`data/register/${name}`, 'utf8');
    c.header('Content-Type', 'application/json');
    return c.body(body);
  });
  app.use('/*', serveStatic({ root: './public' }));
  app.notFound(c => c.json(error('not_found', 'Page not found.'), 404));
  return app;
}
