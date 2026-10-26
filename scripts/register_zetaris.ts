import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { ZetarisAdapter } from '../app/adapters/zetaris.js';
import type { QueryAdapter } from '../app/adapters/contracts.js';
import { loadConfig } from '../app/config.js';
import { identifier, literal } from '../app/sql/identifiers.js';
import { powerRegistrations } from '../app/sql/power.js';
import { registerStatements, type Registration } from '../app/sql/registration.js';
export { identifier, literal, registerStatements };
export type { Registration };
export function buildRegistrations(
  stations: { id: string }[],
  policies: {
    power_table: string;
    farm_lat: number;
    farm_lon: number;
    window_start: string;
    window_end: string;
  }[],
  registerBaseUrl: string,
  contactEmail: string
): Registration[] {
  const url = new URL(registerBaseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Register URL must be public or local HTTP without credentials');
  if (!contactEmail || contactEmail.includes('your-email'))
    throw new Error('Configure CONTACT_EMAIL before registering public sources');
  const userAgent = literal(`Pluvia ${contactEmail}`),
    base = registerBaseUrl.replace(/\/$/, '');
  const items: Registration[] = [
    ...['GHCN_S3', 'POWER_REST', 'PLUVIA_REGISTER'].map((container) => ({
      container,
      metadata_sql: 'SHOW LIGHTNING DATABASES',
      sql: `CREATE LIGHTNING DATABASE ${container} DESCRIBE BY ${literal(`Pluvia ${container}`)}`
    })),
    {
      container: 'pluvia',
      metadata_sql: 'SHOW SCHEMASTORE CONTAINERS',
      sql: 'CREATE SCHEMASTORE CONTAINER pluvia'
    }
  ];
  const table = (container: string, name: string, sql: string) => {
    items.push({
      container,
      name,
      metadata_sql: `SHOW TABLES FROM ${container}`,
      sql,
      ...(container === 'GHCN_S3'
        ? { verify_columns: ['ID', 'DATE', 'ELEMENT', 'DATA_VALUE', 'M_FLAG', 'Q_FLAG', 'S_FLAG'] }
        : {})
    });
    if (container !== 'pluvia')
      items.push({
        container,
        name,
        metadata_sql: `SHOW TABLES FROM ${container}`,
        sql: `CACHE TABLE ${container}.${name}`,
        always: true
      });
  };
  for (const station of stations) {
    const id = identifier(station.id),
      name = `station_${id.toLowerCase()}`;
    table(
      'GHCN_S3',
      name,
      'CREATE LIGHTNING FILESTORE TABLE ' +
        `${name}` +
        ' FROM GHCN_S3 FORMAT CSV OPTIONS (PATH "s3a://noaa-ghcn-pds/csv/by_station/' +
        `${id}` +
        '.csv", inferSchema "true", header "true", isS3BucketPublic "true", useS3PathStyleAccess ' +
        '"true", s3Endpoint "s3.us-east-1.amazonaws.com")'
    );
  }
  if (stations.length)
    table(
      'pluvia',
      'ghcn_prcp',
      'CREATE SCHEMASTORE VIEW ghcn_prcp WITH CONTAINER pluvia AS ' +
        stations
          .map(
            (s) =>
              "SELECT ID AS station_id, to_date(CAST(DATE AS STRING), 'yyyyMMdd') AS obs_date, " +
              'CAST(DATA_VALUE AS DOUBLE) / 10.0 AS mm, M_FLAG AS m_flag, Q_FLAG AS q_flag, ' +
              `S_FLAG AS s_flag FROM GHCN_S3.station_${identifier(s.id).toLowerCase()} ` +
              "WHERE ELEMENT = 'PRCP'"
          )
          .join(' UNION ALL ')
    );
  for (const name of ['policies', 'claims', 'stations']) {
    table(
      'PLUVIA_REGISTER',
      `${name}_raw`,
      'CREATE LIGHTNING REST TABLE ' +
        `${name}` +
        '_raw FROM PLUVIA_REGISTER REQUEST(endpoint ' +
        `${literal(`${base}/${name}.json`)}` +
        ', method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent ' +
        `${userAgent}` +
        ') BODY()'
    );
    table(
      'pluvia',
      name,
      `CREATE SCHEMASTORE VIEW ${name} WITH CONTAINER pluvia AS SELECT p.* FROM PLUVIA_REGISTER.${name}_raw LATERAL VIEW explode(${name}) AS p`
    );
  }
  const seenPower = new Map<string, string>();
  for (const p of policies) {
    const signature = JSON.stringify([p.farm_lat, p.farm_lon, p.window_start, p.window_end]);
    if (seenPower.has(p.power_table)) {
      if (seenPower.get(p.power_table) !== signature)
        throw new Error('Satellite table name collision for different coordinates or windows');
      continue;
    }
    seenPower.set(p.power_table, signature);
    for (const prior of [false, true])
      items.push(...powerRegistrations(p, { prior, contactEmail }).filter((item) => !!item.name));
  }
  return items;
}
async function main() {
  const config = loadConfig(),
    base =
      process.env.REGISTER_BASE_URL ??
      'https://raw.githubusercontent.com/jadonamite/pluvia/main/data/register';
  const read = async <T>(name: string) =>
    JSON.parse(await readFile(`data/register/${name}.json`, 'utf8')) as T;
  const stations = await read<{ stations: { id: string }[] }>('stations'),
    policies = await read<{ policies: Parameters<typeof buildRegistrations>[1] }>('policies');
  if (!process.argv.includes('--print'))
    for (const name of ['policies', 'claims', 'stations']) {
      const response = await fetch(`${base}/${name}.json`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok)
        throw new Error(
          `Register ${name}.json is unreachable (HTTP ${response.status}). Serve /register locally or publish the approved register before registration.`
        );
    }
  const statements = buildRegistrations(
    stations.stations,
    policies.policies,
    base,
    config.contactEmail
  );
  if (process.argv.includes('--print')) {
    console.log(statements.map((s) => s.sql + ';').join('\n\n'));
    return;
  }
  const result = await registerStatements(new ZetarisAdapter(config.zetaris), statements, {
    signal: AbortSignal.timeout(240000)
  });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      'Registration failed. Check register URLs, CONTACT_EMAIL, credentials and Zetaris metadata syntax.'
    );
    process.exitCode = 1;
  });
