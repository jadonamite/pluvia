# Pluvia — Architecture

Companion to `PRD.md` (what and why) and `progress.md` (who and when). This document is the build contract: if the code disagrees with it, fix one of them on purpose.

---

## 1. System overview

```
 claims officer ── UI / CLI / POST /run ──►  Orchestrator (TypeScript, bounded loop)  ──► decision card + letter + trace
                                                   │
   ┌───────────────┬───────────────┬───────────────┼───────────────┬────────────────┬──────────────┐
   ▼               ▼               ▼               ▼               ▼                ▼              ▼
IntakeAgent    PlannerAgent    DataAgent       AuditorAgent   AdjudicatorAgent   PolicyGate    ReporterAgent
(Nemotron)     (Nemotron)      (code)          (code probes   (Nemotron)         (code)        (Nemotron +
                                 │              + Nemotron       │  ▲                            template)
                                 │              explainer)       │  │ evidence request
                                 ▼                               └──┘ (≤ 2 extra rounds)
                  ┌──────────────────────────────────────┐
                  │              ZETARIS                  │
                  │  GHCN_S3.station_<id>   (S3 CSV)      │  ← NOAA GHCN-Daily, per station
                  │  POWER.power_<loc>_<yr> (REST JSON)   │  ← NASA POWER daily point
                  │  PLUVIA.policies / claims (REST JSON)  │  ← synthetic register (public raw JSON)
                  │  pluvia.* SchemaStore views (flattened)│
                  └──────────────────────────────────────┘
   ▲                                                                                   │
   │  recall precedents / station lessons            write precedents / lessons / conflicts
   └───────────────────────────── H-MEM (Meterless engine) ◄───────────────────────────┘
                                         │
                        logs/<run_id>.jsonl  (every step, SQL, probe, memory op, model)
```

**Principles**
1. **Zetaris is the only data path in live mode.** Agents never read S3 or NASA directly; they send SQL to Zetaris.
2. **Nightshift is the only LLM path.** One OpenAI-compatible client and one model route, with the served model logged on every call.
3. **Code decides facts and money; LLMs decide wording, strategy and evidence requests.** The PolicyGate cannot be overruled by an agent.
4. **Every run is bounded:** max rounds, per-call timeouts, a whole-run budget, and a `partial` result instead of a hang.
5. **Sample mode runs the same code path** with different adapters.

---

## 2. Stack

| Concern | Choice | Reason |
|---|---|---|
| Language/runtime | **TypeScript on Node 20+**, run with `tsx` | H-MEM reference and conformance runner are TypeScript |
| HTTP server | **Hono** + `@hono/node-server`, bound to `0.0.0.0` | Small, typed; works inside Docker |
| LLM client | `openai` npm package, `baseURL` = Nightshift | Nightshift is OpenAI-compatible |
| Sample-mode SQL | **DuckDB** (`@duckdb/node-api`) over JSON/CSV snapshots | Same SQL shape as the Zetaris views |
| Validation | `zod` for every agent's JSON output | LLM output is parsed, never trusted |
| Tests | `vitest` | Fast, TypeScript |
| UI | One `public/index.html`, vanilla JS, Chart.js from cdnjs | No build step |
| Container | `node:20-slim` | Judges' fresh-clone path |

---

## 3. Repository layout

