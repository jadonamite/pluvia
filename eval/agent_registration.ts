import { identifier, literal } from '../app/sql/identifiers.js';
import { powerRegistrations } from '../app/sql/power.js';
import type { Registration } from '../app/sql/registration.js';
import type { EvaluationCase } from './types.js';

// View names for an evaluation case: its gauge and satellite series as Zetaris views over Pluvia's
// register endpoint, and the real prior years of the satellite from NASA POWER.
export function evalViews(c: Pick<EvaluationCase, 'id'>) {
  const slug = c.id.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return { slug, gauge: `eval_gauge_${slug}`, satellite: `power_eval_${slug}_daily` };
}

export function evalRegistrations(c: EvaluationCase, registerBaseUrl: string, contactEmail: string): Registration[] {
  const { slug, gauge, satellite } = evalViews(c);
  const base = registerBaseUrl.replace(/\/$/, '');
  const agent = literal(`Pluvia ${contactEmail}`);
  const rest = (name: string, series: string): Registration[] => [
    {
      container: 'PLUVIA_REGISTER',
      name,
      metadata_sql: 'SHOW TABLES FROM PLUVIA_REGISTER',
      sql: `CREATE LIGHTNING REST TABLE ${name} FROM PLUVIA_REGISTER REQUEST(endpoint ${literal(`${base}/eval/${c.id}/${series}.json`)}, method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent ${agent}) BODY()`,
    },
    { container: 'PLUVIA_REGISTER', name, metadata_sql: 'SHOW TABLES FROM PLUVIA_REGISTER', sql: `CACHE TABLE PLUVIA_REGISTER.${name}`, always: true },
  ];
  const gaugeRaw = identifier(`eval_${slug}_gauge_raw`), satelliteRaw = identifier(`eval_${slug}_satellite_raw`);
  return [
    ...rest(gaugeRaw, 'gauge'),
    {
      container: 'pluvia',
      name: gauge,
      metadata_sql: 'SHOW TABLES FROM pluvia',
      sql: `CREATE SCHEMASTORE VIEW ${identifier(gauge)} WITH CONTAINER pluvia AS SELECT d.station_id AS station_id, to_date(d.obs_date) AS obs_date, CAST(d.mm AS DOUBLE) AS mm, d.m_flag AS m_flag, d.q_flag AS q_flag, d.s_flag AS s_flag FROM PLUVIA_REGISTER.${gaugeRaw} LATERAL VIEW explode(days) AS d`,
    },
    ...rest(satelliteRaw, 'satellite'),
    {
      container: 'pluvia',
      name: satellite,
      metadata_sql: 'SHOW TABLES FROM pluvia',
      sql: `CREATE SCHEMASTORE VIEW ${identifier(satellite)} WITH CONTAINER pluvia AS SELECT to_date(d.obs_date) AS obs_date, CAST(d.mm AS DOUBLE) AS mm, d.source_id AS source_id, CAST(d.latitude AS DOUBLE) AS latitude, CAST(d.longitude AS DOUBLE) AS longitude FROM PLUVIA_REGISTER.${satelliteRaw} LATERAL VIEW explode(days) AS d`,
    },
    // The satellite's real earlier years, for the gate's prior-year check.
    ...powerRegistrations({ ...c.policy, power_table: satellite }, { prior: true, contactEmail }).filter(item => !!item.name),
  ];
}
