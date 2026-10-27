// Runs the watcher's season on a live server one day at a time and saves each day, with the agent's
// investigation of each watch case: data/replays/watch-season.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { WatchState } from '../app/agent/watcher.js';

type View = WatchState & { recorded?: boolean; investigations?: Record<string, { id: string; running?: boolean }> };
const base = process.argv[2] ?? 'http://localhost:8000';
const call = async (route: string, method = 'POST') => {
  const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
  if (!response.ok) throw new Error(`${route} answered ${response.status}`);
  return (await response.json()) as View;
};
const health = (await (await fetch(`${base}/health`)).json()) as { sample_mode?: boolean };
if (health.sample_mode !== false) throw new Error('The server is in sample mode. Record the season from a live server.');
await call('/watch/reset');
const days: WatchState[] = [];
for (;;) {
  const { recorded: _recorded, investigations: _investigations, ...state } = await call('/watch/advance');
  if (state.today === days.at(-1)?.today) break;
  days.push(state);
  console.log(`${state.today}: ${state.cases.length} watch cases`);
}
// Wait for the agent to finish every watch case before saving them.
let view = await call('/watch', 'GET');
while (Object.values(view.investigations ?? {}).some(c => c.running)) {
  await new Promise(r => setTimeout(r, 10_000));
  view = await call('/watch', 'GET');
}
const investigations = Object.values(view.investigations ?? {}).map(({ running: _running, ...item }) => item);
mkdirSync('data/replays', { recursive: true });
writeFileSync('data/replays/watch-season.json', JSON.stringify({ recorded_at: new Date().toISOString(), days, investigations }, null, 2));
console.log(`Saved ${days.length} days, ${days.at(-1)?.cases.length ?? 0} watch cases and ${investigations.length} investigations to data/replays/watch-season.json`);
