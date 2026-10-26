import { describe, it, expect } from 'vitest';
import { ZetarisAdapter } from '../app/adapters/zetaris.js';
import { powerRegistrations } from '../app/sql/power.js';
import { registerStatements } from '../app/sql/registration.js';
import { policy } from './fixtures.js';
describe('on-demand POWER registration', () => {
  it('pins independent UTC source coordinates and includes only complete prior years', () => {
    const current = powerRegistrations(policy, { contactEmail: 'test@example.com' }),
      prior = powerRegistrations(policy, { contactEmail: 'test@example.com', prior: true });
    expect(current.find((r) => r.sql.includes('endpoint'))!.sql).toContain('IMERG_PRECTOT');
    expect(current.find((r) => r.sql.includes('endpoint'))!.sql).toContain('time-standard=UTC');
    expect(prior.find((r) => r.sql.includes('endpoint'))!.sql).toContain(
      'start=20010101&end=20241231'
    );
    expect(current.at(-1)!.sql).toContain(`${policy.farm_lat} AS latitude`);
  });
  it('does not blindly retry a CREATE after an ambiguous server failure', async () => {
    let count = 0;
    const fetcher = async () => {
      count++;
      return new Response('', { status: 503 });
    };
    const client = new ZetarisAdapter(
      { url: 'http://test', orgId: '1', apiKey: 'private' },
      undefined,
      fetcher,
      async () => {}
    );
    await expect(client.query('CREATE LIGHTNING DATABASE TEST')).rejects.toThrow('HTTP 503');
    expect(count).toBe(1);
  });
  it('rechecks metadata after ambiguous CREATE, accepts an observed object and never repeats CREATE', async () => {
    let checks = 0,
      creates = 0;
    const adapter = {
      health: async () => 'sample' as const,
      query: async (sql: string) => {
        if (sql === 'SHOW TABLES FROM X') return ++checks === 1 ? [] : [{ name: 'observed' }];
        creates++;
        throw new Error('network timeout');
      }
    };
    expect(
      await registerStatements(
        adapter as never,
        [
          {
            container: 'X',
            name: 'observed',
            metadata_sql: 'SHOW TABLES FROM X',
            sql: 'CREATE TABLE observed'
          }
        ],
        { wait: async () => {} }
      )
    ).toEqual({ created: 0, skipped: 1 });
    expect(creates).toBe(1);
  });
  it('checks existing objects before creation and still caches the registered source', async () => {
    const statements: string[] = [];
    const fetcher = async (_url: unknown, init?: RequestInit) => {
      const sql = JSON.parse(String(init!.body)).sql as string;
      statements.push(sql);
      let rows: Record<string, string>[] = [];
      if (sql === 'SHOW LIGHTNING DATABASES') rows = [{ name: 'POWER_REST' }];
      if (sql === 'SHOW SCHEMASTORE CONTAINERS') rows = [{ name: 'pluvia' }];
      if (sql === 'SHOW TABLES FROM POWER_REST') rows = [{ name: 'power_test_2025' }];
      if (sql === 'SHOW TABLES FROM pluvia') rows = [{ name: 'power_test_2025_daily' }];
      return Response.json({ response: { data: rows } });
    };
    await new ZetarisAdapter(
      { url: 'http://test', orgId: '1', apiKey: 'private', contactEmail: 'test@example.com' },
      undefined,
      fetcher as typeof fetch,
      async () => {}
    ).ensurePower(policy);
    expect(statements.some((sql) => sql.startsWith('CREATE'))).toBe(false);
    expect(statements).toContain('CACHE TABLE POWER_REST.power_test_2025');
  });
});
