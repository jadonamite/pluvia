import { setTimeout as delay } from 'node:timers/promises';
import { AdapterError } from './contracts.js';
export function combinedSignal(parent:AbortSignal|undefined,timeoutMs:number):AbortSignal {return parent?AbortSignal.any([parent,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);}
export async function retry<T>(operation:()=>Promise<T>,options:{backoff:number[];signal?:AbortSignal;wait?:(ms:number,signal?:AbortSignal)=>Promise<void>;retry429Ms?:number}):Promise<T> {
  for(let attempt=0;;attempt++){
    options.signal?.throwIfAborted();
    try{return await operation();}catch(error){
      if(options.signal?.aborted)throw new AdapterError('cancelled','Operation cancelled or run budget exhausted.',true);
      if(!(error instanceof AdapterError)||!error.recoverable||attempt>=options.backoff.length)throw error;
      const ms=error.status===429&&options.retry429Ms!==undefined?options.retry429Ms:options.backoff[attempt]!;
      if(options.wait)await options.wait(ms,options.signal);else await delay(ms,undefined,{signal:options.signal});
    }
  }
}
