import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildRegistrations } from './register_zetaris.js';
import { identifier, literal } from '../app/sql/identifiers.js';
import { powerRegistrations } from '../app/sql/power.js';

interface Station {
  id: string;
  name?: string;
  lat: number;
  lon: number;
  elevation_m?: number;
}

interface PolicyRecord {
  policy_id: string;
  power_table: string;
  ref_station_id: string;
  farm_lat: number;
  farm_lon: number;
  window_start: string;
  window_end: string;
  trigger_mm: number;
  exit_mm: number;
  borderline_band_mm: number;
  min_coverage: number;
  max_station_km: number;
}

export function validateEndpointUrl(urlString: string): void {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (error) {
    throw new Error(`Malformed NASA POWER URL: ${urlString} (${(error as Error).message})`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`NASA POWER endpoint must use HTTPS: ${urlString}`);
  }
  if (url.hostname !== 'power.larc.nasa.gov') {
    throw new Error(`NASA POWER endpoint hostname mismatch: ${url.hostname}`);
  }

  const params = url.searchParams;

  const parameters = params.get('parameters');
  if (parameters !== 'IMERG_PRECTOT') {
    throw new Error(
      `NASA POWER endpoint parameters must be strictly 'IMERG_PRECTOT', found: '${parameters}' in ${urlString}`
    );
  }

  const timeStandard = params.get('time-standard');
  if (timeStandard !== 'UTC') {
    throw new Error(
      `NASA POWER endpoint must include 'time-standard=UTC', found: '${timeStandard}' in ${urlString}`
    );
  }

  const community = params.get('community');
  if (community !== 'AG') {
    throw new Error(`NASA POWER endpoint community must be 'AG', found: '${community}'`);
  }

  const format = params.get('format');
  if (format !== 'JSON') {
    throw new Error(`NASA POWER endpoint format must be 'JSON', found: '${format}'`);
  }

  const start = params.get('start');
  const end = params.get('end');
  if (!start || !/^\d{8}$/.test(start)) {
    throw new Error(`NASA POWER endpoint start date must be YYYYMMDD: ${start}`);
  }
  if (!end || !/^\d{8}$/.test(end)) {
    throw new Error(`NASA POWER endpoint end date must be YYYYMMDD: ${end}`);
  }
  if (start > end) {
    throw new Error(`NASA POWER endpoint start ${start} exceeds end ${end}`);
  }

  const lat = Number(params.get('latitude'));
  const lon = Number(params.get('longitude'));
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) {
    throw new Error(`NASA POWER endpoint latitude invalid: ${params.get('latitude')}`);
  }
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) {
    throw new Error(`NASA POWER endpoint longitude invalid: ${params.get('longitude')}`);
  }
}

export function validateZetarisStatement(sql: string): void {
  if (!sql || !sql.trim()) {
    throw new Error('Empty SQL statement in registration bundle');
  }

  const trimmed = sql.trim();

  const validPrefixes = [
    'CREATE LIGHTNING DATABASE',
    'CREATE SCHEMASTORE CONTAINER',
    'CREATE LIGHTNING FILESTORE TABLE',
    'CREATE LIGHTNING REST TABLE',
    'CACHE TABLE',
    'CREATE SCHEMASTORE VIEW'
  ];

  if (!validPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    throw new Error(`Unrecognised Zetaris registration statement type: ${trimmed.slice(0, 60)}...`);
  }

  // Check identifier safety: reject raw control characters or unescaped quotes.
  if (/[\r\n]/.test(trimmed) && trimmed.startsWith('CREATE LIGHTNING DATABASE')) {
    throw new Error(`Unexpected newline in database creation statement: ${trimmed}`);
  }

  // If this statement creates a view over NASA POWER REST, check -999 fill value handling.
  if (trimmed.includes('POWER_REST.') && trimmed.startsWith('CREATE SCHEMASTORE VIEW')) {
    if (!trimmed.includes('CASE WHEN v = -999 THEN NULL ELSE v END AS mm')) {
      throw new Error(
        `NASA POWER Schemastore view is missing -999 fill-value handling (must map -999 to NULL): ${trimmed}`
      );
    }
  }

  // If this statement creates a REST table with an endpoint, validate the endpoint URL.
  const endpointMatch = trimmed.match(/endpoint\s+'([^']+)'/);
  if (endpointMatch && endpointMatch[1]?.includes('power.larc.nasa.gov')) {
    validateEndpointUrl(endpointMatch[1]);
  }
}

