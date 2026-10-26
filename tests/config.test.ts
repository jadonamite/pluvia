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
  it('runs each service live or cached on its own credential', () => {
    const zetarisOnly = loadConfig({ ZETARIS_API_KEY: 'test-key' });
    expect(zetarisOnly.sample).toEqual({ zetaris: false, nightshift: true });
    expect(zetarisOnly.sampleMode).toBe(true);
    expect(zetarisOnly.sampleModeReason).toContain('Zetaris is live');

    const nightshiftOnly = loadConfig({ METERLESS_RUNTIME_TOKEN: 'test-token' });
    expect(nightshiftOnly.sample).toEqual({ zetaris: true, nightshift: false });
    expect(nightshiftOnly.sampleMode).toBe(true);
    expect(nightshiftOnly.sampleModeReason).toContain('Nightshift is live');

    const both = loadConfig({ ZETARIS_API_KEY: 'k', METERLESS_RUNTIME_TOKEN: 't' });
    expect(both.sample).toEqual({ zetaris: false, nightshift: false });
    expect(both.sampleMode).toBe(false);
  });
  it('lets an explicit flag override both services', () => {
    expect(loadConfig({ ZETARIS_API_KEY: 'k', SAMPLE_MODE: 'true' }).sample).toEqual({
      zetaris: true,
      nightshift: true
    });
    expect(loadConfig({ SAMPLE_MODE: 'false' }).sample).toEqual({
      zetaris: false,
      nightshift: false
    });
  });
  it('exposes the automatic choice in health', async () => {
    const config = loadConfig({});
    const runtime = await createRuntime({ config, stdout: false });
    try {
      expect(await runtime.orchestrator.health()).toMatchObject({
        sample_mode: true,
        sample_mode_reason: config.sampleModeReason
      });
    } finally {
      await runtime.close();
    }
  });
});