```
pluvia/
├── run.ts                          # `tsx run.ts serve` | `tsx run.ts claim <claim_id|file.json>` | `tsx run.ts eval`
├── app/
│   ├── orchestrator.ts             # bounded loop (§6)
│   ├── types.ts                    # Policy, Claim, DailySeries, ProbeResult, Decision, TraceEvent (§4)
│   ├── agents/
│   │   ├── intake.ts               # free text → structured claim
│   │   ├── planner.ts              # plan + H-MEM recall
│   │   ├── data.ts                 # builds and runs Zetaris SQL; ensures POWER table exists
│   │   ├── auditor.ts              # runs probes; Nemotron explains findings
│   │   ├── adjudicator.ts          # proposes decision / requests evidence
│   │   ├── policyGate.ts           # deterministic contract + guardrails (code only)
│   │   └── reporter.ts             # decision card + letter
│   ├── probes/                     # P1–P8 (§5), pure functions
│   │   ├── coverage.ts             # P1
│   │   ├── missingAsZero.ts        # P2
│   │   ├── flags.ts                # P3
│   │   ├── recordEnd.ts            # P4
│   │   ├── distance.ts             # P5
│   │   ├── divergence.ts           # P6
│   │   ├── satelliteFill.ts        # P7
│   │   └── borderline.ts           # P8
│   ├── domain/
│   │   ├── payout.ts               # linear trigger/exit payout
│   │   ├── series.ts               # align daily series, window math, haversine
│   │   └── naive.ts                # baseline deciders (naive station, satellite-only)
│   ├── adapters/
│   │   ├── zetaris.ts              # live REST client
│   │   ├── zetarisSample.ts        # DuckDB over data/snapshots (SAMPLE_MODE)
│   │   ├── nightshift.ts           # live Runtime client
│   │   └── nightshiftSample.ts     # cassette replay + rule-based fallback (SAMPLE_MODE)
│   ├── memory/
│   │   ├── hmem/                   # vendored H-MEM reference (Apache 2.0, attribution) + our extensions
│   │   ├── index.ts                # exports HMEM class (conformance entry point)
│   │   └── pluviaMemory.ts          # precedent / station-lesson / conflict API used by agents
│   ├── sql/                        # SQL templates used by DataAgent
│   ├── trace.ts                    # JSONL logger (stdout + logs/)
│   └── server.ts                   # Hono routes
├── public/index.html               # inbox, claim page, chart, decision card, trace, memory
├── data/
│   ├── register/policies.json      # synthetic policies (public raw URL for Zetaris)
│   ├── register/claims.json        # synthetic claims
│   ├── snapshots/ghcn/<ID>.csv     # station rows for the windows we use (small)
│   ├── snapshots/power/<loc>_<yr>.json
│   └── README.md                   # sources, licences, subsets, how regenerated, SYNTHETIC labels
├── scripts/
│   ├── register_zetaris.sql        # all CREATE statements (§7), run one at a time
│   ├── register_zetaris.ts         # runs the SQL file statement by statement via REST, with pauses
│   ├── snapshot.ts                 # pulls the windows we use → data/snapshots (via Zetaris live)
│   ├── fetch_raw.ts                # direct download used only to build eval fixtures/snapshots
│   ├── climatology.ts              # trigger/exit values from previous-year satellite data
│   └── hmem_conformance.sh         # official runner against app/memory/index.ts
├── eval/
│   ├── cases/                      # labelled cases (clean, injected faults, real Nigerian)
│   ├── build_cases.ts              # fault injection on clean series (documented, seeded)
│   └── run_eval.ts                 # four deciders → results table (markdown + json)
├── tests/                          # probes, payout, gate, orchestrator (sample mode), memory
├── input_examples/                 # ≥ 3 claim inputs
├── output_examples/                # matching real outputs (from runs, never hand-written)
├── logs/                           # created at runtime (gitignored except examples)
├── metadata.json                   # sponsor-use declaration (community schema)
├── Dockerfile
├── .env.example
├── .gitignore                      # .env, .env.*, !.env.example, logs/*, node_modules
└── README.md
```

---

## 4. Core types (`app/types.ts`)

