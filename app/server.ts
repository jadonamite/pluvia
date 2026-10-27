import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Orchestrator } from './orchestrator.js';
import type { CaseAgent } from './agent/caseAgent.js';
import type { Watcher } from './agent/watcher.js';

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

export function createApp(orchestrator: Orchestrator, sampleMode: boolean, agent?: CaseAgent, watcher?: Watcher) {
  const app = new Hono();
  // In sample mode each visitor gets their own calendar and cases, keyed by a random cookie.
  const perVisitor = Boolean(watcher?.perVisitor);
  const visitorOf = (c: Context): string | undefined => {
    if (!perVisitor) return undefined;
    const known = getCookie(c, 'pluvia_visitor');
    if (known && /^[0-9a-f-]{36}$/.test(known)) return known;
    const id = randomUUID();
    setCookie(c, 'pluvia_visitor', id, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 6 * 3600 });
    return id;
  };
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
  if (agent) {
    const view = (id: string, visitor?: string) => {
      const item = agent.store.get(id);
      if (!item || (perVisitor && item.visitor !== visitor && item.kind !== 'watch')) return undefined;
      return { ...item, segments: undefined, running: agent.isRunning(id) };
    };
    const small = bodyLimit({ maxSize: 12000, onError: c => c.json(error('invalid_input', 'The request is too large.'), 413) });
    app.get('/cases', c => {
      const claim = c.req.query('claim');
      const visitor = visitorOf(c);
      const items = agent.store.list().filter(item => (!claim || item.claim_id === claim) && (!perVisitor || item.visitor === visitor));
      return c.json({ cases: items.map(item => view(item.id, visitor)) });
    });
    app.get('/cases/:id', c => {
      const item = view(c.req.param('id'), visitorOf(c));
      return item ? c.json(item) : c.json(error('case_not_found', 'This case does not exist.'), 404);
    });
    app.post('/cases', small, async c => {
      const parsed = z.object({ claim_id: z.string().min(1).max(120) }).strict().safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json(error('invalid_input', 'Name the claim to open a case for.'), 400);
      try {
        const visitor = visitorOf(c);
        const item = await agent.start(parsed.data.claim_id, visitor);
        return c.json(view(item.id, visitor), 202);
      } catch (e) {
        return c.json(error('case_not_started', (e as Error).message), 422);
      }
    });
    app.post('/cases/:id/signoff', small, async c => {
      const parsed = z.object({ approve: z.boolean(), note: z.string().max(2000).optional() }).strict().safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json(error('invalid_input', 'Approve or decline, with an optional note.'), 400);
      try {
        const visitor = visitorOf(c);
        if (!view(c.req.param('id'), visitor)) return c.json(error('case_not_found', 'This case does not exist.'), 404);
        const item = await agent.signoff(c.req.param('id'), parsed.data.approve, parsed.data.note);
        return c.json(view(item.id, visitor));
      } catch (e) {
        return c.json(error('signoff_refused', (e as Error).message), 409);
      }
    });
    app.post('/cases/:id/messages', small, async c => {
      const parsed = z.object({ text: z.string().trim().min(2).max(2000) }).strict().safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json(error('invalid_input', 'Write a question or an instruction for the agent.'), 400);
      try {
        const visitor = visitorOf(c);
        if (!view(c.req.param('id'), visitor)) return c.json(error('case_not_found', 'This case does not exist.'), 404);
        const item = await agent.message(c.req.param('id'), parsed.data.text);
        return c.json(view(item.id, visitor), 202);
      } catch (e) {
        return c.json(error('message_refused', (e as Error).message), 409);
      }
    });
    app.post('/cases/:id/inspection-report', small, async c => {
      const parsed = z.object({ report: z.string().min(10).max(8000) }).strict().safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json(error('invalid_input', 'Paste the inspector’s report, at least a sentence.'), 400);
      try {
        const visitor = visitorOf(c);
        if (!view(c.req.param('id'), visitor)) return c.json(error('case_not_found', 'This case does not exist.'), 404);
        const item = await agent.inspectionReport(c.req.param('id'), parsed.data.report);
        return c.json(view(item.id, visitor), 202);
      } catch (e) {
        return c.json(error('report_refused', (e as Error).message), 409);
      }
    });
  }
  if (watcher) {
    // The calendar, with the agent's investigation of each watch case as it stood that day.
    const watchView = (visitor?: string) => {
      const state = watcher.view(visitor);
      const investigations: Record<string, unknown> = {};
      for (const item of state.cases) {
        const found = item.agent_case_id && agent?.investigation(item.agent_case_id, state.today);
        if (found) investigations[item.id] = { ...found, segments: undefined, running: agent!.isRunning(found.id) };
      }
      return { ...state, investigations };
    };
    app.get('/watch', c => c.json(watchView(visitorOf(c))));
    app.post('/watch/advance', bodyLimit({ maxSize: 200 }), async c => {
      const parsed = z.object({ days: z.number().int().min(1).max(62).optional() }).strict().safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json(error('invalid_input', 'Move the calendar forward 1 to 62 days.'), 400);
      const visitor = visitorOf(c);
      await watcher.advance(parsed.data.days ?? 1, visitor);
      return c.json(watchView(visitor));
    });
    app.post('/watch/reset', c => {
      const visitor = visitorOf(c);
      watcher.reset(visitor);
      return c.json(watchView(visitor));
    });
  }
  app.get('/register/:name', async c => {
    const name = c.req.param('name');
    if (!['policies.json', 'claims.json', 'stations.json'].includes(name)) return c.json(error('not_found', 'Register not found.'), 404);
    const body = await readFile(`data/register/${name}`, 'utf8');
    c.header('Content-Type', 'application/json');
    return c.body(body);
  });
  app.get('/desk', serveStatic({ path: './public/desk.html' }));
  app.use('/*', serveStatic({ root: './public' }));
  app.notFound(c => c.json(error('not_found', 'Page not found.'), 404));
  return app;
}
