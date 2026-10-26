import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {DailySeries,Policy} from '../app/types.js';
import {normalizeSeries,windowDates} from '../app/domain/series.js';
import {payout} from '../app/domain/payout.js';
import {calibrate} from '../scripts/climatology.js';
import type {EvaluationCase} from './types.js';
export const CANDIDATES=[{id:'BR038983570',name:'Maceio',lat:-9.517,lon:-35.783},{id:'BR00E3-0070',name:'Sao Paulo',lat:-23.5,lon:-46.617},{id:'BR037041370',name:'Teresina',lat:-5.05,lon:-42.817},{id:'KE000063661',name:'Kitale',lat:1.016,lon:35},{id:'TZ000063894',name:'Dar es Salaam',lat:-6.867,lon:39.2},{id:'TZM00063870',name:'Zanzibar',lat:-6.222,lon:39.225},{id:'KE000063820',name:'Mombasa',lat:-4.033,lon:39.617},{id:'TZ000063756',name:'Mwanza',lat:-2.467,lon:32.917}] as const;
const GENERATED_STATION_IDS=[...CANDIDATES.map(candidate=>candidate.id),'NIM00065201','TZ000063862'];
export function stationRows(csv:string){const [header,...lines]=csv.trim().split(/\r?\n/);if(!header?.startsWith('ID,DATE,ELEMENT,DATA_VALUE'))throw new Error('Unexpected NOAA CSV header');return lines.map(line=>line.split(',')).filter(r=>r[2]==='PRCP').map(r=>({date:`${r[1]!.slice(0,4)}-${r[1]!.slice(4,6)}-${r[1]!.slice(6,8)}`,mm:Number(r[3])/10,m_flag:r[4]??'',q_flag:r[5]??'',s_flag:r[6]??''}));}
export function faultVariants(clean:EvaluationCase):EvaluationCase[]{
 const results=[clean];for(const category of ['drop_days','zero_fill','truncate','shift','distant_station'] as const){const c=structuredClone(clean);c.id=`${clean.id}-${category}`;c.category=category;c.label.expected_inspection=true;c.provenance.fault=category;
  if(category==='drop_days')c.station.days=c.station.days.filter((_,i)=>i%3!==0);
  if(category==='zero_fill')c.station.days=c.station.days.map((d,i)=>i%3===0?{...d,mm:0}:d);
  if(category==='truncate')c.station.days=c.station.days.slice(0,-7);
  if(category==='shift')c.station.days=c.station.days.map(d=>({...d,date:new Date(Date.parse(d.date+'T00:00:00Z')+3*86400000).toISOString().slice(0,10)}));
  if(category==='distant_station')c.station.lat+=1;
  c.label.basis=`Known ${category} fault injected into ${clean.id}; the original clean-window contractual amount is unchanged. ${clean.label.basis}`;results.push(c);
 }return results;
}
export async function buildCases(rawDirectory='workbench/raw',outputDirectory='eval/cases',reportFile='eval/data/build-report.json'){
 await mkdir(outputDirectory,{recursive:true});for(const file of await readdir(outputDirectory)){if(file.endsWith('.json')&&GENERATED_STATION_IDS.some(id=>file.startsWith(id+'-')))await unlink(path.join(outputDirectory,file));}const cases:EvaluationCase[]=[],excluded:{station:string;reason:string}[]=[];
 for(const candidate of CANDIDATES){try{
  const csv=await readFile(path.join(rawDirectory,`${candidate.id}.csv`),'utf8'),power=JSON.parse(await readFile(path.join(rawDirectory,`${candidate.id}_power.json`),'utf8'));
  const daily=power.properties.parameter.IMERG_PRECTOT as Record<string,number>,all=stationRows(csv);let selected=0;
  for(let year=2024;year>=2010&&selected<2;year--)for(let month=1;month<=12&&selected<2;month++){
   const start=`${year}-${String(month).padStart(2,'0')}-01`,end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),window={start,end};
   const station:DailySeries={source:'ghcn',id:candidate.id,lat:candidate.lat,lon:candidate.lon,window,days:all.filter(d=>d.date>=start&&d.date<=end),fetched_sql:[]};
   const satellite:DailySeries={source:'power',id:`power_${candidate.id.toLowerCase()}_daily`,lat:candidate.lat,lon:candidate.lon,window,days:windowDates(window).map(date=>({date,mm:daily[date.replace(/-/g,'')]??null})),fetched_sql:[]};
   const a=normalizeSeries(station),b=normalizeSeries(satellite);if(a.valid.length/a.days.length<.95||b.missing||a.total===0||Math.abs(a.total-b.total)>50||Math.abs(a.total-b.total)/Math.max(b.total,1)>.4)continue;
   let calibration;try{calibration=calibrate({daily,window,beforeYear:year});}catch{continue;}
   const policy:Policy={policy_id:`POL-EVAL-${candidate.id}-${start}`,group_name:`${candidate.name} evaluation cooperative (synthetic)`,crop:'maize',synthetic:true,farm_lat:candidate.lat,farm_lon:candidate.lon,ref_station_id:candidate.id,window_start:start,window_end:end,trigger_mm:calibration.trigger_mm,exit_mm:calibration.exit_mm,sum_insured_ngn:100000,borderline_band_mm:5,min_coverage:.95,max_station_km:20,power_table:satellite.id};
   const clean:EvaluationCase={id:`${candidate.id}-${start}`,category:'clean',policy,station,satellite,label:{payout_due:payout(a.total,policy)>0,expected_inspection:false,basis:`At least95% real NOAA coverage and complete independent POWER record; clean contractual station total ${a.total.toFixed(2)} mm. Trigger/exit calibrated from prior complete years using scripts/climatology.ts.`},provenance:{station_url:`https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/${candidate.id}.csv`,satellite_url:`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=${candidate.lon}&latitude=${candidate.lat}&start=20010101&end=20241231&format=JSON&time-standard=UTC`}};
   cases.push(...faultVariants(clean));selected++;
  }
  if(!selected)excluded.push({station:candidate.id,reason:'No monthly window met95% coverage, fixed source-agreement bounds and eight complete prior calibration windows.'});
 }catch(error){excluded.push({station:candidate.id,reason:error instanceof Error?error.message:'Source unavailable'});}}
 try {
  const candidate=CANDIDATES.find(c=>c.id==='KE000063661')!;
  const window={start:'2021-08-15',end:'2021-09-14'};
  const raw=JSON.parse(await readFile(path.join(rawDirectory,`${candidate.id}_power.json`),'utf8'));
  const daily=raw.properties.parameter.IMERG_PRECTOT;
  const calibration=calibrate({daily,window,beforeYear:2021});
  const station:DailySeries={source:'ghcn',id:candidate.id,lat:candidate.lat+1,lon:candidate.lon,window,days:stationRows(await readFile(path.join(rawDirectory,`${candidate.id}.csv`),'utf8')).filter(d=>d.date>=window.start&&d.date<=window.end),fetched_sql:[]};
  const satellite:DailySeries={source:'power',id:'power_kitale_2021_daily',lat:candidate.lat,lon:candidate.lon,window,days:windowDates(window).map(date=>({date,mm:daily[date.replace(/-/g,'')]??null})),fetched_sql:[]};
  const policy:Policy={policy_id:'POL-EVAL-KITALE-2021',group_name:'Kitale basis-risk demonstration (synthetic)',crop:'maize',synthetic:true,farm_lat:candidate.lat,farm_lon:candidate.lon,ref_station_id:candidate.id,window_start:window.start,window_end:window.end,trigger_mm:calibration.trigger_mm,exit_mm:calibration.exit_mm,sum_insured_ngn:100000,borderline_band_mm:5,min_coverage:.95,max_station_km:20,power_table:satellite.id};
  cases.push({id:'KE000063661-2021-08-15-basis-risk',category:'measured_basis_risk',policy,station,satellite,label:{payout_due:true,expected_inspection:false,basis:'Measured Kitale rainfall: station 147.3 mm, independent satellite 128.0 mm. Prior-year calibrated synthetic trigger 139.2 mm. Satellite-supported payout truth is contractual, not verified farm loss. Distance metadata alone is injected: station latitude +1 degree, while farm and satellite retain the original requested point 1.016,35. This demonstrates distant-station substitution without claiming a measured distant farm.'},provenance:{station_url:`https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/${candidate.id}.csv`,satellite_url:`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=35&latitude=1.016&start=20010101&end=20241231&format=JSON&time-standard=UTC`,fault:'Synthetic station distance metadata only; rainfall and satellite request point unchanged.'}});
  await writeFile('eval/data/kitale-calibration.json',JSON.stringify(calibration,null,2)+'\n');
 } catch(error) {excluded.push({station:'KE000063661 basis-risk',reason:error instanceof Error?error.message:'Kitale evidence unavailable'});}
 try{const register=JSON.parse(await readFile('data/register/policies.json','utf8')),template=register.policies[0] as Policy,raw=JSON.parse(await readFile('data/snapshots/power/lagos_prior.json','utf8')),source=stationRows(await readFile(path.join(rawDirectory,'NIM00065201.csv'),'utf8'));
 for(const year of [2024,2025]){const start=`${year}-07-01`,end=`${year}-07-31`,window={start,end},power=year===2025?JSON.parse(await readFile('data/snapshots/power/lagos_2025.json','utf8')):raw,daily=power.properties.parameter.IMERG_PRECTOT,calibration=calibrate({daily:raw.properties.parameter.IMERG_PRECTOT,window,beforeYear:year});
 const policy:Policy={...template,policy_id:`POL-EVAL-LAG-${year}`,window_start:start,window_end:end,trigger_mm:calibration.trigger_mm,exit_mm:calibration.exit_mm,power_table:`power_lagos_${year}_daily`};
 const station:DailySeries={source:'ghcn',id:policy.ref_station_id,lat:policy.farm_lat,lon:policy.farm_lon,window,days:source.filter(d=>d.date>=start&&d.date<=end),fetched_sql:[]},satellite:DailySeries={source:'power',id:policy.power_table,lat:policy.farm_lat,lon:policy.farm_lon,window,days:windowDates(window).map(date=>({date,mm:daily[date.replace(/-/g,'')]??null})),fetched_sql:[]};
 const normalized=normalizeSeries(station);cases.push({id:`NIM00065201-${start}-real_sparse`,category:'real_sparse',policy,station,satellite,label:{payout_due:null,expected_inspection:true,basis:`Real archive coverage: ${normalized.valid.length} of ${normalized.days.length} valid days. Farm loss and correct payout are unknown; label derives from independently counted missing observations, not a system decision.`},provenance:{station_url:'https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/NIM00065201.csv',satellite_url:year===2025?'data/snapshots/power/lagos_2025.json':'data/snapshots/power/lagos_prior.json'}});
 }
 }catch(error){excluded.push({station:'NIM00065201',reason:error instanceof Error?error.message:'Nigerian evidence unavailable'});}
 try{const fixture=JSON.parse(await readFile('eval/data/dodoma-zero-run.json','utf8')),prior=JSON.parse(await readFile(path.join(rawDirectory,'dodoma_prior.json'),'utf8')),window=fixture.window,calibration=calibrate({daily:prior.properties.parameter.IMERG_PRECTOT,window,beforeYear:2004,minimum_complete_years:3});
 const policy:Policy={policy_id:'POL-EVAL-DODOMA-2004',group_name:'Dodoma historical reference group (synthetic)',crop:'maize',synthetic:true,farm_lat:-6.167,farm_lon:35.767,ref_station_id:'TZ000063862',window_start:window.start,window_end:window.end,trigger_mm:calibration.trigger_mm,exit_mm:calibration.exit_mm,sum_insured_ngn:100000,borderline_band_mm:5,min_coverage:.8,max_station_km:20,power_table:'power_dodoma_2004_daily'};
 cases.push({id:'TZ000063862-2004-04-26-true-negative',category:'true_negative',policy,station:fixture.station,satellite:fixture.satellite,label:{payout_due:null,expected_inspection:true,basis:'175 reported zeros across231 calendar days,56 missing. Matched satellite dates show no rain at or above5mm, so suspect-zero count should be0. Coverage/missingness and fixedP6relative rule still fail; whole-system all-probes-pass acceptance is unresolved. Synthetic terms use only three complete prior-year windows2001–2003, the available IMERG era, explicitly lower than modern eight-year calibration minimum.'},provenance:{station_url:fixture.sources.station_url,satellite_url:fixture.sources.satellite_url}});
 await writeFile('eval/data/dodoma-calibration.json',JSON.stringify(calibration,null,2)+'\n');
 }catch(error){excluded.push({station:'TZ000063862',reason:error instanceof Error?error.message:'Dodoma prior evidence unavailable'});}
 for(const c of cases)await writeFile(path.join(outputDirectory,`${c.id}.json`),JSON.stringify(c,null,2)+'\n');
 const diskCases=(await readdir(outputDirectory)).filter(file=>file.endsWith('.json'));
 const preserved_case_files=diskCases.filter(file=>!cases.some(c=>file===`${c.id}.json`));
 await writeFile(reportFile,JSON.stringify({cases:diskCases.length,generated_cases:cases.length,preserved_case_files,excluded,selection:'Prescribed candidate stations only; at least95% station coverage for calendar-month selection; explicit non-calendar Kitale basis-risk window, complete satellite coverage; source gap <=40% and <=50mm; most recent qualifying month. Fault positions deterministic every third day. No gate output used for labels.'},null,2)+'\n');return {cases,excluded,case_count:diskCases.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)buildCases().then(r=>console.log(JSON.stringify({cases:r.case_count,generated_cases:r.cases.length,excluded:r.excluded}))).catch(()=>{console.error('Evaluation case build failed');process.exitCode=1;});
