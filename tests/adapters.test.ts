import { describe, it, expect, vi } from 'vitest';
import { ZetarisAdapter } from '../app/adapters/zetaris.js';
import { NightshiftAdapter } from '../app/adapters/nightshift.js';
import { registerStatements, buildRegistrations } from '../scripts/register_zetaris.js';
import { redact } from '../app/trace.js';
const zetaris = { url: 'http://test/api', orgId: '1', apiKey: 'private-test-value' };
const nightshift = {
  url: 'http://test/v1',
  runtimeToken: 'private-test-value',
  model: 'meterless/nemotron'
};
describe('live adapter contracts', () => {
  it('sends SQL through Zetaris only and traces successful rows', async () => {
    const requests: RequestInit[] = [],
      trace = vi.fn();
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(init!);
      return Response.json({ response: { data: [{ mm: 1 }] } });
    }) as unknown as typeof fetch;
    const adapter = new ZetarisAdapter(zetaris, trace, f);
    expect(await adapter.query('SELECT mm')).toEqual([{ mm: 1 }]);
    expect(JSON.parse(String(requests[0]!.body)).source).toBe('SqlEditor');
    expect(trace.mock.calls[0]![0].sql).toBe('SELECT mm');
  });
  it('reads the live tabular result shape and its string values', async () => {
    const f = (async () =>
      Response.json({
        headers: ['station_id', 'obs_date', 'mm', 'm_flag', 'synthetic', 'farm_lat'],
        data: [['NIM00065201', '2025-07-01', '0.0', null, 'true', '6.577']],
        total: 1,
        timeUsed: 12
      })) as unknown as typeof fetch;
    expect(await new ZetarisAdapter(zetaris, undefined, f).query('SELECT *')).toEqual([
      { station_id: 'NIM00065201', obs_date: '2025-07-01', mm: 0, m_flag: null, synthetic: true, farm_lat: 6.577 }
    ]);
  });
  it('keeps a rejected statement message as detail, out of the error text', async () => {
    const f = (async () =>
      Response.json({ msg: 'A container named "pluvia" already exists.' }, { status: 400 })) as unknown as typeof fetch;
    const error = (await new ZetarisAdapter(zetaris, undefined, f)
      .query('CREATE SCHEMASTORE CONTAINER pluvia')
      .catch((e: unknown) => e)) as { type: string; message: string; detail?: string };
    expect(error.type).toBe('zetaris_sql');
    expect(error.message).not.toContain('pluvia');
    expect(error.detail).toContain('already exists');
  });
  it('retries transient SQL failures but not authorization, without leaking bodies', async () => {
    let count = 0;
    const wait = vi.fn(async (_ms: number) => {}),
      f = vi.fn(async () =>
        ++count < 3
          ? new Response('secret body', { status: 503 })
          : Response.json({ response: { data: [] } })
      ) as unknown as typeof fetch;
    await new ZetarisAdapter(zetaris, undefined, f, wait).query('SELECT 1');
    expect(wait.mock.calls.map((c) => c[0])).toEqual([2000, 4000]);
    const bad = async () => new Response('sensitive server error', { status: 401 });
    await expect(new ZetarisAdapter(zetaris, undefined, bad).query('SELECT 1')).rejects.toThrow(
      'HTTP 401'
    );
    expect(await new ZetarisAdapter(zetaris, undefined, bad).health()).toBe('unauthorized');
  });
  it('requires models endpoint route proof and logs served model separately', async () => {
    let sent: RequestInit | undefined;
    const trace = vi.fn();
    const f = async (url: unknown, init?: RequestInit) => {
      sent = init;
      return String(url).endsWith('/models')
        ? Response.json({ data: [{ id: nightshift.model }] })
        : Response.json({
            id: 'chat-1',
            model: 'nvidia/nemotron-actual',
            choices: [
              {
                message: { role: 'assistant', content: '{"ok":true}' },
                finish_reason: 'stop',
                index: 0
              }
            ]
          });
    };
    const adapter = new NightshiftAdapter(nightshift, trace, f as typeof fetch);
    expect(await adapter.health()).toBe('online');
    const result = await adapter.complete({ agent: 'PlannerAgent', prompt: 'plan' });
    expect(result.model).toBe('nvidia/nemotron-actual');
    expect(result.route).toBe(nightshift.model);
    expect(JSON.parse(String(sent!.body)).max_tokens).toBeGreaterThanOrEqual(800);
    expect(trace.mock.calls[0]![0].model).toBe(result.model);
  });
  it('rejects missing model evidence and aborted calls', async () => {
    const f = async () => Response.json({ choices: [{ message: { content: 'text' }, index: 0 }] });
    await expect(
      new NightshiftAdapter(nightshift, undefined, f).complete({ agent: 'a', prompt: 'b' })
    ).rejects.toThrow('served model');
    const signal = AbortSignal.abort();
    await expect(new ZetarisAdapter(zetaris).query('SELECT 1', { signal })).rejects.toBeDefined();
  });
  it('redacts sensitive object keys and recognizable credential strings', () => {
    expect(
      redact({
        Authorization: 'Bearer value',
        nested: { runtimeToken: 'private' },
        text: 'Bearer abc sk-example'
      })
    ).toEqual({
      Authorization: '[redacted]',
      nested: { runtimeToken: '[redacted]' },
      text: 'Bearer [redacted] [redacted]'
    });
  });
  it('runs registration statements sequentially and skips existing objects', async () => {
    const calls: string[] = [];
    const query = async (sql: string) => {
      calls.push(sql);
      return sql === 'SHOW FIRST' ? [{ name: 'first' }] : [];
    };
    const adapter = { query, health: async () => 'online' as const };
    const result = await registerStatements(
      adapter as never,
      [
        { container: 'first', metadata_sql: 'SHOW FIRST', sql: 'CREATE FIRST' },
        { container: 'second', metadata_sql: 'SHOW SECOND', sql: 'CREATE SECOND' }
      ],
      { wait: async () => {} }
    );
    expect(result).toEqual({ created: 1, skipped: 1 });
    expect(calls).toEqual(['SHOW FIRST', 'SHOW SECOND', 'CREATE SECOND']);
  });
  it('generates UTC satellite registrations and rejects unsafe identifiers', () => {
    const registrations = buildRegistrations(
      [{ id: 'NIM00065201' }],
      [
        {
          power_table: 'power_lagos_2025_daily',
          farm_lat: 6.6,
          farm_lon: 3.35,
          window_start: '2025-07-01',
          window_end: '2025-07-31'
        }
      ],
      'http://host.docker.internal:8000/register',
      'test@example.com'
    );
    expect(registrations.some((r) => r.sql.includes('time-standard=UTC'))).toBe(true);
    expect(() =>
      buildRegistrations([{ id: 'bad;DROP' }], [], 'https://example.com', 'test@example.com')
    ).toThrow();
  });
});
