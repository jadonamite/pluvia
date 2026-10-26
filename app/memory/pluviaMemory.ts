import {mkdirSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import { HMEM, type FeedbackKind } from './index.js';
import type { Claim,Decision,MemoryConflict,Policy,ProbeResult } from '../types.js';
import type { AdapterTrace } from '../adapters/contracts.js';
export class PluviaMemory {
 readonly engine:HMEM;
 private conflicts:Record<string,MemoryConflict[]>={};
 constructor(private directory='logs/memory',private trace:AdapterTrace=()=>{}) {
  mkdirSync(directory,{recursive:true});this.engine=new HMEM({persistDir:directory,actor:'pluvia'});
  const file=path.join(directory,'pluvia-conflicts.json');if(existsSync(file))this.conflicts=JSON.parse(readFileSync(file,'utf8'));
 }
 recall(policy:Policy){
  const tag=`station:${policy.ref_station_id}`,season=`window:${policy.window_start}:${policy.window_end}`;
  const result=this.engine.query(`${policy.ref_station_id} ${policy.crop} rainfall record station lesson`,{topN:100,threshold:0});
  const memories=result.memories.filter(m=>m.memory.tags.includes(tag)&&m.memory.tags.includes(season)).slice(0,5).map(m=>({id:m.memory.id,content:m.memory.content}));
  this.trace({agent:'PlannerAgent',action:'memory_recall',memory_op:'recall',status:'ok',count:memories.length});return memories;
 }
 writePrecedent(runId:string,claim:Claim,policy:Policy,decision:Decision):string {
  const record=this.engine.add({content:`Station ${policy.ref_station_id} claim ${claim.claim_id}: ${decision.verdict}. ${decision.reasons.join(' ')}`,type:'general',layer:'working',tags:[...this.tags(policy),'procedural','precedent'],confidence:0.9,source:'deterministic_policy_gate',provenance:{origin:'plan_completion',learnedAt:Date.now(),label:'PolicyGate decision',refs:[runId,claim.claim_id,...decision.probes.map(p=>p.id)]}});
  this.trace({agent:'Memory',action:'write_precedent',memory_op:'write',status:'ok',memory_id:record.id});return record.id;
 }
 writeStationLesson(runId:string,policy:Policy,probes:ProbeResult[]):string {
  const p1=probes.find(p=>p.id==='P1'),failed=probes.filter(p=>p.status!=='pass').map(p=>`${p.id}: ${p.evidence}`).join(' ');
  const record=this.engine.add({content:`Station ${policy.ref_station_id} rainfall record lesson: ${failed||'all probes passed'}`,type:'factual',layer:'working',tags:[...this.tags(policy),'station_lesson'],confidence:0.95,source:'deterministic_probes',provenance:{origin:'plan_completion',learnedAt:Date.now(),label:`Coverage ${p1?.metric.coverage??'unknown'}`,refs:[runId]}});
  this.trace({agent:'Memory',action:'write_station_lesson',memory_op:'write',status:'ok',memory_id:record.id});return record.id;
 }
 recordConflict(runId:string,policy:Policy,stationMm:number,satelliteMm:number):MemoryConflict[] {
  const key=this.scope(policy),source=(mm:number)=>this.engine.add({content:`Station ${policy.ref_station_id} rainfall total ${mm.toFixed(1)} mm for the same observation window.`,type:'factual',tags:[...this.tags(policy),'source_conflict'],confidence:0.7,source:'observed_rainfall',provenance:{origin:'document',learnedAt:Date.now(),label:'Independent source comparison',refs:[runId]}});
  const a=source(stationMm),b=source(satelliteMm),found=this.engine.conflicts.scan().filter(c=>[c.memoryA,c.memoryB].includes(a.id)&&[c.memoryA,c.memoryB].includes(b.id));
  const conflicts:MemoryConflict[]=found.map(c=>{const result=this.engine.conflicts.autoResolve(c);const entry=[...this.engine.ledger.all()].reverse().find(e=>e.action==='conflict_resolved'&&e.details?.conflictId===c.id);return {id:`${runId}:${c.id}`,status:result==='resolved'?'resolved':'open',resolution_confidence:result==='resolved'?Number(entry?.details?.decisionConfidence??0):0};});
  if(!conflicts.length)conflicts.push({id:`${runId}:source-conflict`,status:'open',resolution_confidence:0});
  this.conflicts[key]=[...(this.conflicts[key]??[]),...conflicts];writeFileSync(path.join(this.directory,'pluvia-conflicts.json'),JSON.stringify(this.conflicts,null,2)+'\n');
  this.trace({agent:'Memory',action:'source_conflict',memory_op:'conflict',status:'warn',conflicts});return this.conflicts[key]!;
 }
 conflictsFor(policy:Policy):MemoryConflict[]{return this.conflicts[this.scope(policy)]??[];}
 feedback(id:string,kind:FeedbackKind):void {this.engine.feedback(id,kind);this.trace({agent:'Memory',action:'officer_feedback',memory_op:'write',status:'ok',memory_id:id,outcome:kind});}
 exportLedger(file:string):void {writeFileSync(file,this.engine.ledger.all().map(e=>JSON.stringify(e)).join('\n')+'\n');}
 private scope(p:Policy){return `${p.ref_station_id}:${p.window_start}:${p.window_end}`;}
 private tags(p:Policy){return ['project:pluvia',`station:${p.ref_station_id}`,`crop:${p.crop}`,`window:${p.window_start}:${p.window_end}`];}
}
