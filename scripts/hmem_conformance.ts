import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'logs'), { recursive: true });
const output = openSync(path.join(root, 'logs/hmem-conformance.txt'), 'w', 0o600);
const runner = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'scripts/vendor/hmem/conformance/runner.ts')
  ],
  {
    cwd: root,
    env: { ...process.env, HMEM_IMPL: path.join(root, 'app/memory/index.ts') },
    stdio: ['ignore', 'pipe', 'pipe']
  }
);
const { writeSync } = await import('node:fs');
runner.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  writeSync(output, chunk);
});
runner.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  writeSync(output, chunk);
});
runner.once('error', () => {
  closeSync(output);
  process.stderr.write('The conformance runner could not start. Run npm ci first.\n');
  process.exitCode = 1;
});
runner.once('exit', (code) => {
  closeSync(output);
  process.exitCode = code ?? 1;
});
