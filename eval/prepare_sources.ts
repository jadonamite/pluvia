import {access,mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {CANDIDATES} from './build_cases.js';
import {fetchPowerSnapshot} from '../scripts/fetch_raw.js';
export async function prepareEvaluationSources(directory='workbench/raw',contactEmail=process.env.CONTACT_EMAIL??''){
 if(!contactEmail)throw new Error('CONTACT_EMAIL is required for public data requests');await mkdir(directory,{recursive:true});const manifest:unknown[]=[];
 for(const station of CANDIDATES){
  const url=`https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/${station.id}.csv`,csv=`${directory}/${station.id}.csv`,power=`${directory}/${station.id}_power.json`;
  try{await access(csv);}catch{const response=await fetch(url,{headers:{'User-Agent':`Pluvia development evaluation ${contactEmail}`},signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`NOAA download failed for ${station.id} (HTTP ${response.status})`);await writeFile(csv,await response.text());}
  try{await access(power);}catch{await fetchPowerSnapshot({lat:station.lat,lon:station.lon,start:'2001-01-01',end:'2024-12-31',output:power,contactEmail});}
  manifest.push({...station,station_url:url,satellite_url:`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=${station.lon}&latitude=${station.lat}&start=20010101&end=20241231&format=JSON&time-standard=UTC`,station_sha256:createHash('sha256').update(await readFile(csv)).digest('hex'),satellite_sha256:createHash('sha256').update(await readFile(power)).digest('hex')});
 }
 for(const id of ['NIM00065201','TZ000063862']){const file=`${directory}/${id}.csv`;try{await access(file);}catch{const response=await fetch(`https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/${id}.csv`,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error(`NOAA download failed for ${id}`);await writeFile(file,await response.text());}}
 try{await access(`${directory}/dodoma_prior.json`);}catch{await fetchPowerSnapshot({lat:-6.167,lon:35.767,start:'2001-01-01',end:'2003-12-31',output:`${directory}/dodoma_prior.json`,contactEmail});}
 await writeFile('eval/data/source-manifest.json',JSON.stringify({downloaded_at:new Date().toISOString(),additional_sources:[{id:'NIM00065201',station_url:'https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/NIM00065201.csv',satellite_snapshots:['data/snapshots/power/lagos_2025.json','data/snapshots/power/lagos_prior.json']},{id:'TZ000063862',station_url:'https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/TZ000063862.csv',dated_fixture:'eval/data/dodoma-zero-run.json',prior_satellite_url:'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=35.767&latitude=-6.167&start=20010101&end=20031231&format=JSON&time-standard=UTC'}],fault_positions:'Deterministic every-third-day positions; truncation removes seven trailing days; dates shift forward three days; distance fault shifts latitude one degree. No random draws or learned thresholds.',stations:manifest},null,2)+'\n');return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)prepareEvaluationSources().then(r=>console.log(JSON.stringify({sources:r.length}))).catch(error=>{console.error(error instanceof Error?error.message:'Source preparation failed');process.exitCode=1;});