```ts
export interface Policy {
  policy_id: string; group_name: string; crop: string; synthetic: true;
  farm_lat: number; farm_lon: number; ref_station_id: string;
  window_start: string; window_end: string;          // ISO dates
  trigger_mm: number; exit_mm: number; sum_insured_ngn: number;
  borderline_band_mm: number; min_coverage: number; max_station_km: number;
  power_table: string;                               // Zetaris table for this location/season
}

export interface Claim { claim_id: string; policy_id: string; submitted_at: string;
  event_text: string; window_override?: { start: string; end: string }; synthetic: true; }

export interface DayValue { date: string; mm: number | null;           // null = missing
  m_flag?: string; q_flag?: string; s_flag?: string; }

export interface DailySeries { source: "ghcn" | "power"; id: string;   // station id or grid point
  lat: number; lon: number; window: { start: string; end: string };
  days: DayValue[]; fetched_sql: string[]; }

export interface ProbeResult { id: `P${1|2|3|4|5|6|7|8}`; name: string;
  status: "pass" | "warn" | "fail"; metric: Record<string, number | string>;
  evidence: string; }                                  // one human-readable line, numbers included

export type Verdict = "PAY" | "NO_PAY" | "INSPECT";

export interface Decision { verdict: Verdict; payout_ngn: number; index_source: "ghcn" | "power" | "none";
  index_mm: number | null; reasons: string[]; probes: ProbeResult[];
  naive: { station_only: { verdict: Verdict; payout_ngn: number; index_mm: number };
           satellite_only: { verdict: Verdict; payout_ngn: number; index_mm: number } };
  memory: { recalled: string[]; written: string[]; conflicts: string[] }; rounds: number; }

export interface TraceEvent { ts: string; run_id: string; round: number; agent: string; action: string;
  status: "ok" | "fail" | "warn" | "partial"; model?: string; route?: string; receipt?: string;
  sql?: string; elapsed_ms?: number; input_summary?: string; output_summary?: string;
  probe?: string; memory_op?: "recall" | "write" | "conflict" | "resolve"; [k: string]: unknown; }
```

All LLM outputs are parsed with `zod` schemas. A parse failure triggers one retry with the validation error; a second failure falls back to the deterministic path and is traced as `status: "warn"`.

---

## 5. Probes (`app/probes/*`)

Pure functions over `DailySeries` + `Policy`. Each has a fixture test that **fails** on the bad case and **passes** on the fixed case.

| ID | Input | Logic | Status rule |
|---|---|---|---|
| P1 coverage | station series | `valid = days with mm != null and q_flag empty`; `cov = valid / window_days` | `cov < policy.min_coverage` → fail |
| P2 missing-as-zero | station + satellite | `naive_sum = Σ station mm (nulls ignored, i.e. counted as 0)`; `suspect_zero_days = station mm == 0 && satellite mm ≥ 5`; `missing_days = window_days − valid` | `missing_days ≥ 3` or `suspect_zero_days ≥ 2` → fail |
| P3 flags | station | count non-empty `q_flag` (excluded), tabulate `m_flag`, `s_flag` | any `q_flag` → warn; meanings from readme (A4) |
| P4 record end | station | `last_valid_date` vs `window_end` | `last_valid < window_end − 3d` → fail |
| P5 distance | policy + station metadata | haversine km | `> max_station_km` → warn (cannot be sole index) |
| P6 divergence | both | on overlapping valid days: `Δ = |Σstation − Σsat|`, `rel = Δ / max(Σsat, 1)` | `rel > 0.40` or `Δ > 50` → fail |
| P7 satellite fill | satellite | days == −999 (stored as null) | `> 3` → warn; `> 6` → fail |
| P8 borderline | chosen index + policy | `|index − trigger_mm| ≤ borderline_band_mm` | true → forces INSPECT |

Thresholds live in `app/probes/config.ts` and are printed in the README. They are not hidden in prompts.

**Units:** GHCN PRCP is converted with `mm = DATA_VALUE / 10` (confirm A4 before shipping). NASA POWER `PRECTOTCORR` is already mm/day.

---

## 6. Agents and orchestrator

### 6.1 Agent contracts

| Agent | Kind | Input → Output (zod-validated) |
|---|---|---|
| **IntakeAgent** | LLM | `event_text`, policy list → `{ policy_id, window?: {start,end}, event: "drought" \| "other", confidence }`. Skipped when the claim is already structured |
| **PlannerAgent** | LLM | claim, policy, `memory.recall(station, region, crop)` → `{ sources: ["ghcn","power"], window, extra_checks: string[], notes }` |
| **DataAgent** | code | plan → `{ station: DailySeries, satellite: DailySeries, station_meta }`. Builds SQL from `app/sql/` templates; ensures the POWER table exists (§7.3) |
| **AuditorAgent** | code + LLM | series + policy → `ProbeResult[]` + `explanation: string` (LLM, ≤ 120 words, must cite probe ids) |
| **AdjudicatorAgent** | LLM | probes, explanation, memory recall, history → `{ action: "decide", proposed_source, rationale } \| { action: "request_evidence", kind: "neighbor_station" \| "prior_years" \| "shift_window", params }` |
| **PolicyGate** | code | probes + Adjudicator proposal + policy → `Decision` (§6.3) |
| **ReporterAgent** | LLM + template | Decision → `{ card, letter_markdown }`. Numbers come **only** from the Decision object; the LLM writes prose around them |

