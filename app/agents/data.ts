import type { Claim, DailySeries, Policy, Window } from '../types.js';
import { z } from 'zod';
import { policySchema, claimSchema } from '../schemas.js';
import type { QueryAdapter } from '../adapters/contracts.js';
import { identifier, literal } from '../sql/identifiers.js';
import { dateTime } from '../domain/series.js';

// Executes SQL queries to fetch policy records, station rows, and satellite observations.
export class DataAgent {
  constructor(private query: QueryAdapter) {}

  // Retrieves all configured policies.
  async policies(signal?: AbortSignal): Promise<Policy[]> {
    const rows = await this.query.query('SELECT * FROM pluvia.policies', { signal });
    return rows.map(row => policySchema.parse(row));
  }

  // Retrieves all pending claims.
  async claims(signal?: AbortSignal): Promise<Claim[]> {
    const rows = await this.query.query('SELECT * FROM pluvia.claims', { signal });
    return rows.map(row => claimSchema.parse(row));
  }

  // Fetches primary ground gauge and satellite rainfall series for the policy window.
  async fetch(
    policy: Policy,
    window: Window = { start: policy.window_start, end: policy.window_end },
    signal?: AbortSignal
  ): Promise<{ station: DailySeries; satellite: DailySeries | null }> {
    dateTime(window.start);
    dateTime(window.end);

    const stationRows = await this.query.query(
      `SELECT * FROM pluvia.stations WHERE id = ${literal(policy.ref_station_id)}`,
      { signal }
    );
    const stationMeta = z
      .object({
        id: z.string(),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      })
      .parse(stationRows[0]);

    if (stationMeta.id !== policy.ref_station_id) {
      throw new Error('Reference station metadata is unavailable or mismatched');
    }

    const stationSql =
      `SELECT station_id, obs_date, mm, m_flag, q_flag, s_flag ` +
      `FROM pluvia.${identifier(policy.gauge_view ?? 'ghcn_prcp')} WHERE station_id = ${literal(policy.ref_station_id)} ` +
      `AND obs_date BETWEEN ${literal(window.start)} AND ${literal(window.end)} ` +
      `ORDER BY obs_date`;

    const satelliteSql =
      `SELECT obs_date, mm, source_id, latitude, longitude ` +
      `FROM pluvia.${identifier(policy.power_table)} ` +
      `WHERE obs_date BETWEEN ${literal(window.start)} AND ${literal(window.end)} ` +
      `ORDER BY obs_date`;

    const rows = await this.query.query(stationSql, { signal });
    if (rows.some(row => row.station_id !== policy.ref_station_id)) {
      throw new Error('Station query returned mismatched provenance');
    }

    const numeric = (value: unknown): number =>
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value)
          : NaN;

    const day = (r: Record<string, unknown>) => ({
      date:
        r.obs_date instanceof Date
          ? r.obs_date.toISOString().slice(0, 10)
          : String(r.obs_date).slice(0, 10),
      mm: Number.isFinite(numeric(r.mm)) ? numeric(r.mm) : null,
      m_flag: r.m_flag == null ? '' : String(r.m_flag),
      q_flag: r.q_flag == null ? '' : String(r.q_flag),
      s_flag: r.s_flag == null ? '' : String(r.s_flag),
    });

    const station: DailySeries = {
      source: 'ghcn',
      id: policy.ref_station_id,
      lat: Number(stationMeta.lat),
      lon: Number(stationMeta.lon),
      window,
      days: rows.map(day),
      fetched_sql: [stationSql],
    };

    let satellite: DailySeries | null = null;
    try {
      await this.query.ensurePower?.(policy, { signal });
      const sat = await this.query.query(satelliteSql, { signal });
      if (
        sat.some(
          row =>
            row.source_id !== policy.power_table ||
            numeric(row.latitude) !== policy.farm_lat ||
            numeric(row.longitude) !== policy.farm_lon
        )
      ) {
        throw new Error('Satellite query returned mismatched provenance');
      }
      satellite = {
        source: 'power',
        id: policy.power_table,
        lat: policy.farm_lat,
        lon: policy.farm_lon,
        window,
        days: sat.map(day),
        fetched_sql: [satelliteSql],
      };
    } catch {
      if (signal?.aborted) signal.throwIfAborted();
    }

    return { station, satellite };
  }

  // Fetches extra evidentiary series requested by the adjudicator.
  async fetchExtra(
    policy: Policy,
    kind: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>[]> {
    if (kind === 'prior_years') {
      await this.query.ensurePower?.(policy, { prior: true, signal });
      const priorTable = identifier(policy.power_table.replace(/_daily$/, '_prior_daily'));
      return this.query.query(
        `SELECT * FROM pluvia.${priorTable} ORDER BY obs_date`,
        { signal }
      );
    }
    if (kind === 'neighbor_station') {
      return this.query.query(
        `SELECT station_id, obs_date, mm, m_flag, q_flag, s_flag ` +
          `FROM pluvia.ghcn_prcp WHERE station_id <> ${literal(policy.ref_station_id)} ` +
          `AND obs_date BETWEEN ${literal(policy.window_start)} AND ${literal(policy.window_end)} ` +
          `ORDER BY station_id, obs_date`,
        { signal, limit: 10000 }
      );
    }
    if (kind === 'shift_window') {
      const shifted = (date: string, delta: number) =>
        new Date(dateTime(date) + delta * 86400000).toISOString().slice(0, 10);
      return this.query.query(
        `SELECT station_id, obs_date, mm, m_flag, q_flag, s_flag ` +
          `FROM pluvia.${identifier(policy.gauge_view ?? 'ghcn_prcp')} WHERE station_id = ${literal(policy.ref_station_id)} ` +
          `AND obs_date BETWEEN ${literal(shifted(policy.window_start, -3))} ` +
          `AND ${literal(shifted(policy.window_end, 3))} ORDER BY obs_date`,
        { signal }
      );
    }
    throw new Error('Unsupported evidence request.');
  }
}
