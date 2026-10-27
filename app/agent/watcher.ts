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
}

export interface WatchState {
  // The simulated calendar: the last day the watcher has checked.
  today: string | null;
  checks: DayCheck[];
  cases: WatchCase[];
}

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
  private state: WatchState;
  private file: string;

  constructor(private deps: { query: QueryAdapter; directory: string; stations?: { id: string; name: string }[] }) {
    this.data = new DataAgent(deps.query);
    mkdirSync(deps.directory, { recursive: true });
    this.file = path.join(deps.directory, 'watch.json');
    this.state = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as WatchState) : { today: null, checks: [], cases: [] };
  }

  view(): WatchState {
    return this.state;
  }

  reset(): WatchState {
    this.state = { today: null, checks: [], cases: [] };
    return this.save();
  }

  // Open watch cases for a station, for the claims agent's briefing.
  casesFor(stationId: string): WatchCase[] {
    return this.state.cases.filter(c => c.station_id === stationId);
  }

  // Moves the calendar forward one day at a time and checks each station on each day.
  async advance(days = 1): Promise<WatchState> {
    const stations = await this.stations();
    if (!stations.length) return this.state;
    const first = stations.map(s => s.start).sort()[0]!;
    const last = stations.map(s => s.end).sort().at(-1)!;
    for (let i = 0; i < days; i++) {
      const today = this.state.today ? nextDay(this.state.today) : first;
      if (today > last) break;
      this.state.today = today;
      for (const station of stations) if (today >= station.start && today <= station.end) await this.check(station, today);
    }
    return this.save();
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

  private async check(station: Station, today: string) {
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

    this.state.checks.push({
      date: today,
      station_id: station.id,
      gauge_mm: validMm(reading) ? reading.mm : null,
      satellite_mm: validMm(sky) ? sky.mm : null,
      silent_run: silent.length,
      status: silent.length >= SILENT_DAYS ? 'silent' : diverging ? 'diverging' : 'ok',
    });

    if (silent.length >= SILENT_DAYS) {
      const item = this.open(station, today);
      const current = item.findings.find(f => f.kind === 'silent' && f.dates[0] === silent[0]);
      const summary = `The gauge has sent no reading for ${silent.length} days, since ${longDate(silent[0]!)}.`;
      if (current) Object.assign(current, { last_seen: today, dates: silent, summary });
      else {
        const finding: WatchFinding = { kind: 'silent', first_seen: today, last_seen: today, dates: silent, summary };
        item.findings.push(finding);
        this.notify(item, station, finding, today);
      }
    }
    if (diverging) {
      const item = this.open(station, today);
      const station_mm = Number(gap.metric.station_mm).toFixed(1);
      const satellite_mm = Number(gap.metric.satellite_mm).toFixed(1);
      const summary = `On the ${overlap} days both reported, the gauge totals ${station_mm} mm and the satellite ${satellite_mm} mm.`;
      const current = item.findings.find(f => f.kind === 'divergence');
      if (current) Object.assign(current, { last_seen: today, summary });
      else {
        const finding: WatchFinding = { kind: 'divergence', first_seen: today, last_seen: today, dates: [today], summary };
        item.findings.push(finding);
        this.notify(item, station, finding, today);
      }
    }
  }

  // Tells the operator on the day of each new kind of finding.
  private notify(item: WatchCase, station: Station, finding: WatchFinding, today: string) {
    item.outbox.push({
      to: 'station_operator',
      on: today,
      body: `${finding.summary} This is the rain gauge at ${station.name} (${station.id}), which ${station.policies.length} insured farmer groups depend on this season. Please check the instrument and its data link, and tell us the dates it was out of service.`,
    });
  }

  // One watch case per station; it opens on the first finding.
  private open(station: Station, today: string): WatchCase {
    const existing = this.state.cases.find(c => c.station_id === station.id);
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
    this.state.cases.push(item);
    return item;
  }

  private save(): WatchState {
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    return this.state;
  }
}
