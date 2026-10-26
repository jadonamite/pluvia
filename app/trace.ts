import { appendFileSync,mkdirSync } from 'node:fs';
import path from 'node:path';
import type { TraceEvent } from './types.js';
const sensitive=/authorization|api[_-]?key|secret|token|password/i;
export function redact(value:unknown):unknown {
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sensitive.test(key)?'[redacted]':redact(item)]));
  if(typeof value==='string')return value.replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/\b(?:sk-|nvapi-)[A-Za-z0-9_-]+/g,'[redacted]');
  return value;
}
export function createTrace(runId:string,options:{directory?:string;stdout?:boolean}={}) {
  if(!/^[A-Za-z0-9_-]+$/.test(runId))throw new Error('Invalid run identifier');
  const directory=options.directory??'logs';mkdirSync(directory,{recursive:true});
  const logFile=path.join(directory,`${runId}.jsonl`),events:TraceEvent[]=[];
  return {logFile,events,write(event:Omit<TraceEvent,'ts'|'run_id'>):void {
    const item=redact({...event,ts:new Date().toISOString(),run_id:runId}) as TraceEvent;
    events.push(item);const line=JSON.stringify(item)+'\n';appendFileSync(logFile,line,{mode:0o600});
    if(options.stdout!==false)process.stdout.write(line);
  }};
}
