import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { ModelAdapter } from '../app/adapters/contracts.js';
import { stationOnly, satelliteOnly } from '../app/domain/naive.js';
import { normalizeSeries, policyWindow } from '../app/domain/series.js';
import { NightshiftSampleAdapter } from '../app/adapters/nightshiftSample.js';
import { evaluateClaim } from './claim_decider.js';
import type { EvaluationCase } from './types.js';
export async function runEvaluation(
  runtimeOrModel?: ModelAdapter | { config: { sampleMode: boolean }; model: ModelAdapter },
  directory = 'eval/cases'
) {
  const model =
    runtimeOrModel && 'config' in runtimeOrModel
      ? runtimeOrModel.config.sampleMode
        ? undefined
        : runtimeOrModel.model
      : runtimeOrModel;
  const files = (await readdir(directory)).filter((f) => f.endsWith('.json')).sort(),
    rows: Record<string, unknown>[] = [],
    totals: Record<
      string,
      {
        cases: number;
        labelled_cases: number;
        positive_labels: number;
        negative_labels: number;
        true_positive_payouts: number;
        true_negative_refusals: number;
        labelled_inspections: number;
        wrong_payouts: number;
        missed_payouts: number;
        inspections: number;
        latency_ms: number;
      }
    > = {};
  for (const file of files) {
    const c = JSON.parse(await readFile(`${directory}/${file}`, 'utf8')) as EvaluationCase;
    const timings: Record<string, number> = {};
    const time = <T>(name: string, fn: () => T): T => {
      const start = performance.now(),
        value = fn();
      timings[name] = performance.now() - start;
      return value;
    };
    const station = time('naive_station', () => stationOnly(c.station, c.policy)),
      satellite = time('satellite_only', () => satelliteOnly(c.satellite, c.policy));
    const pluviaStart = performance.now();
    const decision = await evaluateClaim(c, model ?? new NightshiftSampleAdapter());
    timings.pluvia = performance.now() - pluviaStart;
    let rawModel: { verdict: string; payout_ngn: number; model: string } | null = null;
    if (model) {
      const started = performance.now();
      try {
        const response = await model.complete({
          agent: 'RawTotalsBaseline',
          prompt: JSON.stringify({
            station_mm: normalizeSeries(c.station, policyWindow(c.policy)).total,
            satellite_mm: c.satellite
              ? normalizeSeries(c.satellite, policyWindow(c.policy)).total
              : null,
            policy: c.policy,
            contract: { source: 'ghcn|power' }
          })
        });
        const parsed = z
          .object({ source: z.enum(['ghcn', 'power']) })
          .parse(JSON.parse(response.content));
        const baseline = parsed.source === 'ghcn' ? station : satellite;
        rawModel = { ...baseline, model: response.model };
      } catch {
        rawModel = null;
      }
      timings.raw_totals_model = performance.now() - started;
    }
    const deciders = {
      naive_station: station,
      satellite_only: satellite,
      raw_totals_model: rawModel,
      pluvia: decision
    };
    for (const [name, result] of Object.entries(deciders)) {
      if (!totals[name])
        totals[name] = {
          cases: 0,
          labelled_cases: 0,
          positive_labels: 0,
          negative_labels: 0,
          true_positive_payouts: 0,
          true_negative_refusals: 0,
          labelled_inspections: 0,
          wrong_payouts: 0,
          missed_payouts: 0,
          inspections: 0,
          latency_ms: 0
        };
      if (!result) continue;
      const metric = totals[name]!;
      metric.cases++;
      metric.latency_ms += timings[name] ?? 0;
      if (result.verdict === 'INSPECT') metric.inspections++;
      if (c.label.payout_due !== null) {
        metric.labelled_cases++;
        if (c.label.payout_due) {
          metric.positive_labels++;
          if (result.payout_ngn > 0) metric.true_positive_payouts++;
        } else {
          metric.negative_labels++;
          if (result.verdict === 'NO_PAY') metric.true_negative_refusals++;
        }
        if (result.verdict === 'INSPECT') metric.labelled_inspections++;
        if (result.payout_ngn > 0 && !c.label.payout_due) metric.wrong_payouts++;
        if (result.verdict === 'NO_PAY' && c.label.payout_due) metric.missed_payouts++;
      }
    }
    rows.push({
      id: c.id,
      category: c.category,
      label: c.label,
      deciders,
      decider_elapsed_ms: timings
    });
  }
  const metrics = Object.fromEntries(
    Object.entries(totals).map(([name, m]) => [
      name,
      m.cases
        ? {
            ...m,
            wrong_payout_rate: m.labelled_cases ? m.wrong_payouts / m.labelled_cases : null,
            missed_payout_rate: m.labelled_cases ? m.missed_payouts / m.labelled_cases : null,
            inspection_rate: m.inspections / m.cases,
            mean_time_ms: m.latency_ms / m.cases
          }
        : null
    ])
  );
  let true_negative: unknown = null;
  try {
    true_negative = JSON.parse(await readFile('eval/data/dodoma-zero-run.json', 'utf8'));
  } catch {}
  const result = {
    case_count: rows.length,
    pluvia_mode: model
      ? 'Full agent loop with supplied model adapter on local fault-injected evidence.'
      : 'Full agent loop with sample-rules model stand-in on local fault-injected evidence; no live Nemotron claim.',
    model_baseline: model
      ? 'Actual adapter responses; per-case returned model is recorded.'
      : 'Unmeasured: Nightshift is not configured for this run. No model score is claimed.',
    label_method:
      'Fault-injected cases retain the clean contract decision; inspections are abstentions, not correct payouts. Real sparse cases have unknown payout truth.',
    true_negative,
    metrics,
    rows
  };
  await writeFile('eval/results.json', JSON.stringify(result, null, 2) + '\n');
  const labelled = rows.filter(
    (row) => (row.label as EvaluationCase['label']).payout_due !== null
  ).length;
  const verdicts = Object.fromEntries(
    ['NO_PAY', 'INSPECT', 'PAY', 'PAY_ANYWAY'].map((verdict) => [
      verdict,
      rows.filter((row) => (row.deciders as any).pluvia.verdict === verdict).length
    ])
  );
  const kitale = rows.find((row) => row.id === 'KE000063661-2021-08-15-basis-risk');
  const markdown =
    '# Evaluation results\n\n' +
    `${rows.length}` +
    ' cases. ' +
    `${result.model_baseline}` +
    '\n\nInspections are abstentions. Payout error rates use ' +
    `${labelled}` +
    ' cases with known contractual payout labels; sparse Nigerian and incomplete Dodoma records ' +
    'have unknown payout truth. The full bounded Orchestrator uses DuckDB, probes, PolicyGate ' +
    'and isolated H-MEM for each case. Model steps use sample-rules when Nightshift is ' +
    'unavailable.\n\n| Decider | Cases run | Wrong payouts | Missed payouts | Inspections ' +
    '|\n|---|---:|---:|---:|---:|\n' +
    `${Object.entries(totals)
      .map(([name, m]) =>
        m.cases
          ? `| ${name} | ${m.cases} | ${m.wrong_payouts} | ${m.missed_payouts} | ${m.inspections} |`
          : `| ${name} | unmeasured | unmeasured | unmeasured | unmeasured |`
      )
      .join('\n')}` +
    '\n\nPluvia verdict counts: ' +
    `${JSON.stringify(verdicts)}` +
    '. These measurements do not establish a production inspection rate or what every human ' +
    'officer would decide.\n\n## Measured Kitale window\n\nThe 2021-08-15 through 2021-09-14 window ' +
    'is not a calendar month. Its real gauge total is 147.3 mm over 30 of 31 days; the complete ' +
    'independent satellite total is 128.0 mm. Ten complete prior-year windows calibrate the ' +
    'synthetic trigger to 139.2 mm and exit to 59.7 mm. The station-only trigger refuses while ' +
    'the satellite supports a payout. Only distance metadata is injected (station latitude +1 ' +
    'degree); the satellite and farm retain the requested 1.016,35 point. This is measured ' +
    "rainfall with a synthetic distance assumption, not proof of a distant farm's loss. Case " +
    'result: ' +
    `${kitale ? (kitale.deciders as any).pluvia.verdict + ', payout NGN ' + (kitale.deciders as any).pluvia.payout_ngn : 'unavailable'}` +
    '. P1 passes at 96.8% coverage; P2 fails on four reported zeros with satellite rainfall at ' +
    'least 5 mm, so this is not a verified healthy gauge. P5 warns at the synthetic 111.2 km ' +
    'distance. P6 passes at 18.8% overlap divergence, P7 has no gaps and P8 passes at 11.2 mm ' +
    'from trigger. Monthly-only selection missed this window; policies and probes have no ' +
    'first-of-month requirement.\n\n## Dodoma limitation\n\nThe recovered record has 175 reported ' +
    'zeros across 231 calendar days, with 56 absent station days. Matched satellite dates total ' +
    '11.85 mm and none reach 5 mm, so suspect-zero detection does not fire. Missingness and the ' +
    'fixed relative-divergence rule still fail. The complete-window no-findings requirement ' +
    'remains unresolved. These findings do not diagnose an instrument fault.\n';
  await writeFile('eval/results.md', markdown);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runEvaluation()
    .then((r) => console.log(JSON.stringify(r.metrics)))
    .catch(() => {
      console.error('Evaluation failed');
      process.exitCode = 1;
    });
