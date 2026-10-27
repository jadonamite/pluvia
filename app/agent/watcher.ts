import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { QueryAdapter } from '../adapters/contracts.js';
import { DataAgent } from '../agents/data.js';
import { validMm } from '../domain/series.js';
import { divergence } from '../probes/divergence.js';
import type { DailySeries, Policy } from '../types.js';

// Silent days in a row before the watcher opens a case, and the overlap the gap check needs first.
export const SILENT_DAYS = 3;
const MIN_OVERLAP_DAYS = 5;

export interface DayCheck {
  date: string;
  station_id: string;
  gauge_mm: number | null;
  satellite_mm: number | null;
  silent_run: number;
  status: 'ok' | 'silent' | 'diverging';
}

export interface WatchFinding {
  kind: 'silent' | 'divergence';
  first_seen: string;
  last_seen: string;
  summary: string;
  dates: string[];
}

export interface WatchCase {
  id: string;
  station_id: string;
  station_name: string;
  policy_ids: string[];
  opened_on: string;
  findings: WatchFinding[];
  outbox: { to: 'station_operator'; body: string; on: string }[];
  // The agent's investigation of this watch case, when one runs.
  agent_case_id?: string;
}

export interface WatchState {
  // The simulated calendar: the last day the watcher has checked.
  today: string | null;
  checks: DayCheck[];
  cases: WatchCase[];
  // Claims already handed to the agent on their filing day.
  picked?: string[];
}

// What the watcher hands to the agent: a new watch case, and new findings on later days.
export interface Handoff {
  open(item: WatchCase, today: string, notice: string): Promise<string | undefined>;
  wake(item: WatchCase, finding: WatchFinding, today: string): Promise<boolean>;
}

const empty = (): WatchState => ({ today: null, checks: [], cases: [], picked: [] });
// Per-visitor calendars in sample mode: at most this many, each kept this long after last use.
const VISITOR_CAP = 500;
const VISITOR_TTL_MS = 6 * 3_600_000;

interface Station {
  id: string;
  name: string;
  policies: Policy[];
  start: string;
  end: string;
  series?: { station: DailySeries; satellite: DailySeries | null };
}

const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const upTo = (series: DailySeries, date: string): DailySeries => ({ ...series, days: series.days.filter(d => d.date <= date) });
const longDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

// Checks every insured station once a day through its cover window, reading only what had arrived by that day.
export class Watcher {
  private data: DataAgent;
  private shared: WatchState;
  private visitors = new Map<string, { state: WatchState; used: number }>();
  private file: string;
  // The calendar's last day: the end of every cover window and every filing day.
  private lastDay?: string;

  constructor(
    private deps: {
      query: QueryAdapter;
      directory: string;
      stations?: { id: string; name: string }[];
      // A season recorded from a live run, one state per day; when given, the calendar plays it back.
      recorded?: WatchState[];
      // Live: the agent investigates each watch case. Without it the watcher writes its own notice.
      handoff?: Handoff;
      // When each claim is filed on the simulated calendar, and what happens on that day.
      filings?: { claim_id: string; filed_on: string }[];
      onFiled?: (claimIds: string[], visitor?: string) => Promise<void>;
      // Sample mode keeps one calendar per visitor in memory instead of the shared file.
      perVisitor?: boolean;
    }
  ) {
    this.data = new DataAgent(deps.query);
    mkdirSync(deps.directory, { recursive: true });
    this.file = path.join(deps.directory, 'watch.json');
    this.shared = existsSync(this.file) ? { ...empty(), ...(JSON.parse(readFileSync(this.file, 'utf8')) as WatchState) } : empty();
  }

  get perVisitor() {
    return Boolean(this.deps.perVisitor);
  }

  view(visitor?: string): WatchState & { recorded: boolean; last_day: string | null; filings: { claim_id: string; filed_on: string }[] } {
    return { ...this.stateFor(visitor), recorded: Boolean(this.deps.recorded?.length), last_day: this.lastDay ?? null, filings: this.deps.filings ?? [] };
  }

  reset(visitor?: string): WatchState {
    return this.put(visitor, empty());
  }

  // Watch cases for a station, for the claims agent's briefing.
  casesFor(stationId: string, visitor?: string): WatchCase[] {
    return this.stateFor(visitor).cases.filter(c => c.station_id === stationId);
  }

  // Moves the calendar forward one day at a time, checks each station and picks up claims filed that day.
  async advance(days = 1, visitor?: string): Promise<WatchState> {
    const state = this.stateFor(visitor);
    const recorded = this.deps.recorded;
    const stations = recorded?.length ? [] : await this.stations();
    const ends = [...stations.map(s => s.end), ...(recorded ?? []).map(s => s.today ?? ''), ...(this.deps.filings ?? []).map(f => f.filed_on)].sort();
    const starts = [...stations.map(s => s.start), ...(recorded?.[0]?.today ? [recorded[0].today] : [])].sort();
    if (!starts.length) return state;
    this.lastDay = ends.at(-1);
    let current = state;
    for (let i = 0; i < days; i++) {
      const today = current.today ? nextDay(current.today) : starts[0]!;
      if (today > ends.at(-1)!) break;
      const played = recorded?.find(s => s.today === today);
      if (recorded?.length) {
        // Days past the recorded season keep the last recorded state.
        const base = played ?? recorded.at(-1)!;
        current = { ...structuredClone(base), today, picked: current.picked ?? [] };
      } else {
        current.today = today;
        for (const station of stations) if (today >= station.start && today <= station.end) await this.check(current, station, today);
      }
      const due = (this.deps.filings ?? []).filter(f => f.filed_on <= today && !current.picked?.includes(f.claim_id)).map(f => f.claim_id);
      if (due.length) {
        current.picked = [...(current.picked ?? []), ...due];
        await this.deps.onFiled?.(due, visitor);
      }
    }
    return this.put(visitor, current);
  }

