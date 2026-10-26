import { loadConfig, type AppConfig } from './config.js';
import { Orchestrator } from './orchestrator.js';
import { ZetarisAdapter } from './adapters/zetaris.js';
import { NightshiftAdapter } from './adapters/nightshift.js';
import type { ModelAdapter, QueryAdapter } from './adapters/contracts.js';

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

  if (config.sampleMode) {
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
      query = new Query({ dataDirectory: options.dataDirectory });
      model = new Model({ dataDirectory: options.dataDirectory });
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

  const orchestrator = new Orchestrator({
    query,
    model,
    sampleMode: config.sampleMode,
    sampleModeReason: config.sampleModeReason,
    logDirectory: options.logDirectory,
    stdout: options.stdout,
  });

  return {
    config,
    query,
    model,
    orchestrator,
    close: async () => {
      await query.close?.();
    },
  };
}