### 6.2 Loop (`app/orchestrator.ts`)

```
claim     = Intake(claim) if unstructured
policy    = DataAgent.policy(claim.policy_id)
recall    = memory.recall({station: policy.ref_station_id, region, crop})      # trace memory_op=recall
plan      = Planner(claim, policy, recall)
evidence  = DataAgent.fetch(plan)                                             # Zetaris SQL, traced
for round in 0..MAX_EXTRA_ROUNDS (=2):
    probes      = Auditor(evidence, policy)
    proposal    = Adjudicator(probes, recall, history)
    if proposal.action == "request_evidence" and round < MAX_EXTRA_ROUNDS:
        evidence += DataAgent.fetchExtra(proposal)                            # neighbor / prior years / shift
        continue
    break
decision  = PolicyGate(probes, proposal, policy)                              # code
decision.naive = naive.stationOnly(evidence, policy), naive.satelliteOnly(...)
memory.writePrecedent(claim, decision); memory.writeStationLesson(...); memory.recordConflict(...)
return Reporter(decision)
```

**Budgets:** Zetaris SQL 60 s per call (2 retries, backoff 2 s/4 s; 429 → wait 60 s); Nightshift 180 s per call (429 → 2 s/4 s/8 s); whole run 4 min live. On budget exhaustion: return the best decision so far with `status: "partial"` and `verdict: INSPECT`.

### 6.3 PolicyGate (code, the only path to money)

Implements PRD §5.4 exactly:
1. Station passes P1, P2, P4, P6 → `index_source = ghcn`.
2. Station fails P1/P2/P4, satellite passes P7, and the Adjudicator's rationale cites those probe ids → `index_source = power`, reason "station unreliable".
3. Both fail, or P6 fail unresolved → `INSPECT`.
4. P8 → `INSPECT`.
5. An open H-MEM conflict with resolution confidence < 0.70 → `INSPECT`.
6. Else `payout.ts` → PAY (amount) / NO_PAY.

A unit test exists for every rule, including "Adjudicator proposes PAY but probes fail → gate returns INSPECT".

---

## 7. Zetaris integration (`scripts/register_zetaris.sql`)

Run **one statement at a time** (REST or SQL Editor). `scripts/register_zetaris.ts` does this with a 5 s pause between statements and stops on the first error. There is no `IF NOT EXISTS` for containers; the script checks for existing objects first.

### 7.1 GHCN-Daily, per station (A1, verify at Gate 1)

```sql
CREATE LIGHTNING DATABASE GHCN_S3 DESCRIBE BY "NOAA GHCN-Daily per-station CSV";

CREATE LIGHTNING FILESTORE TABLE station_nim00065201 FROM GHCN_S3 FORMAT CSV OPTIONS (
  PATH "s3a://noaa-ghcn-pds/csv/by_station/NIM00065201.csv",
  inferSchema "true",
  header "true",
  isS3BucketPublic "true",
  useS3PathStyleAccess "true",
  s3Endpoint "s3.us-east-1.amazonaws.com"
);
CACHE TABLE GHCN_S3.station_nim00065201;
-- repeat for each station in data/register/stations.json
```

**Fallback (if A1 fails):** the verified recipe table `by_year/2025.csv` (`header "false"`, columns `_c0.._c7`), cached once, then filtered by `ID` in the view. Slow first load; acceptable.

**Flattened view (one per station, or a UNION ALL view):**
```sql
CREATE SCHEMASTORE CONTAINER pluvia;

CREATE SCHEMASTORE VIEW ghcn_prcp WITH CONTAINER pluvia AS
SELECT ID AS station_id,
       to_date(CAST(DATE AS STRING), 'yyyyMMdd') AS obs_date,
       CAST(DATA_VALUE AS DOUBLE) / 10.0 AS mm,
       M_FLAG AS m_flag, Q_FLAG AS q_flag, S_FLAG AS s_flag
FROM GHCN_S3.station_nim00065201
WHERE ELEMENT = 'PRCP';
```

