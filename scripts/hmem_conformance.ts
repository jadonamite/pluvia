import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'logs'), { recursive: true });
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
let scorecard = '';
runner.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  scorecard += chunk;
});
runner.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  scorecard += chunk;
});
// Writes the scorecard with repository-relative paths so it can be committed as evidence.
const save = () => {
  const relative = scorecard
    .split(root + path.sep)
    .join('')
    .replace(/app\\memory\\index\.ts/g, 'app/memory/index.ts');
  writeFileSync(path.join(root, 'logs/hmem-conformance.txt'), relative);
};
runner.once('error', () => {
  process.stderr.write('The conformance runner could not start. Run npm ci first.\n');
  process.exitCode = 1;
});
runner.once('exit', (code) => {
  save();
  process.exitCode = code ?? 1;
});
