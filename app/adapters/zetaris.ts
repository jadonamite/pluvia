import { powerRegistrations } from '../sql/power.js';
import { registerStatements } from '../sql/registration.js';
import type { Policy } from '../types.js';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config.js';
import {
  AdapterError,
  type AdapterHealth,
  type AdapterTrace,
  type QueryAdapter,
  type QueryOptions,
} from './contracts.js';
import { combinedSignal, retry } from './retry.js';

// The REST SQL endpoint returns {"headers": [...], "data": [[...], ...]} with every value as a
// string. Rows become objects keyed by column, with numeric and boolean text converted back.
function tabularRows(headers: unknown, data: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(headers) || !Array.isArray(data) || !data.every(Array.isArray)) return undefined;
  const value = (cell: unknown) => {
    if (cell === 'true') return true;
    if (cell === 'false') return false;
    if (typeof cell === 'string' && /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cell)) {
      const number = Number(cell);
      return Number.isFinite(number) ? number : cell;
    }
    return cell;
  };
  return (data as unknown[][]).map((row) =>
    Object.fromEntries(headers.map((name, i) => [String(name), value(row[i] ?? null)]))
  );
}

// Seconds left on a JWT, read from its payload; undefined when it carries no expiry.
function secondsLeft(token: string): number | undefined {
  try {
    const part = token.split('.')[1] ?? '';
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp - Date.now() / 1000 : undefined;
  } catch {
    return undefined;
  }
}

export class ZetarisAdapter implements QueryAdapter {
  private session?: { token: string; orgId: string; renewAt: number };

  constructor(
    private config: AppConfig['zetaris'],
    private trace: AdapterTrace = () => {},
    private fetcher: typeof fetch = fetch,
    private wait?: (ms: number, signal?: AbortSignal) => Promise<void>
  ) {}

  private get signsIn(): boolean {
    return Boolean(this.config.username && this.config.password);
  }

  // With an account configured, sign in and reuse the token until a minute before it expires.
  private async credentials(signal?: AbortSignal): Promise<{ token: string; orgId: string }> {
    if (!this.signsIn) return { token: this.config.apiKey, orgId: this.config.orgId };
    if (this.session && Date.now() < this.session.renewAt) return this.session;
    let response: Response;
    try {
      response = await this.fetcher(this.config.loginUrl ?? '', {
        method: 'POST',
        signal: combinedSignal(signal, 30_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.config.username, password: this.config.password }),
      });
    } catch {
      throw new AdapterError('zetaris_network', 'Zetaris sign-in is unreachable.', true);
    }
    const text = response.ok ? await response.text() : '';
    const token = text.match(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/)?.[0];
    if (!token) {
      throw new AdapterError(
        'zetaris_auth',
        'Zetaris sign-in failed. Check ZETARIS_USERNAME and ZETARIS_PASSWORD.',
        false,
        response.ok ? 401 : response.status
      );
    }
    const orgId = text.match(/"orgId"\s*:\s*"?(\d+)/)?.[1] ?? this.config.orgId;
    const left = secondsLeft(token) ?? 600;
    this.session = { token, orgId, renewAt: Date.now() + Math.max(left - 60, 0) * 1000 };
    return this.session;
  }

