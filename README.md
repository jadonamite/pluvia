# Pluvia

Pluvia checks whether the rainfall record behind a crop-insurance claim can support a decision before any money moves. Built for the Open Agent Hackathon 2026, track **03 · Reasoning Architecture**.

Pluvia evaluates rainfall evidence across ground stations and independent satellite observations, executes eight deterministic data-integrity probes, and uses episodic and semantic memory across claims to identify unfit records before settlement. The offline application runs end-to-end on real public rainfall snapshots with zero credentials required.

## Run it

Requires Node 20.19 or later. From a clean source checkout:

```sh
npm ci && SAMPLE_MODE=true npm start
```

Open [the claims desk](http://localhost:8000). No environment file, account or credential is needed in sample mode. The three supplied claims share one genuine Lagos weather window; they demonstrate memory across claims rather than three independent weather events.

```sh
SAMPLE_MODE=true npm run claim -- input_examples/lagos_01.json
SAMPLE_MODE=true npm run claim -- input_examples/lagos_02.json
SAMPLE_MODE=true npm run claim -- input_examples/lagos_03.json
```

The first claim on a fresh station/window requests more evidence. A later claim recalls the lesson and avoids that extra round. Real outputs from the supplied inputs are in [output_examples](output_examples/). Run traces go to stdout and `logs/<run_id>.jsonl`; memory persists under `logs/memory/`. A browser review appears at `GET /runs/:id` during the current server session.

With Docker:

```sh
 docker build -t pluvia .
 docker run --rm -p 8000:8000 -e SAMPLE_MODE=true pluvia
```

Mount a writable volume at `/app/logs` to retain memory after the container exits. The container uses Node 20.

## The record that motivated it

For July 2025 at Lagos station `NIM00065201`:

| Source | Days with data | Window total |
|---|---:|---:|
| Ground gauge | 10 of 31 | 6.1 mm |
| Independent satellite retrieval | 31 of 31 | 131.7 mm |

Nine of the ten reported gauge days are exactly 0.0 mm with blank quality flags. The other 21 days are missing, not zero. A blank quality flag means a value passed the archive's checks; it does not establish that the record can settle this claim.

Because the policy covers drought (rainfall below 144.3 mm), a naive rule summing what is present sees 6.1 mm and pays ₦2,500,000 in full for a drought that never occurred. Pluvia catches this unfit record and blocks the settlement, protecting the pool from wrongful payouts.

Index basis risk is two-sided:
- **Preventing wrongful payouts:** Unfit records with missing days treated as zero look like severe drought. Naive index settlement would drain insurance pools on non-events. Pluvia's probes detect incomplete coverage (P1), suspect zeros (P2), and divergence (P6) to prevent fraudulent or erroneous payouts.
- **Guarding against wrongful refusals:** Conversely, a gauge measuring a storm 40 km away can suppress a payout owed to a farm experiencing localized drought. Pluvia protects farmers by barring any refusal without complete independent satellite evidence, forcing inspection whenever data conflicts, and requiring every proposed refusal to attach the strongest case for paying with mandatory human officer review.

The example policies are calibrated from complete July windows in prior-year independent satellite data. The method and inputs are recorded in [data/register/calibration.json](data/register/calibration.json). Farmer groups, claims, policy terms and payout amounts are synthetic. Rainfall observations are real; [data/README.md](data/README.md) records their sources and units.

Pluvia identifies a record unfit to settle a claim. It does not diagnose a broken instrument. Suspect zero runs cluster across countries in 2002–2005, so an archive ingest problem is a plausible explanation.

## Code makes the decision

A model plans the review, explains probe findings and requests evidence. PolicyGate recomputes the probes from the rainfall series and applies the contract. Model wording cannot clear a failed probe or set a payout.

| Outcome | Meaning |
|---|---|
| Pay (`PAY`) | The accepted index triggers a contractual payout. |
| Pay anyway (`PAY_ANYWAY`) | An accepted corrected index restores a payout suppressed by the station-only trigger. |
| Send an inspector (`INSPECT`) | Evidence is incomplete, conflicting, borderline or still requested. The output carries the question to resolve. |
| Do not pay (`NO_PAY`) | A proposed refusal requiring human review and the strongest case for paying. It is never final. |

No refusal is reachable when independent satellite evidence is unavailable, or when station coverage is insufficient. A changed claim window cannot manufacture a payout: a window differing from the contract forces inspection. Distant stations cannot serve as the sole index. Officer feedback changes memory reliability, never the gate decision or payout.

The payout is linear: full cover at or below the exit, zero at or above the trigger, proportional between them. All amounts come from deterministic code. There is no payment integration.

## Agents, evidence and memory

Intake matches free text to a known policy. Planner recalls H-MEM and chooses checks. DataAgent executes SQL through Zetaris in live mode. Auditor runs eight pure probes and asks the model for an explanation. Adjudicator may request prior years, neighbouring observations or a shifted window, with at most two extra rounds. Extra context cannot erase a failed contractual-window probe. Reporter writes prose around a code-generated decision card and letter.

Each run has a four-minute budget. SQL and model calls have timeouts and bounded retries. A run interrupted after evidence arrives returns a partial inspection result. Invalid model JSON gets one validation retry, then a traced deterministic fallback.

H-MEM stores precedents, station lessons and conflicts. Its own conflict service resolves only at confidence 0.70 or higher; unresolved conflicts feed PolicyGate's inspection outcome. The vendor reference is unmodified and attributed in [app/memory/README.md](app/memory/README.md). Recall never overrides fresh probe findings.

Sample mode uses DuckDB to execute the same DataAgent SQL over cached observations. Model steps use a deterministic adapter named **`sample-rules`**, not a live model or a replayed Nemotron response. Probes, the payout rule, PolicyGate, H-MEM and the agent loop execute for real. Every model attempt records its route; successful responses record the returned serving model. Failed calls are labelled unavailable rather than assigned an invented serving model.

## Probe thresholds

Thresholds are fixed in [app/probes/config.ts](app/probes/config.ts), outside prompts.

| Probe | Rule |
|---|---|
| P1 coverage | Valid unique station days divided by window days must meet the policy's minimum. |
| P2 missing as zero | Fails at 3 missing days, or 2 reported zeros with satellite rainfall at least 5 mm. |
| P3 flags | Excludes non-empty quality flags; reports measurement and source flags. |
| P4 early record end | Fails when the last valid station date is more than 3 days before the window ends. |
| P5 distance | Warns above the policy's distance limit and bars a sole-station index. |
| P6 divergence | On valid overlapping days, fails above 40% relative difference or 50 mm absolute difference. |
| P7 satellite gaps | Excludes fill value −999; warns above 3 missing days and fails above 6. A refusal requires a complete usable satellite window. |
| P8 borderline | An index within the policy's trigger band, including the boundary, forces inspection. |

GHCN precipitation is divided by ten exactly once. Missing, duplicate, malformed, non-finite and quality-flagged observations cannot count as valid station days.

## API

```sh
curl http://localhost:8000/health
curl -X POST http://localhost:8000/run \
  -H 'Content-Type: application/json' \
  -d '{"input":{"claim_id":"CLM-LAG-2025-001"}}'
```

`POST /run` also accepts `event_text` and an optional `policy_id`. Ambiguous intake asks for a policy rather than guessing. `options.max_extra_rounds` is an integer from 0 to 2. `GET /claims` returns the inbox and policies; `GET /runs/:id` returns a review from the current server session. `POST /runs/:id/feedback` accepts `{"kind":"helpful"}` or `{"kind":"wrong"}`. Responses contain structured errors and never expose credentials.

## Live setup

1. Run Zetaris and install Nightshift using the providers' instructions. Add the NVIDIA key **only in Nightshift's Providers tab**.
2. Copy `.env.example` to `.env`. Supply the Zetaris API key, organisation ID, Nightshift runtime token, contact email and the exact `meterless/*` Nemotron route listed by Nightshift's `GET /v1/models`. A routing name alone does not prove which model served a call; retain the returned model or Nightshift receipt.
3. Start Pluvia with `SAMPLE_MODE=false`. The local synthetic register is available at `/register/policies.json`, `/register/claims.json` and `/register/stations.json`.
4. Set `REGISTER_BASE_URL` to an HTTP address Zetaris can reach. For the local container installation, use `http://host.docker.internal:8000/register`. A published repository can use its public raw-file URL instead.
5. Run `npx tsx --env-file=.env scripts/register_zetaris.ts --print` to inspect SQL, then run without `--print` to register. It checks existing objects, executes one statement at a time, caches sources and validates the NOAA schema before creating dependent views. It stops on the first failure.
6. Run `npx tsx run.ts health`, then submit a claim. Keep the first live trace and record the live demo immediately.

Zetaris REST SQL is the sole live rainfall and policy data path. Agents never call NOAA or NASA directly. NOAA's public S3 archive needs no extra object store. NASA requests use independent `IMERG_PRECTOT` with `time-standard=UTC`; the gauge-corrected series is not an independent comparison. Nigeria's archive prefix is `NI`; `NG` is Niger.

For Pluvia in Docker, point Zetaris and Nightshift URLs to `host.docker.internal`, not the application container's own localhost. `.env` and runtime logs are excluded from the image build context. Never put an NVIDIA key in this project.

## Verification and evaluation

```sh
npm run check
SAMPLE_MODE=true npm run eval
```

`check` runs strict TypeScript validation, application tests and the official H-MEM conformance runner. The packaged upstream conformance result is **13/13 checks passed**; the current scorecard is saved to `logs/hmem-conformance.txt`. Tests cover payout boundaries, probe failures and repairs, guarded refusals, malformed rows, contract-window changes, source identity, retry/fallback traces, the real cached Lagos run and memory across fresh runtimes with network access forbidden.

The evaluation runner compares the naive station trigger, satellite only, a raw-totals model and the full Pluvia loop. Clean reference cases and injected faults come from the PRD's prescribed station candidates. Labels preserve the clean contractual payout; sparse real Nigerian cases do not claim known farm-level payout truth. Inspections are reported as abstentions. The raw-totals model baseline remains **unmeasured** until live Nightshift calls are available. See [eval/results.md](eval/results.md), the case files and source manifest for the latest reproducible measurements. No claim of superiority over all baselines is supported yet.

The evaluation includes a non-calendar Kitale window (15 August to 14 September 2021): 147.3 mm from the gauge versus 128.0 mm from the satellite, against a prior-year calibrated synthetic trigger of 139.2 mm. Station-only settlement suppresses a satellite-supported payout. The case injects distant-station metadata while retaining real rainfall and the original satellite point; it does not establish a measured distant farm loss. The full runner returns `PAY_ANYWAY` for ₦14,088.05. P2 also finds four suspect zeros, so the record does not prove the working-gauge scenario; P6, P7 and P8 pass. See the generated report for probe evidence. There is no first-of-month requirement. Evaluation inspection rates describe this fault-heavy case set, not a measured production rate.

The original dated Dodoma fixture was not available. The recovered observation slice corroborates reported zeros but includes missing calendar dates, which correctly trigger coverage findings. The fixed relative-divergence rule can also flag a small satellite total against zero. The brief's complete-window “no finding” acceptance check remains unresolved; the evaluation reports this rather than tuning thresholds to make the case pass.

## Repository

`app/` contains the loop, probes, gate, adapters and memory integration. `public/` is the claims desk. `data/` holds the synthetic register and genuine small snapshots. `scripts/` contains registration, source retrieval, climatology and official conformance tooling. `eval/` contains labelled cases and repeatable results. `input_examples/` and `output_examples/` pair runnable inputs with actual outputs. [PRD.md](PRD.md) and [Architecture.md](Architecture.md) describe the product contract and stack.

## Limits

Pluvia cannot establish what happened on a farm from these two indexes alone. Thin station coverage and legitimate point-versus-area differences can require inspection. The current sample examples cover one Lagos window. Policy calibration is a documented demonstration assumption, not actuarially validated pricing. The optional learned-bias detector is not implemented. No forecasting, yield modelling, underwriting or real settlement is provided. Live Zetaris and Nightshift adapters are fully implemented, but authenticated live registration and a served Nemotron model have not yet been verified against production credentials. No funds are transferred.

MIT for Pluvia. The vendored H-MEM code retains its Apache 2.0 licence.
