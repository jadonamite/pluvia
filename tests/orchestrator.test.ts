import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Orchestrator} from '../app/orchestrator.js';
import {PluviaMemory} from '../app/memory/pluviaMemory.js';
import type {ModelAdapter,QueryAdapter,QueryOptions} from '../app/adapters/contracts.js';
import {policy,series} from './fixtures.js';
function fakeQuery(sparse=false):QueryAdapter {return {health:async()=>'sample',query:async<T extends Record<string,unknown>>(sql:string,_options?:QueryOptions)=>{
 let rows:unknown[]=[];
 if(sql==='SELECT * FROM pluvia.policies')rows=[policy];
 else if(sql==='SELECT * FROM pluvia.claims')rows=[{claim_id:'CLM-A',policy_id:policy.policy_id,submitted_at:'2025-07-11',event_text:'Drought',synthetic:true}];
 else if(sql.includes('FROM pluvia.stations'))rows=[{id:'TEST',lat:policy.farm_lat,lon:policy.farm_lon}];
 else if(sql.includes('ghcn_prcp'))rows=series('ghcn',sparse?1:10).days.slice(sparse?7:0).map(d=>({station_id:policy.ref_station_id,obs_date:d.date,mm:d.mm}));
 else if(sql.includes('prior_daily'))rows=[{obs_date:'2024-07-01',mm:10}];
 else if(sql.includes('power_test_2025_daily'))rows=series('power').days.map(d=>({source_id:policy.power_table,latitude:policy.farm_lat,longitude:policy.farm_lon,obs_date:d.date,mm:d.mm}));
 return rows as T[];
 }};}
function fakeModel():ModelAdapter{return {health:async()=>'sample',complete:async request=>{
 const p=JSON.parse(request.prompt).payload;let output:unknown={};
 if(request.agent==='PlannerAgent')output={sources:['ghcn','power'],notes:'Compare records.'};
 if(request.agent==='AuditorAgent')output={explanation:'P1 and P6 are supported by recorded daily evidence.'};
 if(request.agent==='AdjudicatorAgent')output=p.round===0&&!p.recalled.length?{action:'request_evidence',kind:'prior_years'}:{action:'decide',proposed_source:'power',rationale:'P1 P2 P4 P5 P6',counter_case:'Local drought could have differed from the index.'};
 if(request.agent==='ReporterAgent')output={summary:'Review the attached probe findings.'};
 return {content:JSON.stringify(output),model:'sample-rules'};
 }};}
describe('bounded agent loop and persistent memory',()=>{
 it('runs real probes/gate, requests evidence, records model/sql trace and recalls a lesson in a fresh memory instance',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pluvia-loop-'));
  try{const dependencies={query:fakeQuery(true),model:fakeModel(),logDirectory:dir,sampleMode:true,stdout:false};
   const first=await new Orchestrator(dependencies).run({claim_id:'CLM-A'});
   expect(first.status).toBe('success');expect(first.output!.decision.verdict).toBe('INSPECT');expect(first.output!.naive.station_only.verdict).toBe('PAY');expect(first.output!.decision.rounds).toBe(1);
   expect(first.trace.some(e=>e.action==='request_evidence')).toBe(true);expect(first.trace.some(e=>e.sql?.includes('SELECT'))).toBe(true);expect(first.trace.filter(e=>e.action==='model_response').every(e=>e.model==='sample-rules')).toBe(true);
   expect(first.memory.conflicts.length).toBeGreaterThan(0);
   const second=await new Orchestrator(dependencies).run({claim_id:'CLM-A'});
   expect(second.memory.recalled.length).toBeGreaterThan(0);expect(second.output!.decision.rounds).toBe(0);expect(second.output!.decision.verdict).toBe('INSPECT');
   const memory=new PluviaMemory(path.join(dir,'memory'));const id=second.memory.written[0]!;const previous=memory.engine.store.get(id)!.confidence;memory.feedback(id,'wrong');expect(memory.engine.store.get(id)!.confidence).toBeCloseTo(previous-0.2);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
 it('caps repeated evidence requests at two and returns inspection',async()=>{const dir=mkdtempSync(path.join(tmpdir(),'pluvia-bounds-'));try{const model=fakeModel(),complete=model.complete;model.complete=async(request,options)=>request.agent==='AdjudicatorAgent'?{content:JSON.stringify({action:'request_evidence',kind:'prior_years'}),model:'sample-rules'}:complete(request,options);const result=await new Orchestrator({query:fakeQuery(),model,logDirectory:dir,stdout:false}).run({claim_id:'CLM-A'},{max_extra_rounds:99});expect(result.output!.decision.rounds).toBe(2);expect(result.output!.decision.verdict).toBe('INSPECT');}finally{rmSync(dir,{recursive:true,force:true});}});
 it('returns structured errors for unknown claim and malformed model outputs',async()=>{const dir=mkdtempSync(path.join(tmpdir(),'pluvia-errors-'));try{const app=new Orchestrator({query:fakeQuery(),model:{health:async()=>'sample',complete:async()=>({content:'invalid',model:'sample-rules'})},logDirectory:dir,stdout:false});expect((await app.run({claim_id:'missing'})).status).toBe('error');const result=await app.run({claim_id:'CLM-A'});expect(result.status).toBe('success');expect(result.output!.decision.verdict).toBe('PAY');expect(app.getRun(result.run_id)).toBe(result);}finally{rmSync(dir,{recursive:true,force:true});}});
});