  private async execute(
    sql: string,
    options: QueryOptions = {},
    renewed = false
  ): Promise<Record<string, unknown>[]> {
    if (!this.config.apiKey && !this.signsIn) {
      throw new AdapterError(
        'unconfigured',
        'Zetaris credentials are not configured.',
        false
      );
    }
    const { token, orgId } = await this.credentials(options.signal);
    const started = Date.now();
    try {
      const response = await this.fetcher(
        `${this.config.url}/sql-editor/sqls/run`,
        {
          method: 'POST',
          signal: combinedSignal(options.signal, 60_000),
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Org-ID': orgId,
            'X-Request-ID': randomUUID(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            queryId: randomUUID(),
            sql,
            source: 'SqlEditor',
            limit: options.limit ?? 10000,
          }),
        }
      );
      // A token can be revoked before it expires; sign in again once.
      if (response.status === 401 && this.signsIn && !renewed) {
        this.session = undefined;
        return await this.execute(sql, options, true);
      }
      if (!response.ok) {
        // A rejected statement comes back as HTTP 400 with {"msg": ...}; keep the message as
        // detail (for "already exists" checks) but never in the error text or trace.
        const rejected =
          response.status === 400
            ? ((await response.json().catch(() => null)) as { msg?: unknown } | null)
            : null;
        if (typeof rejected?.msg === 'string') {
          throw new AdapterError(
            'zetaris_sql',
            'Zetaris rejected the SQL statement. Check the registration schema.',
            false,
            400,
            rejected.msg.slice(0, 500)
          );
        }
        throw new AdapterError(
          'zetaris_http',
          `Zetaris request failed (HTTP ${response.status}).`,
          response.status === 429 || response.status >= 500,
          response.status
        );
      }

      const body = (await response.json()) as {
        response?: { data?: unknown };
        data?: unknown;
        headers?: unknown;
        error?: unknown;
        status?: string;
        msg?: unknown;
      };
      if (body.error || body.status === 'error' || (typeof body.msg === 'string' && body.data === undefined)) {
        throw new AdapterError(
          'zetaris_sql',
          'Zetaris rejected the SQL statement. Check the registration schema.',
          false,
          undefined,
          typeof body.msg === 'string' ? body.msg.slice(0, 500) : undefined
        );
      }

      const rows = tabularRows(body.headers, body.data) ?? body.response?.data ?? body.data;
      if (
        !Array.isArray(rows) ||
        rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))
      ) {
        throw new AdapterError(
          'zetaris_shape',
          'Zetaris returned an unexpected result shape.',
          false
        );
      }

      (options.trace ?? this.trace)({
        agent: 'DataAgent',
        action: 'zetaris_query',
        status: 'ok',
        sql,
        elapsed_ms: Date.now() - started,
        row_count: rows.length,
      });
      return rows;
    } catch (error) {
      (options.trace ?? this.trace)({
        agent: 'DataAgent',
        action: 'zetaris_query',
        status: 'fail',
        sql,
        elapsed_ms: Date.now() - started,
      });
      if (error instanceof AdapterError) throw error;
      throw new AdapterError(
        'zetaris_network',
        'Zetaris is unreachable or the request timed out.',
        true
      );
    }
  }

  async ensurePower(
    policy: Policy,
    options: { prior?: boolean; signal?: AbortSignal; trace?: AdapterTrace } = {}
  ): Promise<void> {
    const items = powerRegistrations(policy, {
      prior: options.prior,
      contactEmail: this.config.contactEmail ?? '',
    });
    const proxy: QueryAdapter = {
      health: (s) => this.health(s),
      query: (sql, opts) => this.query(sql, { ...opts, trace: options.trace }),
    };
    await registerStatements(proxy, items, {
      signal: options.signal,
      wait: this.wait ? (ms) => this.wait!(ms, options.signal) : undefined,
    });
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    options: QueryOptions = {}
  ): Promise<T[]> {
    if (!sql.trim()) {
      throw new AdapterError('invalid_sql', 'A SQL statement is required.', false);
    }
    if (!/^\s*(SELECT|WITH|SHOW|DESCRIBE)\b/i.test(sql)) {
      return (await this.execute(sql, options)) as T[];
    }
    return (await retry(() => this.execute(sql, options), {
      backoff: [2000, 4000],
      signal: options.signal,
      wait: this.wait,
      retry429Ms: 60000,
    })) as T[];
  }

  async health(signal?: AbortSignal): Promise<AdapterHealth> {
    if (!this.config.apiKey && !this.signsIn) return 'unconfigured';
    try {
      await this.execute('SELECT 1', { signal, limit: 1 });
      return 'online';
    } catch (error) {
      return error instanceof AdapterError &&
        [401, 403].includes(error.status ?? 0)
        ? 'unauthorized'
        : 'offline';
    }
  }
}
