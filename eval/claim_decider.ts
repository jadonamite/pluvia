import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ModelAdapter } from '../app/adapters/contracts.js';
import { ZetarisSampleAdapter } from '../app/adapters/zetarisSample.js';
import { Orchestrator } from '../app/orchestrator.js';
import type { EvaluationCase } from './types.js';
export async function evaluateClaim(c: EvaluationCase, model: ModelAdapter) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pluvia-eval-')),
    data = path.join(dir, 'data');
  let query: ZetarisSampleAdapter | undefined;
  try {
    for (const sub of ['register', 'snapshots/ghcn', 'snapshots/power'])
      await mkdir(path.join(data, sub), { recursive: true });
    await writeFile(
      path.join(data, 'register/policies.json'),
      JSON.stringify({ policies: [c.policy] })
    );
    await writeFile(
      path.join(data, 'register/claims.json'),
      JSON.stringify({
        claims: [
          {
            claim_id: c.id,
            policy_id: c.policy.policy_id,
            submitted_at: c.policy.window_end + 'T12:00:00Z',
            event_text: 'Evaluation drought claim (synthetic)',
            synthetic: true
          }
        ]
      })
    );
    await writeFile(
      path.join(data, 'register/stations.json'),
      JSON.stringify({
        stations: [
          { id: c.station.id, lat: c.station.lat, lon: c.station.lon, name: 'Evaluation station' }
        ]
      })
    );
    const csv =
      'ID,DATE,ELEMENT,DATA_VALUE,M_FLAG,Q_FLAG,S_FLAG,OBS_TIME\n' +
      c.station.days
        .filter((d) => d.mm !== null)
        .map((d) =>
          [
            c.station.id,
            d.date.replace(/-/g, ''),
            'PRCP',
            Math.round(d.mm! * 10),
            d.m_flag ?? '',
            d.q_flag ?? '',
            d.s_flag ?? '',
            ''
          ].join(',')
        )
        .join('\n') +
      '\n';
    await writeFile(path.join(data, 'snapshots/ghcn', `${c.station.id}.csv`), csv);
    if (!c.satellite) throw new Error('Evaluation snapshot has no satellite source');
    const name = c.policy.power_table.replace(/^power_/, '').replace(/_daily$/, '');
    await writeFile(
      path.join(data, 'snapshots/power', `${name}.json`),
      JSON.stringify({
        geometry: { coordinates: [c.satellite.lon, c.satellite.lat] },
        properties: {
          parameter: {
            IMERG_PRECTOT: Object.fromEntries(
              c.satellite.days.map((d) => [d.date.replace(/-/g, ''), d.mm ?? -999])
            )
          }
        }
      })
    );
    query = new ZetarisSampleAdapter({ dataDirectory: data });
    const run = await new Orchestrator({
      query,
      model,
      sampleMode: true,
      logDirectory: path.join(dir, 'logs'),
      stdout: false
    }).run({ claim_id: c.id });
    if (!run.output) throw new Error('Evaluation claim failed before a guarded decision');
    return {
      ...run.output.decision,
      run_status: run.status,
      model_names: [
        ...new Set(run.trace.filter((e) => e.action === 'model_response').map((e) => e.model))
      ],
      agent_names: run.agents.map((a) => a.name),
      evidence_requests: run.trace.filter((e) => e.action === 'request_evidence').length
    };
  } finally {
    await query?.close();
    await rm(dir, { recursive: true, force: true });
  }
}