The exact casting of `DATE` depends on what `inferSchema` produces. Run `DESCRIBE` first and adjust. No self-joins on the view; use window functions if needed (SQL Companion §4).

### 7.2 Policy register (A3, verify at Gate 1)

`data/register/policies.json` is served from the public repo as `{"policies":[{...}, ...]}`. A top-level **object** wrapping an array is the verified-safe shape; never use a bare array.

```sql
CREATE LIGHTNING DATABASE PLUVIA_REGISTER DESCRIBE BY "Pluvia synthetic policy register";

CREATE LIGHTNING REST TABLE policies_raw FROM PLUVIA_REGISTER REQUEST(
  endpoint "https://raw.githubusercontent.com/<org>/pluvia/main/data/register/policies.json",
  method "get", response_type "json", http_encoding "URLENCODED"
) HEADER ( user-agent "Pluvia hackathon <contact-email>" ) BODY ();
CACHE TABLE PLUVIA_REGISTER.policies_raw;

CREATE SCHEMASTORE VIEW policies WITH CONTAINER pluvia AS
SELECT p.policy_id, p.group_name, p.crop, p.farm_lat, p.farm_lon, p.ref_station_id,
       p.window_start, p.window_end, p.trigger_mm, p.exit_mm, p.sum_insured_ngn,
       p.borderline_band_mm, p.min_coverage, p.max_station_km, p.power_table
FROM PLUVIA_REGISTER.policies_raw LATERAL VIEW explode(policies) AS p;
```

Same pattern for `claims.json`, and for `stations.json` (id, lat, lon, name) built from `ghcnd-stations.txt` by `scripts/fetch_raw.ts`.

**Note:** the repo must be public (or a public gist used) before Zetaris can read the raw URL. If the repo stays private until submit day, host the register files in a separate public gist from Gate 1.

### 7.3 NASA POWER, one REST table per location and season (A2, verify at Gate 1)

The endpoint is fixed at CREATE (REST HOWTO: dynamic parameters are not documented), so each policy location and window gets its own table. The DataAgent creates it on demand for a new policy and records the table name in `policy.power_table`.

```sql
CREATE LIGHTNING DATABASE POWER_REST DESCRIBE BY "NASA POWER daily point precipitation";

CREATE LIGHTNING REST TABLE power_lagos_2025 FROM POWER_REST REQUEST(
  endpoint "https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=3.321&latitude=6.577&start=20250601&end=20250930&format=JSON",
  method "get", response_type "json", http_encoding "URLENCODED"
) HEADER ( user-agent "Pluvia hackathon <contact-email>" ) BODY ();
CACHE TABLE POWER_REST.power_lagos_2025;

CREATE SCHEMASTORE VIEW power_lagos_2025_daily WITH CONTAINER pluvia AS
SELECT to_date(d, 'yyyyMMdd') AS obs_date,
       CASE WHEN v = -999 THEN NULL ELSE v END AS mm
FROM POWER_REST.power_lagos_2025
LATERAL VIEW explode(
  from_json(to_json(properties.parameter.PRECTOTCORR), 'map<string,double>')
) AS d, v;
```

- Prior-years tables for climatology and the Adjudicator's "prior_years" request: same pattern with a wider `start`/`end` (e.g. 20150601–20241231).
- **Fallback (if A2 fails):** commit the POWER JSON responses to `data/snapshots/power/` and register them through the same REST pattern from their public raw URLs. Data still flows through Zetaris; the README states the snapshot date.
- **Rate limits:** POWER has a usage guideline (one request per grid cell; repeated identical requests may be blocked) with no numeric limit. Always `CACHE TABLE`, and never re-create a table that exists.

### 7.4 Zetaris REST client (`app/adapters/zetaris.ts`)

- `POST {ZETARIS_REST_URL}/sql-editor/sqls/run`
- Headers: `Authorization: Bearer ZETARIS_API_KEY`, `X-Org-ID: ZETARIS_ORG_ID` (local install = 1; check Management → Organisation), `X-Request-ID: <fresh uuid>`.
- Body: `{ queryId: <uuid>, sql, source: "SqlEditor", limit }`. Rows come back in `response.data`.
- One statement per call. Every call is traced with `sql` and `elapsed_ms`.

