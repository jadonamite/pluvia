import { loadConfig, type AppConfig } from './config.js';
import { Orchestrator } from './orchestrator.js';
import { ZetarisAdapter } from './adapters/zetaris.js';
import { NightshiftAdapter } from './adapters/nightshift.js';
import type { ModelAdapter, QueryAdapter } from './adapters/contracts.js';
import path from 'node:path';
import { PluviaMemory } from './memory/pluviaMemory.js';
import { CaseAgent } from './agent/caseAgent.js';
import { CaseStore, type Case } from './agent/cases.js';
import { Watcher, type WatchState } from './agent/watcher.js';
import { existsSync, readFileSync } from 'node:fs';

export class RuntimeError extends Error {
  constructor(public readonly type: string, message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

export interface RuntimeOptions {
  config?: AppConfig;
  logDirectory?: string;
  stdout?: boolean;
  dataDirectory?: string;
}

export interface Runtime {
  config: AppConfig;
  query: QueryAdapter;
  model: ModelAdapter;
  orchestrator: Orchestrator;
  agent: CaseAgent;
  watcher: Watcher;
  close(): Promise<void>;
}

// Loads local environment file if present.
export function loadEnvironment(): void {
  try {
    process.loadEnvFile?.();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new RuntimeError(
        'environment_error',
        'The environment file could not be loaded. Check its syntax and permissions.'
      );
    }
  }
}

// Initializes data and model adapters and constructs the orchestrator runtime.
export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const config = options.config ?? loadConfig();
  let query: QueryAdapter;
  let model: ModelAdapter;

  if (config.sample.zetaris || config.sample.nightshift) {
    // Dynamic import paths keep optional adapters out of static module resolution.
    const queryPath = './adapters/zetarisSample.js';
    const modelPath = './adapters/nightshiftSample.js';
    let queryModule: Record<string, unknown>;
    let modelModule: Record<string, unknown>;

    try {
      [queryModule, modelModule] = await Promise.all([
        import(queryPath),
        import(modelPath),
      ]);
    } catch {
      throw new RuntimeError(
        'sample_adapter_missing',
        'SAMPLE_MODE=true requires the cached-data ZetarisSampleAdapter and NightshiftSampleAdapter modules. ' +
          'Add the sample adapters and verified snapshots, or configure live services and set SAMPLE_MODE=false. ' +
          'No live services were contacted.'
      );
    }

    if (
      typeof queryModule.ZetarisSampleAdapter !== 'function' ||
      typeof modelModule.NightshiftSampleAdapter !== 'function'
    ) {
      throw new RuntimeError(
        'sample_adapter_contract',
        'Sample modules must export ZetarisSampleAdapter and NightshiftSampleAdapter classes. ' +
          'No live services were contacted.'
      );
    }

    const Query = queryModule.ZetarisSampleAdapter as new (options?: {
      dataDirectory?: string;
    }) => QueryAdapter;
    const Model = modelModule.NightshiftSampleAdapter as new (options?: {
      dataDirectory?: string;
    }) => ModelAdapter;

    try {
      query = config.sample.zetaris
        ? new Query({ dataDirectory: options.dataDirectory })
        : new ZetarisAdapter(config.zetaris);
      model = config.sample.nightshift
        ? new Model({ dataDirectory: options.dataDirectory })
        : new NightshiftAdapter(config.nightshift);
    } catch {
      throw new RuntimeError(
        'sample_adapter_initialization',
        'The sample adapters could not open their cached data. ' +
          'Check that the verified registers and snapshots are present. ' +
          'No live services were contacted.'
      );
    }
  } else {
    query = new ZetarisAdapter(config.zetaris);
    model = new NightshiftAdapter(config.nightshift);
  }

  const logDirectory = options.logDirectory ?? 'logs';
  const memory = new PluviaMemory(path.join(logDirectory, 'memory'));
  const orchestrator = new Orchestrator({
    query,
    model,
    memory,
    sampleMode: config.sampleMode,
    sampleModeReason: config.sampleModeReason,
    sample: config.sample,
    logDirectory: options.logDirectory,
    stdout: options.stdout,
  });

  // The agent runs live only when both services are live; otherwise it replays recorded live cases.
  const live = !config.sample.zetaris && !config.sample.nightshift;
  const stationsFile = path.join(options.dataDirectory ?? 'data', 'register', 'stations.json');
  const stations = existsSync(stationsFile) ? (JSON.parse(readFileSync(stationsFile, 'utf8')).stations as { id: string; name: string }[]) : [];
  const seasonFile = path.join(options.dataDirectory ?? 'data', 'replays', 'watch-season.json');
  const season = !live && existsSync(seasonFile) ? (JSON.parse(readFileSync(seasonFile, 'utf8')) as { days: WatchState[]; investigations?: Case[] }) : undefined;
  const claimsFile = path.join(options.dataDirectory ?? 'data', 'register', 'claims.json');
  const filings = existsSync(claimsFile)
    ? (JSON.parse(readFileSync(claimsFile, 'utf8')).claims as { claim_id: string; filed_on?: string }[]).filter(c => c.filed_on).map(c => ({ claim_id: c.claim_id, filed_on: c.filed_on! }))
    : [];
  let watcher: Watcher;
  const agent = new CaseAgent({
    query,
    memory,
    store: new CaseStore(path.join(logDirectory, 'cases')),
    replayDirectory: path.join(options.dataDirectory ?? 'data', 'replays'),
    live,
    watch: (stationId, visitor) => watcher.casesFor(stationId, visitor),
    recordedInvestigations: season?.investigations,
    model: live ? { url: config.nightshift.url, token: config.nightshift.runtimeToken, primary: config.agent.model, fallback: config.agent.fallback } : undefined,
  });
  watcher = new Watcher({
    query,
    directory: logDirectory,
    stations,
    recorded: season?.days,
    filings,
    perVisitor: !live,
    onFiled: async (claimIds, visitor) => {
      for (const id of claimIds) await agent.start(id, visitor).catch(() => undefined);
    },
    // Live, the agent investigates each watch case and answers each new finding.
    handoff: live
      ? {
          open: async (item, today, notice) => (await agent.startWatch({ watch: item, today, fallbackNotice: notice, findings: item.findings })).id,
          wake: async (item, finding, today) => {
            await agent.wakeWatch(item.agent_case_id!, finding.summary, today);
            return true;
          },
        }
      : undefined,
  });

  return {
    config,
    query,
    model,
    orchestrator,
    agent,
    watcher,
    close: async () => {
      await query.close?.();
    },
  };
}
