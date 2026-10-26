import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Orchestrator } from '../app/orchestrator.js';
import { DataAgent } from '../app/agents/data.js';
import { PluviaMemory } from '../app/memory/pluviaMemory.js';
import type { ModelAdapter, QueryAdapter } from '../app/adapters/contracts.js';
import { policy } from './fixtures.js';

function query(): QueryAdapter {
  return {
    health: async () => 'sample',
    query: async <T extends Record<string, unknown>>(sql: string) => {
      if (sql === 'SELECT * FROM pluvia.policies') return [policy] as unknown as T[];
      if (sql.includes('FROM pluvia.stations'))
        return [
          { id: policy.ref_station_id, lat: policy.farm_lat, lon: policy.farm_lon }
        ] as unknown as T[];
      const bounds = sql.match(/obs_date BETWEEN '([^']+)' AND '([^']+)'/);
      if (!bounds) return [] as T[];
      const start = Date.parse(`${bounds[1]}T00:00:00Z`),
        end = Date.parse(`${bounds[2]}T00:00:00Z`);
      const rows = [] as Record<string, unknown>[];
      for (let time = start; time <= end; time += 86400000) {
        const row: Record<string, unknown> = {
          obs_date: new Date(time).toISOString().slice(0, 10),
          mm: 10
        };
        if (sql.includes('ghcn_prcp'))
          Object.assign(row, {
            station_id: policy.ref_station_id,
            m_flag: '',
            q_flag: '',
            s_flag: ''
          });
        else
          Object.assign(row, {
            source_id: policy.power_table,
            latitude: policy.farm_lat,
            longitude: policy.farm_lon
          });
        rows.push(row);
      }
      return rows as T[];
    }
  };
}
function validModel(): ModelAdapter {
  return {
    health: async () => 'sample',
    complete: async (request) => {
      const output =
        request.agent === 'PlannerAgent'
          ? { sources: ['ghcn', 'power'], notes: 'Compare both sources.' }
          : request.agent === 'AuditorAgent'
            ? { explanation: 'P1 and P6 findings follow from the evidence.' }
            : request.agent === 'AdjudicatorAgent'
              ? {
                  action: 'decide',
                  proposed_source: 'ghcn',
                  rationale: 'Use the contractual station index.'
                }
              : { summary: 'The evidence and policy support this review.' };
      return {
        content: JSON.stringify(output),
        model: 'nvidia/nemotron-test',
        route: 'meterless/nemotron'
      };
    }
  };
}

describe('backend integration review regressions', () => {
  it('does not let a claim-window override manufacture a payout outside the policy window', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'pluvia-override-'));
    try {
      const result = await new Orchestrator({
        query: query(),
        model: validModel(),
        logDirectory: directory,
        stdout: false
      }).run({
        policy_id: policy.policy_id,
        window_override: { start: '2025-07-01', end: '2025-07-01' }
      });
      expect(result.status).toBe('success');
      expect(result.output!.decision.verdict).toBe('INSPECT');
      expect(result.output!.decision.payout_ngn).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('traces invalid model JSON retries and the deterministic fallback with the attempted model', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'pluvia-model-fallback-'));
    try {
      const model: ModelAdapter = {
        health: async () => 'sample',
        complete: async () => ({
          content: 'not JSON',
          model: 'nvidia/nemotron-test',
          route: 'meterless/nemotron'
        })
      };
      const result = await new Orchestrator({
        query: query(),
        model,
        logDirectory: directory,
        stdout: false
      }).run({ policy_id: policy.policy_id });
      const fallbackEvents = result.trace.filter((e) => e.action === 'model_json_fallback');
      expect(fallbackEvents.length).toBeGreaterThan(0);
      expect(
        fallbackEvents.every(
          (e) =>
            typeof e.model === 'string' &&
            e.model.length > 0 &&
            typeof e.route === 'string' &&
            e.route.length > 0
        )
      ).toBe(true);
      expect(
        result.trace.some(
          (e) => e.action === 'model_response' && e.model === 'nvidia/nemotron-test'
        )
      ).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects station rows whose returned identity differs from the policy reference', async () => {
    const source = query();
    const mismatched: QueryAdapter = {
      ...source,
      query: async <T extends Record<string, unknown>>(sql: string) => {
        if (sql.includes('ghcn_prcp'))
          return [{ station_id: 'OTHER', obs_date: '2025-07-01', mm: 10 }] as unknown as T[];
        return source.query<T>(sql);
      }
    };
    await expect(new DataAgent(mismatched).fetch(policy)).rejects.toThrow('mismatched provenance');
  });

  it('keeps an unresolved H-MEM conflict queued after constructing a fresh memory wrapper', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'pluvia-conflict-'));
    try {
      const first = new PluviaMemory(directory);
      const recorded = first.recordConflict('run-1', policy, 0, 100);
      expect(
        recorded.some(
          (conflict) => conflict.status === 'open' && conflict.resolution_confidence < 0.7
        )
      ).toBe(true);
      const fresh = new PluviaMemory(directory);
      expect(fresh.conflictsFor(policy)).toEqual(recorded);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
