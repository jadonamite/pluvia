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

export class ZetarisAdapter implements QueryAdapter {
  constructor(
    private config: AppConfig['zetaris'],
    private trace: AdapterTrace = () => {},
    private fetcher: typeof fetch = fetch,
    private wait?: (ms: number, signal?: AbortSignal) => Promise<void>
  ) {}

  private async execute(
    sql: string,
    options: QueryOptions = {}
  ): Promise<Record<string, unknown>[]> {
    if (!this.config.apiKey) {
      throw new AdapterError(
        'unconfigured',
        'Zetaris credentials are not configured.',
        false
      );
    }
    const started = Date.now();
    try {
      const response = await this.fetcher(
        `${this.config.url}/sql-editor/sqls/run`,
        {
          method: 'POST',
          signal: combinedSignal(options.signal, 60_000),
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'X-Org-ID': this.config.orgId,
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
      if (!response.ok) {
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
        error?: unknown;
        status?: string;
      };
      if (body.error || body.status === 'error') {
        throw new AdapterError(
          'zetaris_sql',
          'Zetaris rejected the SQL statement. Check the registration schema.',
          false
        );
      }

      const rows = body.response?.data ?? body.data;
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
    if (!this.config.apiKey) return 'unconfigured';
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
