import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {EvaluationCase} from '../eval/types.js';
import {buildCases} from '../eval/build_cases.js';

describe('evaluation provenance and sample execution',()=>{
 it('keeps the checked-in results aligned with independent labels and their denominators',()=>{
  const files=readdirSync('eval/cases').filter(file=>file.endsWith('.json'));
  const cases=files.map(file=>JSON.parse(readFileSync(path.join('eval/cases',file),'utf8')) as EvaluationCase);
  const results=JSON.parse(readFileSync('eval/results.json','utf8')) as {case_count:number;model_baseline:string;rows:{id:string;category:string;label:{payout_due:boolean|null};deciders:Record<string,unknown>;decider_elapsed_ms:Record<string,number>}[];metrics:Record<string,{cases:number;labelled_cases:number}|null>};
  const report=JSON.parse(readFileSync('eval/data/build-report.json','utf8')) as {cases:number;selection:string};
  expect(files.length).toBeGreaterThan(0);
  expect(report.cases).toBe(files.length);
  expect(results.case_count).toBe(files.length);
  expect(results.rows.map(row=>row.id).sort()).toEqual(cases.map(c=>c.id).sort());
  const labelled=cases.filter(c=>typeof c.label.payout_due==='boolean');
  expect(results.metrics.pluvia).toMatchObject({cases:files.length,labelled_cases:labelled.length});
  for(const c of cases){
   expect(c.label.basis.trim().length).toBeGreaterThan(0);
   expect(typeof c.label.expected_inspection).toBe('boolean');
   expect(c.label.payout_due===null||typeof c.label.payout_due==='boolean').toBe(true);
  }
  expect(results.model_baseline).toMatch(/Unmeasured/);
  expect(results.rows.every(row=>row.deciders.raw_totals_model===null)).toBe(true);
  expect(results.rows.every(row=>['naive_station','satellite_only','pluvia'].every(name=>Number.isFinite(row.decider_elapsed_ms[name])))).toBe(true);
  expect(report.selection).toContain('No gate output used for labels');
  for(const clean of cases.filter(c=>c.category==='clean')){
   const variants=cases.filter(c=>c.id.startsWith(`${clean.id}-`));
   expect(variants.map(c=>c.category).sort()).toEqual(['drop_days','zero_fill','truncate','shift','distant_station'].sort());
   expect(variants.every(variant=>variant.label.payout_due===clean.label.payout_due&&variant.label.expected_inspection)).toBe(true);
  }
 });

 it('retains measured non-calendar Kitale evidence and reports the restored payout honestly',()=>{
  const result=JSON.parse(readFileSync('eval/results.json','utf8'));
  const row=result.rows.find((r:{id:string})=>r.id==='KE000063661-2021-08-15-basis-risk');
  expect(row.deciders.naive_station.verdict).toBe('NO_PAY');
  expect(row.deciders.pluvia.verdict).toBe('PAY_ANYWAY');
  expect(row.deciders.pluvia.payout_ngn).toBe(14088.05);
  expect(row.deciders.pluvia.probes.find((p:{id:string})=>p.id==='P2').status).toBe('fail');
  expect(row.label.basis).toContain('Distance metadata alone is injected');
 });

 it('excludes the evaluation year from Dodoma calibration and preserves the unresolved true-negative limitation',()=>{
  const calibration=JSON.parse(readFileSync('eval/data/dodoma-calibration.json','utf8')) as {annual_totals:{year:number}[];minimum_complete_years:number};
  const fixture=JSON.parse(readFileSync('eval/data/dodoma-zero-run.json','utf8')) as {reported_zero_days:number;calendar_days:number;missing_station_days:number;interpretation:string};
  expect(calibration.annual_totals.map(row=>row.year)).toEqual([2001,2002,2003]);
  expect(calibration.annual_totals.every(row=>row.year<2004)).toBe(true);
  expect(fixture).toMatchObject({reported_zero_days:175,calendar_days:231,missing_station_days:56});
  expect(fixture.interpretation).toMatch(/no-findings requirement remains unresolved/i);
 });

 it('removes stale generated cases without deleting user-authored cases and reports the disk case count',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pluvia-case-refresh-')),raw=path.join(directory,'raw'),output=path.join(directory,'cases'),report=path.join(directory,'build-report.json');
  mkdirSync(raw);mkdirSync(output);
  try{
   for(const name of ['BR038983570-old.json','NIM00065201-2024-07-01-real_sparse.json','TZ000063862-2004-old.json','notes-case.json'])writeFileSync(path.join(output,name),'{}\n');
   const result=await buildCases(raw,output,report);
   const diskFiles=readdirSync(output).filter(file=>file.endsWith('.json'));
   const buildReport=JSON.parse(readFileSync(report,'utf8')) as {cases:number;generated_cases:number;preserved_case_files:string[]};
   expect(diskFiles).toEqual(['notes-case.json']);
   expect(buildReport).toMatchObject({cases:diskFiles.length,generated_cases:result.cases.length,preserved_case_files:['notes-case.json']});
   expect(result.case_count).toBe(diskFiles.length);
  }finally{rmSync(directory,{recursive:true,force:true});}
 });

 it('recalls H-MEM evidence in a separate sample-mode Node process without using the network',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'pluvia-process-memory-'));
  const project=process.cwd(),runtimeModule=pathToFileURL(path.join(project,'app/runtime.ts')).href,configModule=pathToFileURL(path.join(project,'app/config.ts')).href;
  const code=`import {createRuntime} from ${JSON.stringify(runtimeModule)}; import {loadConfig} from ${JSON.stringify(configModule)}; const runtime=await createRuntime({config:loadConfig({SAMPLE_MODE:'true'}),logDirectory:${JSON.stringify(directory)},stdout:false}); const result=await runtime.orchestrator.run({claim_id:process.env.CLAIM_ID}); console.log(JSON.stringify({status:result.status,rounds:result.output?.decision.rounds,recalled:result.memory.recalled.length})); await runtime.close();`;
  const run=(claim:string)=>JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:project,encoding:'utf8',env:{...process.env,SAMPLE_MODE:'true',CLAIM_ID:claim}})) as {status:string;rounds:number;recalled:number};
  try{
   const first=run('CLM-LAG-2025-001'),second=run('CLM-LAG-2025-002');
   expect(first.status).toBe('success');expect(first.rounds).toBe(1);
   expect(second.status).toBe('success');expect(second.recalled).toBeGreaterThan(0);expect(second.rounds).toBe(0);
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
});
