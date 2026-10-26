import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { createApp, inputSchema } from './app/server.js';
import { createRuntime, loadEnvironment, RuntimeError, type Runtime } from './app/runtime.js';
import type { RunInput } from './app/orchestrator.js';
import { buildRegistrations, registerStatements } from './scripts/register_zetaris.js';

export interface CliIO { out(value: unknown): void; error(value: unknown): void }
const defaultIO: CliIO = { out: value => process.stdout.write(JSON.stringify(value) + '\n'), error: value => process.stderr.write(JSON.stringify(value) + '\n') };
export async function readClaimArgument(value: string | undefined): Promise<{ input: RunInput; options?: { max_extra_rounds?: number } }> {
  if (!value) throw new RuntimeError('invalid_input', 'Use claim <claim-id> or claim <input.json>.');
  if (!value.endsWith('.json') && !value.startsWith('{')) { const parsed = inputSchema.safeParse({ claim_id: value }); if (!parsed.success) throw new RuntimeError('invalid_input', 'Supply a claim ID of at most 120 characters.'); return { input: parsed.data }; }
  let document: unknown;
  try { document = JSON.parse(value.startsWith('{') ? value : await readFile(value, 'utf8')); }
  catch { throw new RuntimeError('invalid_input', 'The claim JSON could not be read. Supply a readable JSON file or a claim ID.'); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new RuntimeError('invalid_input', 'The claim JSON must contain an input object.');
  const wrapped = document as { input?: unknown; options?: { max_extra_rounds?: unknown } };
  const parsed = inputSchema.safeParse('input' in wrapped ? wrapped.input : document);
  if (!parsed.success) throw new RuntimeError('invalid_input', 'The claim JSON must contain a claim_id or an event_text and valid policy fields.');
  const rounds = wrapped.options?.max_extra_rounds;
  if (rounds !== undefined && (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 0 || rounds > 2)) throw new RuntimeError('invalid_input', 'max_extra_rounds must be an integer from 0 to 2.');
  return { input: parsed.data, ...(rounds !== undefined ? { options: { max_extra_rounds: rounds as number } } : {}) };
}
// Returns true when a claim file names cached historical evidence ({"case_file": ...}) rather than a claim.
export async function isCaseFileInput(value: string | undefined): Promise<boolean> {
  if (!value?.endsWith('.json')) return false;
  try { const document = JSON.parse(await readFile(value, 'utf8')) as unknown; return !!document && typeof document === 'object' && !Array.isArray(document) && 'case_file' in document; }
  catch { return false; }
}
export async function main(args = process.argv.slice(2), io: CliIO = defaultIO, factory: () => Promise<Runtime> = () => createRuntime({ stdout: true })): Promise<number> {
  const command = args[0] ?? 'serve';
  if (!['serve', 'claim', 'health', 'register', 'eval'].includes(command)) { io.error({ status: 'error', error: { type: 'invalid_command', message: 'Use serve, claim <claim-id|input.json>, health, register, or eval.', recoverable: true } }); return 1; }
  let runtime: Runtime | undefined;
  let serving = false;
  try {
    loadEnvironment();
    if (command === 'claim' && await isCaseFileInput(args[1])) {
      const sampleCasePath = './scripts/run_sample_case.js';
      const { runSampleCase } = await import(sampleCasePath) as typeof import('./scripts/run_sample_case.js');
      let result: Awaited<ReturnType<typeof runSampleCase>>;
      try { result = await runSampleCase(args[1]!); } catch { throw new RuntimeError('invalid_case_file', 'The case file could not run. Check that case_file names cached evidence with synthetic policy terms and both rainfall sources.'); }
      io.out(result); return result.status === 'error' ? 1 : 0;
    }
    const claimRequest = command === 'claim' ? await readClaimArgument(args[1]) : undefined;
    runtime = await factory();
    if (command === 'health') { io.out(await runtime.orchestrator.health()); return 0; }
    if (command === 'claim') { const result = await runtime.orchestrator.run(claimRequest!.input, claimRequest!.options); io.out(result); return result.status === 'error' ? 1 : 0; }
    if (command === 'register') {
      if (runtime.config.sampleMode) throw new RuntimeError('sample_registration', 'Registration writes live Zetaris resources. Set SAMPLE_MODE=false and configure Zetaris to register verified data sources.');
      const stations = JSON.parse(await readFile('data/register/stations.json', 'utf8')) as { stations: { id: string }[] };
      const policies = JSON.parse(await readFile('data/register/policies.json', 'utf8')) as { policies: Parameters<typeof buildRegistrations>[1] };
      const base = process.env.REGISTER_BASE_URL ?? `http://host.docker.internal:${runtime.config.port}/register`;
      const items = buildRegistrations(stations.stations, policies.policies, base, runtime.config.contactEmail);
      io.out(await registerStatements(runtime.query, items, { signal: AbortSignal.timeout(240000) })); return 0;
    }
    if (command === 'eval') {
      const evaluationPath = './eval/run_eval.js';
      let evaluation: Record<string, unknown>;
      try { evaluation = await import(evaluationPath); } catch { throw new RuntimeError('evaluation_unavailable', 'The evaluation runner and verified case set are not installed. Add eval/run_eval.ts with a runEvaluation(runtime) export before running eval.'); }
      if (typeof evaluation.runEvaluation !== 'function') throw new RuntimeError('evaluation_contract', 'The evaluation module must export runEvaluation(runtime).');
      io.out(await evaluation.runEvaluation(runtime)); return 0;
    }
    const app = createApp(runtime.orchestrator, runtime.config.sampleMode);
    const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: runtime.config.port });
    serving = true;
    let closing = false;
    const shutdown = () => {
      if (closing) return; closing = true;
      let closePromise: Promise<void> | undefined;
      const closeRuntime = () => closePromise ??= runtime!.close().catch(() => { process.exitCode = 1; });
      const timeout = setTimeout(() => { process.exitCode = 1; if ('closeAllConnections' in server) server.closeAllConnections(); void closeRuntime(); }, 10000); timeout.unref();
      server.close(() => { clearTimeout(timeout); void closeRuntime(); });
    };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    server.on('error', () => { io.error({ status: 'error', error: { type: 'server_start_failed', message: 'The server could not listen. Check PORT and whether another process is using it.', recoverable: true } }); void runtime!.close().catch(() => { process.exitCode = 1; }); process.exitCode = 1; });
    io.out({ status: 'listening', host: '0.0.0.0', port: runtime.config.port, sample_mode: runtime.config.sampleMode, sample_mode_reason: runtime.config.sampleModeReason });
    return 0;
  } catch (error) {
    io.error({ status: 'error', error: { type: error instanceof RuntimeError ? error.type : 'runtime_error', message: error instanceof RuntimeError ? error.message : 'The command could not complete. Check configuration, local data files, and service availability.', recoverable: true } }); return 1;
  } finally { if (runtime && !serving) await runtime.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().then(code => { if (code) process.exitCode = code; }).catch(() => { defaultIO.error({ status: 'error', error: { type: 'shutdown_error', message: 'The runtime did not close cleanly.', recoverable: true } }); process.exitCode = 1; });
