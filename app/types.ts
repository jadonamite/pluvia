export interface Window { start: string; end: string }
export interface Policy {
  policy_id: string; group_name: string; crop: string; synthetic: true;
  farm_lat: number; farm_lon: number; ref_station_id: string;
  window_start: string; window_end: string; trigger_mm: number; exit_mm: number;
  sum_insured_ngn: number; borderline_band_mm: number; min_coverage: number;
  max_station_km: number; power_table: string;
}
export interface Claim { claim_id: string; policy_id: string; submitted_at: string; event_text: string; window_override?: Window; synthetic: true }
export interface DayValue { date: string; mm: number | null; m_flag?: string; q_flag?: string; s_flag?: string; fill?: boolean }
export interface DailySeries { source: 'ghcn' | 'power'; id: string; lat: number; lon: number; window: Window; days: DayValue[]; fetched_sql: string[] }
export type ProbeId = `P${1|2|3|4|5|6|7|8}`;
export interface ProbeResult { id: ProbeId; name: string; status: 'pass'|'warn'|'fail'; metric: Record<string, number|string>; evidence: string }
export type Verdict = 'PAY'|'PAY_ANYWAY'|'NO_PAY'|'INSPECT';
export type IndexSource = 'ghcn'|'power'|'none';
export interface Baseline { verdict: 'PAY'|'NO_PAY'|'INSPECT'; payout_ngn: number; index_mm: number|null }
export interface MemorySummary { recalled: string[]; written: string[]; conflicts: string[] }
export interface Decision {
  verdict: Verdict; payout_ngn: number; index_source: IndexSource; index_mm: number|null;
  reasons: string[]; probes: ProbeResult[]; naive: { station_only: Baseline; satellite_only: Baseline };
  memory: MemorySummary; rounds: number; human_review_required: boolean; counter_case?: string; inspection_question?:string;
}
export interface AdjudicatorProposal { action: 'decide'|'request_evidence'; proposed_source?: IndexSource; rationale?: string; counter_case?: string; kind?: 'neighbor_station'|'prior_years'|'shift_window'; params?: Record<string,unknown> }
export interface MemoryConflict { id: string; status: 'open'|'resolved'; resolution_confidence: number }
export interface TraceEvent { ts: string; run_id: string; round: number; agent: string; action: string; status: 'ok'|'fail'|'warn'|'partial'; model?: string; route?: string; receipt?: string; sql?: string; elapsed_ms?: number; input_summary?: string; output_summary?: string; probe?: string; memory_op?: 'recall'|'write'|'conflict'|'resolve'; [key: string]: unknown }
