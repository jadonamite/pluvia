import { describe, it, expect } from 'vitest';
import { ZetarisAdapter } from '../app/adapters/zetaris.js';
import { AdapterError } from '../app/adapters/contracts.js';
import { loadConfig } from '../app/config.js';

const account = {
  url: 'http://test/api',
  orgId: '1',
  apiKey: '',
  loginUrl: 'http://test/login',
  username: 'officer@test',
  password: 'test-password',
};
const jwt = (secondsAhead: number, id = 'a') =>
  [
    Buffer.from('{"alg":"none"}').toString('base64url'),
    Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsAhead, id })).toString('base64url'),
    'signature-' + id,
  ].join('.');

function fakeZetaris(tokens: string[], rejectFirstQuery = false) {
  const seen: { url: string; auth?: string; org?: string }[] = [];
  let logins = 0;
  let queries = 0;
  const f = (async (url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push({ url: String(url), auth: headers.Authorization, org: headers['X-Org-ID'] });
    if (String(url).endsWith('/login')) return Response.json({ accessToken: tokens[logins++], orgId: 7 });
    queries++;
    if (rejectFirstQuery && queries === 1) return new Response('{}', { status: 401 });
    return Response.json({ headers: ['seven'], data: [['7']] });
  }) as unknown as typeof fetch;
  return { f, seen, logins: () => logins };
}

describe('Zetaris sign-in', () => {
  it('signs in once and reuses the token with the organisation it returns', async () => {
    const z = fakeZetaris([jwt(900)]);
    const adapter = new ZetarisAdapter(account, undefined, z.f);
    await adapter.query('SELECT 7 AS seven');
    await adapter.query('SELECT 7 AS seven');
    expect(z.logins()).toBe(1);
    const queries = z.seen.filter((r) => !r.url.endsWith('/login'));
    expect(queries.every((r) => r.auth?.startsWith('Bearer ') && r.auth.endsWith('.signature-a'))).toBe(true);
    expect(queries.every((r) => r.org === '7')).toBe(true);
  });

  it('signs in again when Zetaris rejects the token', async () => {
    const z = fakeZetaris([jwt(900, 'a'), jwt(900, 'b')], true);
    const rows = await new ZetarisAdapter(account, undefined, z.f).query('SELECT 7 AS seven');
    expect(rows).toEqual([{ seven: 7 }]);
    expect(z.logins()).toBe(2);
    expect(z.seen.at(-1)!.auth).toContain('signature-b');
  });

  it('renews a token within a minute of expiry before using it', async () => {
    const z = fakeZetaris([jwt(30, 'a'), jwt(900, 'b')]);
    const adapter = new ZetarisAdapter(account, undefined, z.f);
    await adapter.query('SELECT 7 AS seven');
    await adapter.query('SELECT 7 AS seven');
    expect(z.logins()).toBe(2);
    expect(z.seen.at(-1)!.auth).toContain('signature-b');
  });

  it('reports a failed sign-in by name rather than as a SQL error', async () => {
    const f = (async () => new Response('{"msg":"bad credentials"}', { status: 401 })) as unknown as typeof fetch;
    const error = await new ZetarisAdapter(account, undefined, f).query('SELECT 1').catch((e) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error.type).toBe('zetaris_auth');
    expect(await new ZetarisAdapter(account, undefined, f).health()).toBe('unauthorized');
  });

  it('treats an account as a live Zetaris credential', () => {
    const config = loadConfig({ ZETARIS_USERNAME: 'officer@test', ZETARIS_PASSWORD: 'test-password' });
    expect(config.sample.zetaris).toBe(false);
    expect(config.zetaris.loginUrl).toBe('http://localhost:3000/api/auth/login');
  });
});