  private async stations(): Promise<Station[]> {
    const names = new Map((this.deps.stations ?? []).map(s => [s.id, s.name]));
    const groups = new Map<string, Station>();
    for (const policy of await this.data.policies()) {
      const found = groups.get(policy.ref_station_id);
      if (found) {
        found.policies.push(policy);
        if (policy.window_start < found.start) found.start = policy.window_start;
        if (policy.window_end > found.end) found.end = policy.window_end;
      } else {
        groups.set(policy.ref_station_id, { id: policy.ref_station_id, name: names.get(policy.ref_station_id) ?? policy.ref_station_id, policies: [policy], start: policy.window_start, end: policy.window_end });
      }
    }
    return [...groups.values()];
  }

  private async check(state: WatchState, station: Station, today: string) {
    const policy = { ...station.policies[0]!, window_start: station.start, window_end: station.end };
    station.series ??= await this.data.fetch(policy);
    const gauge = upTo(station.series.station, today);
    const satellite = station.series.satellite ? upTo(station.series.satellite, today) : null;
    const reading = gauge.days.find(d => d.date === today);
    const sky = satellite?.days.find(d => d.date === today);

    // Consecutive days up to today with no usable gauge reading.
    const silent: string[] = [];
    for (let date = today; date >= station.start; date = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)) {
      if (validMm(gauge.days.find(d => d.date === date))) break;
      silent.unshift(date);
    }
    const gap = divergence(gauge, satellite, { ...policy, window_end: today });
    const overlap = Number(gap.metric.overlap_days ?? 0);
    const diverging = gap.status === 'fail' && overlap >= MIN_OVERLAP_DAYS;

    state.checks.push({
      date: today,
      station_id: station.id,
      gauge_mm: validMm(reading) ? reading.mm : null,
      satellite_mm: validMm(sky) ? sky.mm : null,
      silent_run: silent.length,
      status: silent.length >= SILENT_DAYS ? 'silent' : diverging ? 'diverging' : 'ok',
    });

    if (silent.length >= SILENT_DAYS) {
      const item = this.open(state, station, today);
      const current = item.findings.find(f => f.kind === 'silent' && f.dates[0] === silent[0]);
      const summary = `The gauge has sent no reading for ${silent.length} days, since ${longDate(silent[0]!)}.`;
      if (current) Object.assign(current, { last_seen: today, dates: silent, summary });
      else {
        const finding: WatchFinding = { kind: 'silent', first_seen: today, last_seen: today, dates: silent, summary };
        item.findings.push(finding);
        await this.report(item, station, finding, today);
      }
    }
    if (diverging) {
      const item = this.open(state, station, today);
      const station_mm = Number(gap.metric.station_mm).toFixed(1);
      const satellite_mm = Number(gap.metric.satellite_mm).toFixed(1);
      const summary = `On the ${overlap} days both reported, the gauge totals ${station_mm} mm and the satellite ${satellite_mm} mm.`;
      const current = item.findings.find(f => f.kind === 'divergence');
      if (current) Object.assign(current, { last_seen: today, summary });
      else {
        const finding: WatchFinding = { kind: 'divergence', first_seen: today, last_seen: today, dates: [today], summary };
        item.findings.push(finding);
        await this.report(item, station, finding, today);
      }
    }
  }

  // Each new finding goes to the agent when one is attached; otherwise the watcher tells the operator itself.
  private async report(item: WatchCase, station: Station, finding: WatchFinding, today: string) {
    const notice = `${finding.summary} This is the rain gauge at ${station.name} (${station.id}), which ${station.policies.length} insured farmer groups depend on this season. Please check the instrument and its data link, and tell us the dates it was out of service.`;
    const handoff = this.deps.handoff;
    if (handoff) {
      try {
        if (!item.agent_case_id) {
          item.agent_case_id = await handoff.open(item, today, notice);
          if (item.agent_case_id) return;
        } else if (await handoff.wake(item, finding, today)) return;
      } catch {
        // The template notice below still goes out.
      }
    }
    item.outbox.push({ to: 'station_operator', on: today, body: notice });
  }

  // One watch case per station; it opens on the first finding.
  private open(state: WatchState, station: Station, today: string): WatchCase {
    const existing = state.cases.find(c => c.station_id === station.id);
    if (existing) return existing;
    const item: WatchCase = {
      id: `watch_${randomUUID().slice(0, 8)}`,
      station_id: station.id,
      station_name: station.name,
      policy_ids: station.policies.map(p => p.policy_id),
      opened_on: today,
      findings: [],
      outbox: [],
    };
    state.cases.push(item);
    return item;
  }

  private stateFor(visitor?: string): WatchState {
    if (!this.deps.perVisitor || !visitor) return this.shared;
    const entry = this.visitors.get(visitor);
    if (entry) {
      entry.used = Date.now();
      return entry.state;
    }
    return empty();
  }

  private put(visitor: string | undefined, state: WatchState): WatchState {
    if (!this.deps.perVisitor || !visitor) {
      this.shared = state;
      writeFileSync(this.file, JSON.stringify(state, null, 2));
      return state;
    }
    const now = Date.now();
    for (const [key, entry] of this.visitors) if (now - entry.used > VISITOR_TTL_MS) this.visitors.delete(key);
    this.visitors.delete(visitor);
    this.visitors.set(visitor, { state, used: now });
    // Oldest first: a Map keeps insertion order, and each put re-inserts.
    while (this.visitors.size > VISITOR_CAP) this.visitors.delete(this.visitors.keys().next().value!);
    return state;
  }
}
