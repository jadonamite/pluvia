export interface AppConfig {
  sampleMode: boolean;
  sampleModeReason: string;
  sample: { zetaris: boolean; nightshift: boolean };
  port: number;
  contactEmail: string;
  zetaris: {
    url: string;
    orgId: string;
    apiKey: string;
    loginUrl?: string;
    username?: string;
    password?: string;
    contactEmail?: string;
  };
  nightshift: { url: string; runtimeToken: string; model: string };
}

// Each service runs live or on cached evidence independently, so one configured
// service never forces the other down a live path it cannot complete.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env.SAMPLE_MODE !== undefined && !['true', 'false'].includes(env.SAMPLE_MODE)) {
    throw new Error('SAMPLE_MODE must be true or false');
  }
  const explicit = env.SAMPLE_MODE === undefined ? undefined : env.SAMPLE_MODE === 'true';
  // A local Zetaris issues short-lived sign-in tokens, so an account counts as a credential too.
  const zetarisKey =
    Boolean(env.ZETARIS_API_KEY?.trim()) ||
    Boolean(env.ZETARIS_USERNAME?.trim() && env.ZETARIS_PASSWORD);
  const nightshiftToken = Boolean(env.METERLESS_RUNTIME_TOKEN?.trim());
  const sample = {
    zetaris: explicit ?? !zetarisKey,
    nightshift: explicit ?? !nightshiftToken,
  };
  const sampleMode = sample.zetaris || sample.nightshift;
  const sampleModeReason =
    explicit !== undefined
      ? `Explicit SAMPLE_MODE=${env.SAMPLE_MODE}`
      : !zetarisKey && !nightshiftToken
        ? 'No Zetaris or Nightshift credentials supplied; using cached sample evidence'
        : sample.zetaris
          ? 'Nightshift is live; rainfall uses cached sample evidence until Zetaris is configured'
          : sample.nightshift
            ? 'Zetaris is live; model steps use the sample adapter until Nightshift is configured'
            : 'Live credentials supplied for both services';

  const port = Number(env.PORT ?? 8000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  return {
    sampleMode,
    sampleModeReason,
    sample,
    port,
    contactEmail: env.CONTACT_EMAIL ?? '',
    zetaris: {
      url: (env.ZETARIS_REST_URL ?? 'http://localhost:8888/api/v1.0').replace(/\/$/, ''),
      orgId: env.ZETARIS_ORG_ID ?? '1',
      apiKey: env.ZETARIS_API_KEY ?? '',
      loginUrl: env.ZETARIS_LOGIN_URL ?? 'http://localhost:3000/api/auth/login',
      username: env.ZETARIS_USERNAME ?? '',
      password: env.ZETARIS_PASSWORD ?? '',
      contactEmail: env.CONTACT_EMAIL ?? '',
    },
    nightshift: {
      url: (env.METERLESS_BASE_URL ?? 'http://127.0.0.1:8088/v1').replace(/\/$/, ''),
      runtimeToken: env.METERLESS_RUNTIME_TOKEN ?? '',
      model: env.METERLESS_MODEL ?? '',
    },
  };
}
