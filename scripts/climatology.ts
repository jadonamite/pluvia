import { readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { windowDates,dateTime } from '../app/domain/series.js';
export interface CalibrationInput {daily:Record<string,number|null>;window:{start:string;end:string};beforeYear:number;years?:number;minimum_complete_years?:number}
export function calibrate({daily,window,beforeYear,years=10,minimum_complete_years=8}:CalibrationInput){
 dateTime(window.start);dateTime(window.end);
 if(!Number.isInteger(beforeYear)||!Number.isInteger(years)||!Number.isInteger(minimum_complete_years)||minimum_complete_years<1||years<minimum_complete_years)throw new Error('Invalid prior-year calibration requirements');
 const annual_totals:{year:number;mm:number;days:number}[]=[];
 for(let year=beforeYear-years;year<beforeYear;year++){
  const start=`${year}${window.start.slice(4)}`,end=`${year}${window.end.slice(4)}`;
  let dates:string[];try{dates=windowDates({start,end});}catch{continue;}
  const values=dates.map(date=>daily[date.replace(/-/g,'')]??daily[date]);
  if(values.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0))continue;
  annual_totals.push({year,mm:Math.round((values as number[]).reduce((sum,value)=>sum+value,0)*100)/100,days:dates.length});
 }
 if(annual_totals.length<minimum_complete_years)throw new Error(`At least ${minimum_complete_years===8?'eight':minimum_complete_years} complete prior-year windows are required`);
 const sorted=annual_totals.map(row=>row.mm).sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
 const median_mm=sorted.length%2?sorted[middle]!:(sorted[middle-1]!+sorted[middle]!)/2;
 const trigger_mm=Math.round(median_mm*0.7*10)/10,exit_mm=Math.round(median_mm*0.3*10)/10;
 if(trigger_mm<=exit_mm)throw new Error('Calibration does not produce valid drought policy terms');
 return {trigger_mm,exit_mm,median_mm,annual_totals,minimum_complete_years,method:'Synthetic contract: trigger = 70% and exit = 30% of the median total across complete prior-year windows; rounded to 0.1 mm. Independent IMERG_PRECTOT, UTC. No claim-year observations used.'};
}
async function main(){const [input,start,end,output]=process.argv.slice(2);if(!input||!start||!end)throw new Error('Usage: tsx scripts/climatology.ts <POWER.json> <window-start> <window-end> [output.json]');const raw=JSON.parse(await readFile(input,'utf8'));const result=calibrate({daily:raw.properties.parameter.IMERG_PRECTOT,window:{start,end},beforeYear:Number(start.slice(0,4))});if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n');else console.log(JSON.stringify(result,null,2));}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message:'Calibration failed');process.exitCode=1;});
