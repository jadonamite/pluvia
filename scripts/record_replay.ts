// Saves a finished live case as the replay for its claim: data/replays/<claim_id>.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Case } from '../app/agent/cases.js';

const [id, logDirectory = 'logs'] = process.argv.slice(2);
if (!id) {
  console.error('Usage: npm run record-replay -- <case_id> [log directory]');
  process.exit(1);
}
const item = JSON.parse(readFileSync(path.join(logDirectory, 'cases', `${id}.json`), 'utf8')) as Case;
if (item.replay) throw new Error('This case is itself a replay. Record a live case.');
if (!item.segments.every(segment => segment.snapshot)) throw new Error('The case is still running.');
mkdirSync('data/replays', { recursive: true });
const file = path.join('data/replays', `${item.claim_id}.json`);
writeFileSync(file, JSON.stringify(item, null, 2));
console.log(`Saved ${item.id} (${item.state}, ${item.events.length} events, models ${item.models.join(', ')}) to ${file}`);
