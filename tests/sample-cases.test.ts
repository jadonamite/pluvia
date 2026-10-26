import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runSampleCase } from '../scripts/run_sample_case.js';
import { normalizeSeries } from '../app/domain/series.js';
import type { EvaluationCase } from '../eval/types.js';

const evidence = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as EvaluationCase;

describe('historical sample pairs', () => {
  it('preserves the Teresina reported zero run and its missing calendar dates', async () => {
    const fixture = evidence('eval/data/teresina-zero-run-case.json');
    expect(fixture.station.days).toHaveLength(534);
    expect(fixture.station.days.every((day) => day.mm === 0)).toBe(true);
    expect(normalizeSeries(fixture.station).missing).toBe(612);
    const result = await runSampleCase('input_examples/teresina_zero_run.json');
    expect(result.status).toBe('success');
    expect(result.output?.decision.verdict).toBe('INSPECT');
    const p2 = result.output?.decision.probes.find((probe) => probe.id === 'P2');
    expect(p2?.metric).toMatchObject({ missing_days: 612, suspect_zero_days: 15 });
    expect(
      result.trace.some(
        (event) => event.action === 'model_response' && event.model === 'sample-rules'
      )
    ).toBe(true);
    const saved = JSON.parse(readFileSync('output_examples/teresina_zero_run.json', 'utf8'));
    expect(saved.output.decision.probes).toEqual(result.output?.decision.probes);
  });

  it('does not flag Dodoma zeros as suspect while retaining its unresolved findings', async () => {
    const result = await runSampleCase('input_examples/dodoma_dry_spell.json');
    expect(result.status).toBe('success');
    expect(result.output?.decision.verdict).toBe('INSPECT');
    const probes = result.output!.decision.probes;
    expect(probes.find((probe) => probe.id === 'P2')?.metric).toMatchObject({
      suspect_zero_days: 0,
      missing_days: 56
    });
    expect(probes.find((probe) => probe.id === 'P1')?.status).toBe('fail');
    expect(probes.find((probe) => probe.id === 'P6')?.status).toBe('fail');
    const saved = JSON.parse(readFileSync('output_examples/dodoma_dry_spell.json', 'utf8'));
    expect(saved.output.decision.probes).toEqual(probes);
  });

  it('restores the Kitale payout the station-only trigger suppresses', async () => {
    const result = await runSampleCase('input_examples/kitale_basis_risk.json');
    expect(result.status).toBe('success');
    const decision = result.output!.decision;
    expect(decision.verdict).toBe('PAY_ANYWAY');
    expect(decision.payout_ngn).toBe(14088.05);
    expect(decision.index_source).toBe('power');
    expect(decision.naive.station_only.verdict).toBe('NO_PAY');
    const saved = JSON.parse(readFileSync('output_examples/kitale_basis_risk.json', 'utf8'));
    expect(saved.output.decision.verdict).toBe('PAY_ANYWAY');
    expect(saved.output.decision.probes).toEqual(decision.probes);
  });
});
