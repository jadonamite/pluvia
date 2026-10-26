import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {dateTime} from '../app/domain/series.js';
export async function fetchPowerSnapshot({lat,lon,start,end,output,contactEmail}:{lat:number;lon:number;start:string;end:string;output:string;contactEmail:string}){
 dateTime(start);dateTime(end);if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)||Math.abs(lon)>180)throw new Error('Invalid coordinates');
 if(!contactEmail)throw new Error('CONTACT_EMAIL is required when downloading public data');
 const url=new URL('https://power.larc.nasa.gov/api/temporal/daily/point');url.search=new URLSearchParams({parameters:'IMERG_PRECTOT',community:'AG',longitude:String(lon),latitude:String(lat),start:start.replace(/-/g,''),end:end.replace(/-/g,''),format:'JSON','time-standard':'UTC'}).toString();
 const response=await fetch(url,{headers:{'User-Agent':`Pluvia development snapshot ${contactEmail}`},signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error(`NASA POWER snapshot failed (HTTP ${response.status})`);
 const body=await response.json() as {properties?:{parameter?:{IMERG_PRECTOT?:unknown}}};if(!body.properties?.parameter?.IMERG_PRECTOT)throw new Error('NASA POWER response has no independent precipitation parameter');
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(body,null,2)+'\n');return {url:url.toString(),output,fetched_at:new Date().toISOString()};
}
async function main(){const [lat,lon,start,end,output]=process.argv.slice(2);if(!lat||!lon||!start||!end||!output)throw new Error('Usage: tsx scripts/fetch_raw.ts <lat> <lon> <start> <end> <output.json>');console.log(JSON.stringify(await fetchPowerSnapshot({lat:Number(lat),lon:Number(lon),start,end,output,contactEmail:process.env.CONTACT_EMAIL??''})));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message:'Snapshot failed');process.exitCode=1;});
