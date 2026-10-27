// Runs the watcher's season on a live server one day at a time and saves each day: data/replays/watch-season.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { WatchState } from '../app/agent/watcher.js';

const base = process.argv[2] ?? 'http://localhost:8000';
const call = async (route: string) => {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error(`${route} answered ${response.status}`);
  return (await response.json()) as WatchState & { recorded?: boolean };
};
const health = (await (await fetch(`${base}/health`)).json()) as { sample_mode?: boolean };
if (health.sample_mode !== false) throw new Error('The server is in sample mode. Record the season from a live server.');
await call('/watch/reset');
const days: WatchState[] = [];
for (;;) {
  const { recorded: _recorded, ...state } = await call('/watch/advance');
  if (state.today === days.at(-1)?.today) break;
  days.push(state);
}
mkdirSync('data/replays', { recursive: true });
writeFileSync('data/replays/watch-season.json', JSON.stringify({ recorded_at: new Date().toISOString(), days }, null, 2));
console.log(`Saved ${days.length} days, ${days.at(-1)?.cases.length ?? 0} watch cases, to data/replays/watch-season.json`);