---

## 8. Nightshift / Nemotron (`app/adapters/nightshift.ts`)

- `baseURL = METERLESS_BASE_URL` (default `http://127.0.0.1:8088/v1`; inside Docker `http://host.docker.internal:8088/v1`; or the Web hotspot URL the Console shows).
- Headers on every call: `Authorization: Bearer METERLESS_RUNTIME_TOKEN`, `meterless-app: pluvia`, `meterless-scope: user`.
- **Startup check:** `GET /v1/models`. 200 with `meterless/*` ids → online; 401/403 → "unauthorized" (bad token); anything else → offline. `/healthz` alone proves nothing.
- **One route:** `METERLESS_MODEL` (copy the exact id from `/v1/models`; prefer a route pinned to a Nemotron lane). Do not rely on `meterless/fast` vs `meterless/deep`; they are reported to collapse to `auto`.
- `max_tokens ≥ 800` for reasoning calls (≥ 500 is the reported floor). 180 s timeout. 429 → retry at 2 s, 4 s, 8 s.
- **Model evidence:** log `response.model`, plus any `meterless` block or receipt id in the response. If the concrete Nemotron name is not returned, record it from Nightshift's run receipts and state that in the README.
- Leave Nightshift's "Reasoning budget" slider at default (1.2.3 bug with Ultra).
- The NVIDIA API key lives **only** in Nightshift → Setup → Providers. Never in this repo.

---

## 9. H-MEM (`app/memory/`)

### 9.1 Engine
- Vendor `engines/hmem/reference/src` from `Meterless/Meterless` into `app/memory/hmem/`, keeping the LICENSE and attribution.
- `app/memory/index.ts` re-exports the `HMEM` class: `constructor({ clock })`, `add()`, `query()`, `feedback()`, plus `store`, `ledger`, `sleep`, `dreaming`, `conflicts`. This is what the conformance runner loads.
- **Day-1 task:** read `engines/hmem/AGENTS.md`, run the reference's own tests and `examples/07-conflict-resolution`, then wire.

### 9.2 Pluvia memory API (`pluviaMemory.ts`)
| Function | Writes / reads | Example content |
|---|---|---|
| `recall({station, region, crop})` | `query()` top-k, filtered by tags `station:<id>`, `region:<r>` | "NIM00065201 Jul–Aug 2025: station coverage 32%; naive trigger would pay; satellite used; INSPECT issued" |
| `writePrecedent(claim, decision)` | `add()` type `procedural`, layer `working`, tags, provenance `{run_id, claim_id, probes}` | "Claim POL-LAG-2025-014: INSPECT because P1 fail (10/62 days) and P6 fail (6.1 vs 109.5 mm)" |
| `writeStationLesson(station, probes)` | `add()` type `factual`, confidence from coverage | "Station NIM00065201 unreliable for 2025 rainy season (coverage 32%)" |
| `recordConflict(stationClaim, satelliteClaim)` | `add()` both as factual memories → H-MEM `conflicts` scan detects divergent numeric values → resolution | Auto-resolve if confidence ≥ 0.70 (e.g. station fails P1 badly → keep satellite); else stays open → PolicyGate rule 5 → INSPECT |
| `feedback(id, outcome)` | `feedback()` when the officer confirms or overrides in the UI | Officer override → `user_correction` (high source reliability in H-MEM) |

Every memory operation is traced (`memory_op`), and the trust ledger is exported to `logs/<run_id>.ledger.jsonl` as evidence.

### 9.3 Proof
1. `scripts/hmem_conformance.sh` → `HMEM_IMPL=$(pwd)/app/memory/index.ts npx tsx <path>/conformance/runner.ts` passes. Output is pasted in the README.
2. `tests/memory.session.test.ts`: claim A on a station → ≥ 1 extra round; fresh process, claim B on the same station → recall hits and 0 extra rounds.

---

## 10. Sample mode

`SAMPLE_MODE=true` swaps two adapters; everything else is identical.