export function validateStationPrefix(stationId: string, stationName?: string): void {
  // Validate that Nigeria stations use the 'NI' prefix, not Niger's 'NG'.
  const isNigeria =
    /murtala|lagos|ikeja|ikorodu|kano|ibadan|abuja|nigeria/i.test(stationName ?? '') ||
    stationId.startsWith('NI');

  if (isNigeria) {
    if (stationId.startsWith('NG')) {
      throw new Error(
        `Invalid country prefix for Nigerian station '${stationId}': 'NG' is Niger; Nigerian stations must use prefix 'NI'.`
      );
    }
    if (!stationId.startsWith('NI')) {
      throw new Error(`Nigerian station '${stationId}' must begin with country prefix 'NI'.`);
    }
  }
}

export async function runDryRunValidation(): Promise<{
  statementCount: number;
  endpointCount: number;
  stationCount: number;
  policyCount: number;
}> {
  const stationsData = JSON.parse(await readFile('data/register/stations.json', 'utf8')) as {
    stations: Station[];
  };

  const policiesData = JSON.parse(await readFile('data/register/policies.json', 'utf8')) as {
    policies: PolicyRecord[];
  };

  // 1. Validate stations and NI country prefixes.
  for (const station of stationsData.stations) {
    identifier(station.id);
    validateStationPrefix(station.id, station.name);
  }

  // 2. Build registrations for all registered stations and policies.
  const testContact = 'verification@pluvia.test';
  const testBaseUrl = 'http://localhost:8000/register';
  const registrations = buildRegistrations(
    stationsData.stations,
    policiesData.policies,
    testBaseUrl,
    testContact
  );

  let endpointCount = 0;

  // 3. Validate every statement emitted.
  for (const item of registrations) {
    identifier(item.container);
    if (item.name) {
      identifier(item.name);
    }

    validateZetarisStatement(item.sql);

    if (item.sql.includes('https://power.larc.nasa.gov')) {
      endpointCount++;
    }
  }

  // 4. Validate standalone powerRegistrations for both current and prior years.
  for (const policy of policiesData.policies) {
    for (const prior of [false, true]) {
      const powerItems = powerRegistrations(policy, {
        prior,
        contactEmail: testContact
      });
      for (const item of powerItems) {
        validateZetarisStatement(item.sql);
      }
    }
  }

  // 5. Negative regression assertions to guarantee loud failure on defects.
  assertRegressionCatches();

  return {
    statementCount: registrations.length,
    endpointCount,
    stationCount: stationsData.stations.length,
    policyCount: policiesData.policies.length
  };
}

function assertRegressionCatches(): void {
  // Check that invalid identifier fails.
  let threw = false;
  try {
    identifier('power;DROP TABLE');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('Regression: identifier() failed to reject SQL injection');
  }

  // Check that invalid literal with newline fails.
  threw = false;
  try {
    literal('line1\nline2');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('Regression: literal() failed to reject unescaped newlines');
  }

  // Check that URL missing time-standard=UTC fails.
  threw = false;
  try {
    validateEndpointUrl(
      'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=3.321&latitude=6.577&start=20250701&end=20250731&format=JSON'
    );
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('Regression: validateEndpointUrl failed to catch missing time-standard=UTC');
  }

  // Check that URL with wrong parameter fails.
  threw = false;
  try {
    validateEndpointUrl(
      'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=3.321&latitude=6.577&start=20250701&end=20250731&format=JSON&time-standard=UTC'
    );
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('Regression: validateEndpointUrl failed to catch non-independent parameter');
  }

  // Check that view missing -999 fill mapping fails.
  threw = false;
  try {
    validateZetarisStatement(
      'CREATE SCHEMASTORE VIEW v WITH CONTAINER pluvia AS SELECT obs_date, v AS mm FROM POWER_REST.raw'
    );
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      'Regression: validateZetarisStatement failed to catch missing -999 fill mapping'
    );
  }

  // Check that Nigerian station with NG prefix fails.
  threw = false;
  try {
    validateStationPrefix('NGM00065201', 'MURTALA MUHAMMED');
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error("Regression: validateStationPrefix failed to reject 'NG' prefix for Nigeria");
  }
}

async function main(): Promise<void> {
  const result = await runDryRunValidation();
  console.log(
    'Live paths dry-run verification passed: ' +
      `${result.statementCount}` +
      ' statements, ' +
      `${result.endpointCount}` +
      ' endpoints across ' +
      `${result.stationCount}` +
      ' stations and ' +
      `${result.policyCount}` +
      ' policies.'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Dry-run verification failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
