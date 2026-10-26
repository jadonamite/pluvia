import OpenAI from 'openai';
import type { AppConfig } from '../config.js';
import {
  AdapterError,
  type AdapterHealth,
  type AdapterTrace,
  type ModelAdapter,
  type ModelRequest,
  type ModelResponse,
} from './contracts.js';
import { combinedSignal, retry } from './retry.js';

export class NightshiftAdapter implements ModelAdapter {
  private client: OpenAI;

  constructor(
    private config: AppConfig['nightshift'],
    private trace: AdapterTrace = () => {},
    private fetcher: typeof fetch = fetch,
    private wait?: (ms: number, signal?: AbortSignal) => Promise<void>
  ) {
    this.client = new OpenAI({
      apiKey: config.runtimeToken || 'unconfigured',
      baseURL: config.url,
      timeout: 180000,
      maxRetries: 0,
      fetch: fetcher,
      defaultHeaders: {
        'meterless-app': 'pluvia',
        'meterless-scope': 'user',
      },
    });
  }

  get configuredRoute(): string {
    return this.config.model;
  }

  async health(signal?: AbortSignal): Promise<AdapterHealth> {
    if (!this.config.runtimeToken || !this.config.model) {
      return 'unconfigured';
    }
    try {
      const res = await this.fetcher(`${this.config.url}/models`, {
        signal: combinedSignal(signal, 10000),
        headers: {
          Authorization: `Bearer ${this.config.runtimeToken}`,
          'meterless-app': 'pluvia',
          'meterless-scope': 'user',
        },
      });
      if ([401, 403].includes(res.status)) return 'unauthorized';
      if (!res.ok) return 'offline';

      const body = (await res.json()) as { data?: { id?: string }[] };
      const isOnline =
        Array.isArray(body.data) &&
        body.data.some(
          (m) => m.id === this.config.model && m.id.startsWith('meterless/')
        );
      return isOnline ? 'online' : 'offline';
    } catch {
      return 'offline';
    }
  }

  async complete(
    request: ModelRequest,
    options: { signal?: AbortSignal; trace?: AdapterTrace } = {}
  ): Promise<ModelResponse> {
    if (!this.config.runtimeToken || !this.config.model) {
      throw new AdapterError(
        'unconfigured',
        'Nightshift route and runtime token are not configured.',
        false
      );
    }

    return retry(
      async () => {
        const started = Date.now();
        try {
          const raw = await this.client.chat.completions.create(
            {
              model: this.config.model,
              messages: [
                ...(request.system
                  ? [{ role: 'system' as const, content: request.system }]
                  : []),
                { role: 'user', content: request.prompt },
              ],
              max_tokens: Math.max(800, request.max_tokens ?? 1200),
            },
            { signal: options.signal }
          );

          const content = raw.choices[0]?.message.content;
          if (!content?.trim()) {
            throw new AdapterError(
              'model_empty',
              'Nightshift returned no usable model content.',
              true
            );
          }
          if (!raw.model?.trim()) {
            throw new AdapterError(
              'model_evidence',
              'Nightshift did not return the served model identifier.',
              false
            );
          }

          const metadata = raw as unknown as {
            meterless?: unknown;
            receipt_id?: string;
          };
          const result: ModelResponse = {
            content,
            model: raw.model,
            route: this.config.model,
            ...(metadata.receipt_id ? { receipt: metadata.receipt_id } : {}),
            ...(metadata.meterless ? { meterless: metadata.meterless } : {}),
          };

          (options.trace ?? this.trace)({
            agent: request.agent,
            action: 'model_complete',
            status: 'ok',
            model: result.model,
            route: result.route,
            receipt: result.receipt,
            elapsed_ms: Date.now() - started,
          });

          return result;
        } catch (error) {
          (options.trace ?? this.trace)({
            agent: request.agent,
            action: 'model_complete',
            status: 'fail',
            route: this.config.model,
            elapsed_ms: Date.now() - started,
          });

          if (error instanceof AdapterError) throw error;
          const status = error instanceof OpenAI.APIError ? error.status : undefined;
          throw new AdapterError(
            'nightshift_request',
            status
              ? `Nightshift request failed (HTTP ${status}).`
              : 'Nightshift is unreachable or the request timed out.',
            status === undefined || status === 429 || status >= 500,
            status
          );
        }
      },
      { backoff: [2000, 4000, 8000], signal: options.signal, wait: this.wait }
    );
  }
}
