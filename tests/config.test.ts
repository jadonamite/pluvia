import { describe, expect, it } from 'vitest';
import { loadConfig } from '../app/config.js';
import { createRuntime } from '../app/runtime.js';

describe('configuration mode selection', () => {
  it('defaults to sample with no credentials and explains the choice', () => {
    const config = loadConfig({});
    expect(config.sampleMode).toBe(true);
    expect(config.sampleModeReason).toContain('No Zetaris or Nightshift credentials');
  });
  it('honors explicit true and false with or without credentials', () => {
    for (const credentials of [{}, { ZETARIS_API_KEY: 'test-key' }]) {
      expect(loadConfig({ ...credentials, SAMPLE_MODE: 'false' }).sampleMode).toBe(false);
      expect(loadConfig({ ...credentials, SAMPLE_MODE: 'true' }).sampleMode).toBe(true);
    }
    expect(() => loadConfig({ SAMPLE_MODE: 'invalid' })).toThrow('SAMPLE_MODE');
  });
  it('keeps partial credentials in live mode', () => {
    expect(loadConfig({ ZETARIS_API_KEY: 'test-key' }).sampleMode).toBe(false);
    expect(loadConfig({ METERLESS_RUNTIME_TOKEN: 'test-token' }).sampleMode).toBe(false);
  });
  it('exposes the automatic choice in health', async () => {
    const config = loadConfig({});
    const runtime = await createRuntime({ config, stdout: false });
    try {
      expect(await runtime.orchestrator.health()).toMatchObject({
        sample_mode: true,
        sample_mode_reason: config.sampleModeReason,
      });
    } finally { await runtime.close(); }
  });
});
