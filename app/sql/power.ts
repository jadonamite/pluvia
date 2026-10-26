import type {Policy} from '../types.js';
import {dateTime} from '../domain/series.js';
import {identifier,literal} from './identifiers.js';
import type {Registration} from './registration.js';
export function powerRegistrations(policy:Pick<Policy,'power_table'|'farm_lat'|'farm_lon'|'window_start'|'window_end'>,options:{prior?:boolean;contactEmail:string}):Registration[]{
 if(!/^power_[A-Za-z0-9_]+_daily$/.test(policy.power_table))throw new Error('Invalid satellite view name');
 if(!Number.isFinite(policy.farm_lat)||Math.abs(policy.farm_lat)>90||!Number.isFinite(policy.farm_lon)||Math.abs(policy.farm_lon)>180)throw new Error('Invalid policy coordinates');
 dateTime(policy.window_start);dateTime(policy.window_end);if(policy.window_start>policy.window_end)throw new Error('Invalid policy window');
 if(!options.contactEmail||options.contactEmail.includes('your-email'))throw new Error('Configure CONTACT_EMAIL before registering NASA POWER');
 const view=identifier(options.prior?policy.power_table.replace(/_daily$/,'_prior_daily'):policy.power_table),raw=view.replace(/_daily$/,''),year=Number(policy.window_start.slice(0,4));
 if(options.prior&&year<=2001)throw new Error('No prior IMERG years available');
 const start=options.prior?'20010101':policy.window_start.replace(/-/g,''),end=options.prior?`${year-1}1231`:policy.window_end.replace(/-/g,'');
 const endpoint=`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=${policy.farm_lon}&latitude=${policy.farm_lat}&start=${start}&end=${end}&format=JSON&time-standard=UTC`;
 return [
  {container:'POWER_REST',metadata_sql:'SHOW LIGHTNING DATABASES',sql:'CREATE LIGHTNING DATABASE POWER_REST DESCRIBE BY "Pluvia independent precipitation"'},
  {container:'pluvia',metadata_sql:'SHOW SCHEMASTORE CONTAINERS',sql:'CREATE SCHEMASTORE CONTAINER pluvia'},
  {container:'POWER_REST',name:raw,metadata_sql:'SHOW TABLES FROM POWER_REST',sql:`CREATE LIGHTNING REST TABLE ${raw} FROM POWER_REST REQUEST(endpoint ${literal(endpoint)}, method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent ${literal(`Pluvia ${options.contactEmail}`)}) BODY()`},
  {container:'POWER_REST',name:raw,metadata_sql:'SHOW TABLES FROM POWER_REST',sql:`CACHE TABLE POWER_REST.${raw}`,always:true},
  {container:'pluvia',name:view,metadata_sql:'SHOW TABLES FROM pluvia',sql:`CREATE SCHEMASTORE VIEW ${view} WITH CONTAINER pluvia AS SELECT to_date(d, 'yyyyMMdd') AS obs_date, CASE WHEN v = -999 THEN NULL ELSE v END AS mm, ${literal(view)} AS source_id, ${policy.farm_lat} AS latitude, ${policy.farm_lon} AS longitude FROM POWER_REST.${raw} LATERAL VIEW explode(from_json(to_json(properties.parameter.IMERG_PRECTOT), 'map<string,double>')) AS d, v`}
 ];
}
