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
  kind: 'start' | 'thought' | 'tool' | 'decision' | 'action' | 'person' | 'note';
  tool?: string;
  input?: unknown;
  output?: unknown;
  summary: string;
  model?: string;
}

export interface OutboxMessage {
  to: 'farmer_group' | 'station_operator';
  body: string;
  status: 'sent' | 'held';
  at: string;
}

// One recorded stretch of agent work, replayable without the live services.
export interface Segment {
  trigger: 'start' | 'inspection_report';
  input?: string;
  messages: unknown[];
  // Event range this stretch produced, and the case as it stood when the stretch ended.
  from_event: number;
  to_event?: number;
  snapshot?: Pick<Case, 'state' | 'decision' | 'proposal' | 'inspection' | 'signoff' | 'payment' | 'outbox' | 'summary'>;
}

export interface Case {
  id: string;
  claim_id: string;
  policy_id: string;
  state: CaseState;
  created_at: string;
  updated_at: string;
  replay?: { recorded_at: string; source_case: string; report?: string };
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
  // The contract series the checks and the gate used, for the desk's chart.
  evidence?: { station: DailySeries; satellite: DailySeries | null };
}

// Keeps cases in memory and writes each one to a JSON file whenever it changes.
export class CaseStore {
  private cases = new Map<string, Case>();

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
