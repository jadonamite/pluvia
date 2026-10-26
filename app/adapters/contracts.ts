import type { Policy } from '../types.js';

export interface QueryOptions {
  signal?: AbortSignal;
  limit?: number;
  trace?: AdapterTrace;
}

export interface QueryAdapter {
  ensurePower?(
    policy: Policy,
    options?: { prior?: boolean; signal?: AbortSignal; trace?: AdapterTrace }
  ): Promise<void>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    options?: QueryOptions
  ): Promise<T[]>;
  health(signal?: AbortSignal): Promise<AdapterHealth>;
  close?(): Promise<void>;
}

export type AdapterHealth = 'online' | 'offline' | 'unauthorized' | 'unconfigured' | 'sample';

export interface ModelRequest {
  agent: string;
  prompt: string;
  system?: string;
  max_tokens?: number;
}

export interface ModelResponse {
  content: string;
  model: string;
  route?: string;
  receipt?: string;
  meterless?: unknown;
}

export interface ModelAdapter {
  readonly configuredRoute?: string;
  validationEvent?(agent: string, action: string): void;
  complete(
    request: ModelRequest,
    options?: { signal?: AbortSignal; trace?: AdapterTrace }
  ): Promise<ModelResponse>;
  health(signal?: AbortSignal): Promise<AdapterHealth>;
}

export interface AdapterTrace {
  (event: {
    agent: string;
    action: string;
    status: 'ok' | 'fail' | 'warn';
    sql?: string;
    model?: string;
    route?: string;
    receipt?: string;
    elapsed_ms?: number;
    [key: string]: unknown;
  }): void;
}

export class AdapterError extends Error {
  constructor(
    public readonly type: string,
    message: string,
    public readonly recoverable: boolean,
    public readonly status?: number,
    public readonly detail?: string
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}
