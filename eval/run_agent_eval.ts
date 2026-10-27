// Runs the live agent on evaluation cases. Each case's gauge and satellite series are registered in
// Zetaris as views over Pluvia's register endpoint, so the agent queries them with its own SQL.
// Needs Pluvia serving /register on port 8000, Zetaris and Nightshift. Writes eval/data/agent-live.json.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZetarisAdapter } from '../app/adapters/zetaris.js';
import { loadConfig } from '../app/config.js';
import { PluviaMemory } from '../app/memory/pluviaMemory.js';
import { CaseAgent } from '../app/agent/caseAgent.js';
import { CaseStore, type Case } from '../app/agent/cases.js';
import { registerStatements } from '../app/sql/registration.js';
import { evalRegistrations, evalViews } from './agent_registration.js';
import type { EvaluationCase } from './types.js';

export const HARD_CASES = [
  'BR037041370-2024-01-01-satellite_outlier',
  'BR038983570-2023-02-01-satellite_outlier',
  'KE000063661-2019-06-01-satellite_dry_days',
  'TZ000063894-2021-04-01-satellite_dry_days',
  'KE000063661-2021-08-15-basis-risk',
  'BR037041370-2023-01-01',
];

// What the agent's path looked like: its queries, repeats, cited figures and steps.
export function measure(c: EvaluationCase, item: Case, seconds: number) {
  const sql = item.events.filter(e => e.tool === 'sql_query').map(e => String((e.input as { sql?: string })?.sql ?? '').replace(/\s+/g, ' ').trim().toLowerCase());
  const figures = item.events.filter(e => e.kind === 'decision').flatMap(e => ((e.output as { figures?: { match: boolean }[] })?.figures ?? []));
  const verdict = item.decision?.verdict ?? 'NONE';
  const payout = item.decision?.payout_ngn ?? 0;
  const due = c.label.payout_due;
  return {
    id: c.id,
    category: c.category,
    payout_due: due,
    verdict,
    payout_ngn: payout,
    state: item.state,
    index_source: item.decision?.index_source ?? null,
    wrong_payout: due === false && payout > 0,
    missed_payout: due === true && verdict === 'NO_PAY',
    inspection: verdict === 'INSPECT',
    needless_inspection: verdict === 'INSPECT' && !c.label.expected_inspection,
    trusted_faulty_satellite: c.category.startsWith('satellite_') && item.decision?.index_source === 'power' && payout > 0,
    queries: sql.length,
    repeated_queries: sql.length - new Set(sql).size,
    figures_cited: figures.length,
    figures_reproduced: figures.filter(f => f.match).length,
    proposals: item.events.filter(e => e.kind === 'decision').length,
    steps: item.steps_used,
    seconds: Math.round(seconds),
    models: item.models,
    tokens: item.usage ?? null,
  };
}

async function main(ids: string[]) {
  const config = loadConfig();
  if (config.sample.zetaris || config.sample.nightshift) throw new Error('The agent evaluation needs live Zetaris and Nightshift.');
  const base = process.env.REGISTER_BASE_URL;
  if (!base) throw new Error('Set REGISTER_BASE_URL to the address Zetaris uses to reach Pluvia.');
  const query = new ZetarisAdapter(config.zetaris);
  const dir = mkdtempSync(path.join(tmpdir(), 'pluvia-agent-eval-'));
  const agent = new CaseAgent({
    query,
    memory: new PluviaMemory(path.join(dir, 'memory')),
    store: new CaseStore(path.join(dir, 'cases')),
    replayDirectory: dir,
    live: true,
    model: { url: config.nightshift.url, token: config.nightshift.runtimeToken, primary: config.agent.model, fallback: config.agent.fallback },
  });
  const file = 'eval/data/agent-live.json';
  const previous = (() => { try { return JSON.parse(readFileSync(file, 'utf8')).rows as { id: string }[]; } catch { return []; } })();
  const rows = previous.filter(r => !ids.includes(r.id));
  for (const id of ids) {
    const c = JSON.parse(readFileSync(`eval/cases/${id}.json`, 'utf8')) as EvaluationCase;
    await registerStatements(query, evalRegistrations(c, base, config.contactEmail), { signal: AbortSignal.timeout(1_200_000) });
    const views = evalViews(c);
    const started = Date.now();
    const item = await agent.startEvaluation(
      { claim_id: `EVAL-${c.id}`, policy_id: c.policy.policy_id, submitted_at: new Date().toISOString(), event_text: "The group reports that the season's rains failed. Please check the rainfall record before settling the claim.", synthetic: true },
      { ...c.policy, power_table: views.satellite, gauge_view: views.gauge }
    );
    while (agent.isRunning(item.id)) await new Promise(r => setTimeout(r, 5000));
    const row = measure(c, agent.store.get(item.id)!, (Date.now() - started) / 1000);
    rows.push(row);
    console.log(JSON.stringify(row));
    writeFileSync(file, JSON.stringify({ measured_at: new Date().toISOString(), note: 'The live agent on evaluation cases, each case served through Zetaris views.', rows }, null, 2) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ids = process.argv.slice(2);
  main(ids.length ? ids : HARD_CASES).catch(error => {
    console.error(`Agent evaluation failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
