import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// A copy of the data directory with only the Lagos register, for tests written around July 2025 in Lagos.
let directory: string | undefined;
export function lagosData(): string {
  if (directory) return directory;
  directory = mkdtempSync(path.join(tmpdir(), 'pluvia-lagos-data-'));
  cpSync('data', directory, { recursive: true });
  const keep = <T extends Record<string, unknown>>(name: string, key: string, test: (row: T) => boolean) => {
    const file = path.join(directory!, 'register', `${name}.json`);
    const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, T[]>;
    writeFileSync(file, JSON.stringify({ [key]: data[key]!.filter(test) }));
  };
  keep<{ policy_id: string }>('policies', 'policies', p => p.policy_id.startsWith('POL-LAG'));
  keep<{ claim_id: string }>('claims', 'claims', c => c.claim_id.startsWith('CLM-LAG'));
  keep<{ id: string }>('stations', 'stations', s => s.id === 'NIM00065201');
  return directory;
}
