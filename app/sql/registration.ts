import {setTimeout as delay} from 'node:timers/promises';
import type {QueryAdapter} from '../adapters/contracts.js';
export interface Registration {container:string;name?:string;sql:string;metadata_sql:string;always?:boolean;verify_columns?:string[]}
export async function registerStatements(adapter:QueryAdapter,items:Registration[],options:{signal?:AbortSignal;wait?:(ms:number)=>Promise<void>}={}):Promise<{created:number;skipped:number}>{
 let created=0,skipped=0;
 for(const item of items){
  const expected=(item.name??item.container).toLowerCase();
  const exists=async()=>{const rows=await adapter.query(item.metadata_sql,{signal:options.signal});return rows.some(row=>Object.values(row).some(value=>String(value).toLowerCase()===expected));};
  let attemptedWrite=false;
  if(await exists()&&!item.always){skipped++;}else{attemptedWrite=true;
   try{await adapter.query(item.sql,{signal:options.signal});created++;}
   catch(error){if(!/^\s*CREATE\b/i.test(item.sql)||!await exists())throw error;skipped++;}
  }
  if(item.verify_columns){const columns=await adapter.query(`DESCRIBE ${item.container}.${item.name}`,{signal:options.signal}),names=new Set(columns.flatMap(row=>Object.values(row).map(value=>String(value).toUpperCase())));if(item.verify_columns.some(name=>!names.has(name)))throw new Error(`Source schema mismatch: ${item.container}.${item.name}`);}
  if(attemptedWrite){if(options.wait)await options.wait(5000);else await delay(5000,undefined,{signal:options.signal});}
 }
 return {created,skipped};
}
