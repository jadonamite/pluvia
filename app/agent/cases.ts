import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { DailySeries, Decision } from '../types.js';

export type CaseState =
  | 'investigating'
  | 'inspection_open'
  | 'awaiting_signoff'
  | 'settled'
  | 'closed'
  | 'escalated'
  | 'failed';

export interface CaseEvent {
  at: string;
  kind: 'start' | 'thought' | 'tool' | 'decision' | 'action' | 'person' | 'note' | 'plan' | 'officer' | 'reply' | 'watcher';
  tool?: string;
  input?: unknown;
  output?: unknown;
  summary: string;
  model?: string;
  // The watcher's calendar day when this happened, on a watch case.
  day?: string;
}

export interface OutboxMessage {
  to: 'farmer_group' | 'station_operator';
  body: string;
  status: 'sent' | 'held';
  at: string;
  day?: string;
}

// A station lesson the agent recorded, with the figures the code reran.
export interface Lesson {
  text: string;
  figures: { label: string; claimed: number; reproduced?: number; match: boolean }[];
  at: string;
  day?: string;
  memory_id?: string;
}

export interface PlanStep {
  text: string;
  status: 'todo' | 'doing' | 'done' | 'dropped';
  note?: string;
}

// The agent's plan for the case, and every change of course with its reason.
export interface Plan {
  steps: PlanStep[];
  revisions: { at: string; reason: string }[];
}

// One recorded stretch of agent work, replayable without the live services.
export interface Segment {
  trigger: 'start' | 'inspection_report' | 'message' | 'watch';
  input?: string;
  messages: unknown[];
  // Event range this stretch produced, and the case as it stood when the stretch ended.
  from_event: number;
  to_event?: number;
  // The watcher's calendar day this stretch began, on a watch case.
  day?: string;
  snapshot?: Pick<Case, 'state' | 'decision' | 'proposal' | 'inspection' | 'signoff' | 'payment' | 'outbox' | 'summary' | 'plan'>;
}

export interface Case {
  id: string;
  // A claim case, or the agent's investigation of a watch case before any claim.
  kind?: 'claim' | 'watch';
  // In sample mode, the visitor whose calendar opened this case.
  visitor?: string;
  // On a watch case: the station, the watch case it works and the watcher's current day.
  station?: { id: string; name: string; policy_ids: string[]; watch_id: string; today: string; fallback_notice: string };
  lessons?: Lesson[];
  // Tokens the model reported across every step, when the route reports them.
  usage?: { prompt_tokens: number; completion_tokens: number };
  claim_id: string;
  policy_id: string;
  state: CaseState;
  created_at: string;
  updated_at: string;
  // questions: what the officer wrote to the live agent after it stopped, in order; played: how many were replayed.
  replay?: { recorded_at: string; source_case: string; report?: string; questions?: string[]; played?: number };
  models: string[];
  steps_used: number;
  events: CaseEvent[];
  segments: Segment[];
  decision?: Decision;
  proposal?: { verdict: string; source?: string; rationale?: string; figures_verified?: boolean };
  inspection?: { opened_at: string; dates: string[]; instructions: string; report?: { at: string; text: string } };
  signoff?: { reason: string; summary: string; status: 'pending' | 'approved' | 'declined'; note?: string; at?: string };
  payment?: { amount_ngn: number; status: 'held' | 'released' | 'none' };
  outbox: OutboxMessage[];
  summary?: string;
  plan?: Plan;
  // Watch cases on the policy's station that were in the agent's brief when the case opened.
  watch?: { id: string; station_id: string; station_name: string; opened_on: string }[];
  // Officer messages that arrived while the agent was mid-step, read before its next step.
  inbox?: string[];
  // The contract series the checks and the gate used, for the desk's chart.
  evidence?: { station: DailySeries; satellite: DailySeries | null };
}

// Keeps cases in memory and writes each one to a JSON file whenever it changes. Cases opened by a
// sample-mode visitor stay in memory only, up to a cap.
export class CaseStore {
  private cases = new Map<string, Case>();
  private static VISITOR_CASES = 2000;

  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true });
    for (const file of readdirSync(directory).filter(f => f.endsWith('.json'))) {
      try {
        const item = JSON.parse(readFileSync(path.join(directory, file), 'utf8')) as Case;
        this.cases.set(item.id, item);
      } catch {
        // A damaged case file is skipped rather than blocking the desk.
      }
    }
  }

  save(item: Case): Case {
    item.updated_at = new Date().toISOString();
    this.cases.set(item.id, item);
    if (item.visitor) {
      const visitors = [...this.cases.values()].filter(c => c.visitor);
      for (const old of visitors.slice(0, Math.max(0, visitors.length - CaseStore.VISITOR_CASES))) this.cases.delete(old.id);
      return item;
    }
    writeFileSync(path.join(this.directory, `${item.id}.json`), JSON.stringify(item, null, 2));
    return item;
  }

  get(id: string): Case | undefined {
    return this.cases.get(id);
  }

  list(): Case[] {
    return [...this.cases.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  latestFor(claimId: string): Case | undefined {
    return this.list().find(c => c.claim_id === claimId);
  }
}

export function readReplay(directory: string, claimId: string): Case | undefined {
  const file = path.join(directory, `${claimId}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Case) : undefined;
}