| Live | Sample |
|---|---|
| `zetaris.ts` | `zetarisSample.ts`: loads `data/snapshots/ghcn/*.csv`, `data/snapshots/power/*.json` and `data/register/*.json` into DuckDB under **the same view names and columns** as the Zetaris views (`pluvia.ghcn_prcp`, `pluvia.power_<loc>_<yr>_daily`, `pluvia.policies`, `pluvia.claims`). The DataAgent's SQL runs unchanged |
| `nightshift.ts` | `nightshiftSample.ts`: (1) **cassette** of recorded live responses keyed by prompt hash; (2) on a miss, a **deterministic rule-based stand-in** per agent (Planner: default plan; Adjudicator: request prior years once if P6 fails, then propose; Auditor explainer: template from probe evidence). Traced as `model: "sample-rules"` |

Probes, the PolicyGate, payout math and H-MEM run **for real** in sample mode. The README states plainly what is replayed and what is computed.

---

## 11. API and CLI

`POST /run`
```json
{ "input": { "claim_id": "CLM-LAG-2025-07" } }
```
or
```json
{ "input": { "event_text": "Ikorodu maize group says July rains failed", "policy_id": "POL-LAG-2025-014" },
  "options": { "sample_mode": false, "max_extra_rounds": 2 } }
```

Response:
```json
{ "run_id": "r_7c1e", "status": "success|partial|error",
  "output": { "decision": { "verdict": "INSPECT", "payout_ngn": 0, "index_source": "none", "reasons": ["..."] },
              "probes": [ { "id": "P1", "status": "fail", "evidence": "10 of 62 window days reported (16%)" } ],
              "naive": { "station_only": { "verdict": "PAY", "payout_ngn": 2500000, "index_mm": 6.1 } },
              "card": { }, "letter_markdown": "..." },
  "memory": { "recalled": [], "written": [], "conflicts": [] },
  "agents": [ { "name": "PlannerAgent", "role": "..." } ],
  "log_file": "logs/r_7c1e.jsonl", "execution_time_seconds": 0 }
```

The numbers above are illustrative. Real outputs come from runs and are saved to `output_examples/`.

Errors are structured: `{ "status": "error", "error": { "type", "message", "recoverable" } }`.

Other routes: `GET /claims` (inbox), `GET /runs/:id`, `GET /` (UI), `GET /health` (adapter status: zetaris/nightshift online, sample mode on or off).

CLI: `tsx run.ts claim CLM-LAG-2025-07`, `tsx run.ts claim input_examples/02.json`, `tsx run.ts eval`, `tsx run.ts serve`.

---

## 12. UI (`public/index.html`)

1. **Inbox:** claims table (group, station, window, status). The SYNTHETIC badge is visible.
2. **Claim page:**
   - **Rainfall chart:** daily bars for the station (grey hatched = missing), line for the satellite, dashed horizontal lines for trigger and exit (as cumulative-to-date).
   - **Decision card:** verdict (PAY / NO PAY / INSPECT), payout, index source, top 3 reasons.
   - **"A naive trigger would have…"** box: station-only verdict and payout, in contrast.
   - **Probes list:** status chips with one-line evidence each.
   - **Trace timeline:** agent → action → model → elapsed. Click to expand SQL.
   - **Memory panel:** recalled precedents, written lessons, conflict record and its status.
   - **Officer actions:** Confirm / Override (writes H-MEM feedback).
3. Works at phone width; light and dark themes. No secrets ever rendered (adapter status only says online/offline).

---

## 13. Evaluation (`eval/`)

- `build_cases.ts` (seeded, deterministic):
  1. Select clean station-windows (coverage ≥ 95%, |P6| small). Candidates are Ghana `GHM*` and Kenya `KE*` stations from the verified inventory; confirm at Gate 3.
  2. For each, compute the true decision.
  3. Generate labelled variants: drop N days; zero-fill missing; truncate the record end; shift ±3 days; swap in a distant station.
  4. Add real Nigerian cases with labels derived only from documented coverage.
