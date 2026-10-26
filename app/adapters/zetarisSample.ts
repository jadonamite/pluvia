import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { AdapterError, type AdapterHealth, type QueryAdapter, type QueryOptions } from './contracts.js';
import { identifier, literal } from '../../scripts/register_zetaris.js';

export class ZetarisSampleAdapter implements QueryAdapter {
  private instance?: DuckDBInstance;
  private connection?: DuckDBConnection;
  private initialization?: Promise<void>;
  private closed = false;
  constructor(private options: { dataDirectory?: string } = {}) {}
  private async initialize(): Promise<void> {
    if (this.closed) throw new AdapterError('sample_closed', 'The cached data adapter is closed.', false);
    if (!this.initialization) this.initialization = this.load();
    await this.initialization;
  }
  private async load(): Promise<void> {
    const directory = path.resolve(this.options.dataDirectory ?? 'data');
    const instance = await DuckDBInstance.create(':memory:'); this.instance = instance;
    const connection = await instance.connect(); this.connection = connection;
    try {
      await connection.run('CREATE SCHEMA pluvia');
      for (const table of ['policies', 'claims', 'stations']) {
        const file = path.join(directory, 'register', `${table}.json`);
        await connection.run(`CREATE TABLE pluvia.${table} AS SELECT entry.* FROM (SELECT unnest(${table}) AS entry FROM read_json_auto(${literal(file)}))`);
      }
      const policies = JSON.parse(await readFile(path.join(directory, 'register/policies.json'), 'utf8')) as { policies: { power_table: string; ref_station_id: string }[] };
      await connection.run('CREATE TABLE pluvia.ghcn_prcp (station_id VARCHAR, obs_date VARCHAR, mm DOUBLE, m_flag VARCHAR, q_flag VARCHAR, s_flag VARCHAR)');
      for (const station of new Set(policies.policies.map(policy => policy.ref_station_id))) {
        const csv = path.join(directory, 'snapshots', 'ghcn', `${identifier(station)}.csv`);
        await connection.run(`INSERT INTO pluvia.ghcn_prcp SELECT ID, strftime(strptime(CAST(DATE AS VARCHAR), '%Y%m%d'), '%Y-%m-%d'), CAST(DATA_VALUE AS DOUBLE)/10.0, coalesce(M_FLAG,''), coalesce(Q_FLAG,''), coalesce(S_FLAG,'') FROM read_csv(${literal(csv)}, header=true, all_varchar=true) WHERE ELEMENT='PRCP'`);
      }
      const satelliteTables = new Set(policies.policies.flatMap(policy => [policy.power_table, policy.power_table.replace(/_daily$/, '_prior_daily')]));
      for (const table of satelliteTables) {
        const name = identifier(table); await connection.run(`CREATE TABLE pluvia.${name} (obs_date VARCHAR, mm DOUBLE, source_id VARCHAR, latitude DOUBLE, longitude DOUBLE)`);
        const fileName = table.replace(/^power_/, '').replace(/_\d{4}_prior_daily$/, '_prior').replace(/_daily$/, '');
        let snapshot: { geometry?: { coordinates: number[] }; properties?: { parameter?: { IMERG_PRECTOT?: Record<string, number> } }; daily?: Record<string, number> };
        try { snapshot = JSON.parse(await readFile(path.join(directory, 'snapshots', 'power', `${fileName}.json`), 'utf8')); }
        catch (error) { if (table.endsWith('_prior_daily') && (error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        const days = snapshot.properties?.parameter?.IMERG_PRECTOT ?? snapshot.daily;
        const coordinates = snapshot.geometry?.coordinates;
        if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) throw new Error('Satellite snapshot has no source coordinates');
        if (!days || typeof days !== 'object') throw new Error('Satellite snapshot has no independent IMERG series');
        for (const [rawDate, value] of Object.entries(days)) {
          if (!/^\d{8}$/.test(rawDate)) throw new Error('Invalid cached satellite date');
          const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
          await connection.run(`INSERT INTO pluvia.${name} VALUES (?, ?, ?, ?, ?)`, [date, Number.isFinite(value) && value >= 0 ? value : null, table, coordinates[1]!, coordinates[0]!]);
        }
      }
    } catch { connection.closeSync(); instance.closeSync(); this.connection = undefined; this.instance = undefined; throw new AdapterError('sample_data_unavailable', 'The verified sample registers or rainfall snapshots could not be loaded. Check data/register and data/snapshots.', false); }
  }
  async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, options: QueryOptions = {}): Promise<T[]> {
    options.signal?.throwIfAborted();
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /;\s*\S/.test(sql)) throw new AdapterError('sample_read_only', 'The sample query surface accepts read-only evidence queries.', false);
    await this.initialize(); options.signal?.throwIfAborted();
    const abort = () => this.connection?.interrupt(); options.signal?.addEventListener('abort', abort, { once: true });
    try { const result = await this.connection!.runAndReadAll(sql); options.signal?.throwIfAborted(); const rows = result.getRowObjectsJS().map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => { if (typeof value === 'bigint') { const numeric = Number(value); if (!Number.isSafeInteger(numeric)) throw new Error('Unsafe cached integer'); return [key, numeric]; } if (value instanceof Date) return [key, ['window_start', 'window_end', 'obs_date'].includes(key) ? value.toISOString().slice(0, 10) : value.toISOString()]; return [key, value]; }))) as T[]; return options.limit === undefined ? rows : rows.slice(0, options.limit); }
    catch (error) { if (options.signal?.aborted) throw error; throw new AdapterError('sample_sql', 'The cached query failed. Check the sample schema and SQL in the trace.', false); }
    finally { options.signal?.removeEventListener('abort', abort); }
  }
  async health(signal?: AbortSignal): Promise<AdapterHealth> { signal?.throwIfAborted(); try { await this.initialize(); return 'sample'; } catch { return 'offline'; } }
  async close(): Promise<void> { this.closed = true; await this.initialization?.catch(() => {}); this.connection?.closeSync(); this.instance?.closeSync(); this.connection = undefined; this.instance = undefined; }
}