- `run_eval.ts`: runs the four deciders (naive station, satellite-only, LLM judge given totals, Pluvia) on every case. Writes `eval/results.md` and `eval/results.json`: wrong payouts, missed payouts, INSPECT rate, time.
- The eval runs in sample mode (deterministic) and optionally live (records models). Never tune thresholds on the eval cases. Thresholds are fixed in `config.ts` before the eval is built.

---

## 14. Environment (`.env.example`, placeholders only)

```
# Zetaris (data layer)
ZETARIS_REST_URL=http://localhost:8888/api/v1.0
ZETARIS_ORG_ID=1
ZETARIS_API_KEY=your-zetaris-api-key

# Meterless Nightshift (primary AI provider) — from Nightshift Console
METERLESS_BASE_URL=http://127.0.0.1:8088/v1
METERLESS_RUNTIME_TOKEN=your-nightshift-runtime-token
METERLESS_MODEL=meterless/auto          # replace with the exact Nemotron route id from GET /v1/models

# Behaviour
SAMPLE_MODE=false
CONTACT_EMAIL=your-email@example.com     # used in User-Agent for NASA/GitHub requests via Zetaris
PORT=8000
LOG_LEVEL=info
```

- No NVIDIA key in this project.
- In Docker, replace `localhost` / `127.0.0.1` with `host.docker.internal`.

---

## 15. Deployment topology for this team

| Machine | Runs | Used for |
|---|---|---|
| **T: MacBook M1 Pro 16 GB** | Docker Desktop (Rosetta on, 8 GB / 4 CPUs) → Zetaris; Nightshift (Mac M1+ edition) with NVIDIA in Providers; Pluvia live | All Zetaris registration, live runs, snapshots, cassettes, live eval, demo recording |
| **S: Windows laptop 8 GB, integrated GPU** | Node 20, Pluvia in `SAMPLE_MODE`; **try Nightshift Web hotspot** (A6) | All feature code, probes, gate, memory, UI, tests, eval builder, docs. Pushes to GitHub; T pulls and runs live |

Same code path on both machines; only adapters differ.

---

## 16. Testing matrix

| Test | Proves |
|---|---|
| `tests/probes/*.test.ts` | Each probe fails on its bad fixture and passes on the fixed one |
| `tests/payout.test.ts` | Linear payout at trigger, exit, mid-point, above trigger |
| `tests/policyGate.test.ts` | Every gate rule, including "LLM proposes PAY, probes fail → INSPECT" |
| `tests/orchestrator.sample.test.ts` | Lagos July 2025 snapshot end to end: naive = PAY; Pluvia ≠ blind PAY; traces contain ≥ 3 agents, ≥ 1 evidence request |
| `tests/memory.session.test.ts` | Second claim on the same station recalls the lesson; 0 extra rounds |
| `scripts/hmem_conformance.sh` | Official H-MEM conformance passes |
| Mutation check | Disable P1 → orchestrator test fails (the tests can fail, so they mean something) |
| Fresh-clone check | Clone, empty `.env`, Zetaris and Nightshift stopped, `SAMPLE_MODE=true`, 3 examples pass |
| Secret scan | `grep -RInE "(sk-|nvapi-|api[_-]?key|secret|token|password)"` + `git ls-files` check |

---

## 17. Risks and fallbacks

| Risk | Detection | Fallback |
|---|---|---|
| Zetaris not running on the Mac by Mon 09:00 UTC | Gate 1 | Zetaris on AWS Free plan (managed cluster guide) |
| A1 per-station CSV fails | Gate 1 SQL | `by_year/2025.csv` recipe table, cached |
| A2 POWER REST fails | Gate 1 SQL | POWER JSON snapshots in the public repo, registered via REST |
| A3 raw GitHub JSON fails in Zetaris | Gate 1 SQL | Public gist, or another public HTTP host |
| Nemotron route unavailable or empty replies | Gate 1 curl | Switch between Lightning and Ultra; `max_tokens ≥ 800`; slider at default |
| Lanes collapse to one model | Trace `model` field | Already designed for one route |
| Mac unavailable at a critical moment | — | Nightshift Web on Sam's laptop (if A6 holds); sample mode for everything else |
| Too few clean stations for the eval | Gate 3 | Smaller eval, stated honestly |
| Running out of time | Gates | Cut list in progress.md |
