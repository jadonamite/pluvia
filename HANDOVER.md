# Handover

For anyone picking this repository up without having built it. `README.md` says what Pluvia is
and how to run it, `PRD.md` holds the requirements, `Architecture.md` is the build contract and
`SPONSORS.md` records the sponsor integration. This document holds what those four cannot: the
current state, the decisions and why they went the way they did, and the traps that cost real
time to find.

Open items live in `TODO.md`. That file is deleted when the build is finished, so if it is
present there is work outstanding.

## 1. What this is, in one paragraph

A weather-index crop insurance policy pays out automatically when rainfall at one named gauge
falls below a trigger over a growing window. No inspector visits, and nothing in the contract
tests the instrument that produced the number. Pluvia runs deterministic probes over the gauge
record and an independent satellite retrieval, has a model reason about what the findings mean,
then lets plain code make the call. Four outcomes: pay, pay anyway, send an inspector, do not
pay. A refusal is never final and never reachable without complete independent evidence.

## 2. State

Reproduce the first block with `npm run check`.

| | |
|---|---|
| Tests | 81 across 16 files |
| TypeScript | `tsc --noEmit` clean |
| Meterless H-MEM | Official vendor conformance runner, 13 of 13 |
| Offline dry run | 22 Zetaris statements, 2 NASA POWER endpoints |
| Evaluation | 46 labelled cases, 0 wrong payouts, 0 missed payouts |
| Zetaris | Platform running locally, 9 of 9 checks. **No API key yet**, so the data path runs on cached evidence |
| Nightshift | **Live.** 56 routes listed; a full claim completed in 175 seconds |
| NVIDIA Nemotron | **Serving**, with a `meterless.compute_receipt.v1` on every call |
| Demo video, deck | Scripted and outlined in `workbench/submission/`, not yet produced |

The data layer and the model layer are at different stages, and that is deliberate — see §4.

## 3. Running it

```sh
npm ci
npm start                 # http://localhost:8000
```

No environment file, account or credential is needed. With no credentials present both services
use cached evidence and the health endpoint says so, including the reason.

```sh
npm run claim -- input_examples/lagos_01.json
npx tsx scripts/run_sample_case.ts input_examples/teresina_zero_run.json
npm run check             # typecheck, tests, vendor conformance, offline dry run
npm run eval              # the 46-case evaluation
```

Two input shapes exist and they take different commands. `TODO.md` item C2 covers merging them.

## 4. The decisions, and why

### Each service runs live or cached on its own credential

Sample mode used to be one switch for the whole application, so a live model required a live
database. That made it impossible to prove the Nightshift integration while the Zetaris key was
still outstanding, and it meant one service failing during judging would take the other down
with it. `app/config.ts` now derives `sample.zetaris` and `sample.nightshift` separately from
their own credentials, an explicit `SAMPLE_MODE` overrides both, and `/health` reports
`sample_data` and `sample_model` as distinct facts. Nothing may report a live path while serving
cached evidence.

### The model proposes, the code disposes

`app/agents/policyGate.ts` is the only path to a payout figure. It recomputes the probes itself
rather than trusting the ones the model saw, so model prose cannot clear a failed probe. Where
the gate substitutes satellite evidence for a barred station, it requires the adjudicator's
rationale to name every failed probe by id; a vague rationale returns an inspection instead. No
model can move money, and no remembered confidence can either.

### Three guarantees that must never be removed

A refusal is unreachable without complete independent satellite evidence. A refusal is
unreachable on a station whose coverage is below the policy minimum. Every refusal carries the
strongest case for paying and routes to a human. These are tested in
`tests/policyGate.test.ts`. If a change makes one of them pass without the guard, the change is
wrong.

### TypeScript rather than Python

The Meterless H-MEM reference implementation and its official conformance runner are TypeScript.
Passing the vendor's own suite is far stronger evidence than a self-written test, so the whole
application follows the engine.

### Zetaris REST rather than JDBC

Language agnostic, container friendly and scriptable for registration. The live path is
`POST {ZETARIS_REST_URL}/sql-editor/sqls/run` with a bearer token and an `X-Org-ID` header.

### No object store

NOAA publishes the station archive on a public S3 bucket, which Zetaris reads directly with a
filestore recipe and `CACHE TABLE`. An entire component and an ingest stage were removed.

### The Nemotron route is pinned, not automatic

`meterless/auto` routes for cost and speed and does not stay with one vendor: in a completed
run, one of five calls was served by an OpenRouter model. Nightshift's routing is a real
capability and is described in `SPONSORS.md`, but a demonstration needs a trace where every call
names the same model.

## 5. Facts established by measurement

Do not re-derive these and do not substitute different numbers. The method is recorded in
`PRD.md` §8 and the per-case provenance in `eval/cases/`.

**The hero case.** Lagos station `NIM00065201`, July 2025: the ground gauge reported 10 of 31
days totalling 6.1 mm; the independent satellite retrieval reported 31 of 31 days totalling
131.7 mm. It was the middle of the rainy season. Nine of the ten reported days read exactly
0.0 mm and every one carries a blank quality flag, meaning it passed every check the archive
performs. A rule that sums what is present sees 6.1 mm, declares a severe drought and pays
₦2,500,000 in full for an event that did not happen.

**The reverse case.** Kitale `KE000063661`, 15 August to 14 September 2021, which is not a
calendar month: the gauge totalled 147.3 mm over 30 of 31 days against an independent satellite
total of 128.0 mm, with a prior-year calibrated trigger of 139.2 mm. The station-only trigger
refuses; the corrected index restores a payout of ₦14,088.05. This is the `PAY_ANYWAY` outcome
on measured rainfall. Only the station's distance metadata is synthetic.

**Coverage.** Nigeria carries ten stations with rainfall in this archive, eight usable, roughly
2,050 station-days across 52 years. Completeness must be measured over the satellite-overlap
era, not the lifetime: one station measures 73 per cent complete across its full record and 10
per cent since 2001.

**Agreement.** Gauge-to-satellite correlation runs 0.30 to 0.37 daily and 0.58 to 0.80 over
ten-day periods, which is why ten days is the smallest usable unit.

**A true negative.** Dodoma `TZ000063862` holds a 175-day run of zeros that the satellite
corroborates at 11.85 mm total with no day reaching 5 mm. A detector that fires on it is wrong,
and an evaluation built only from injected faults measures the wrong thing.

## 6. Traps already paid for

1. **The archive's `NG` is Niger. Nigeria is `NI`.** Latitudes near 18°N give the mistake away.
2. **The obvious satellite precipitation field is bias-corrected using gauge data**, which makes
   a gauge-against-satellite comparison partly circular. Use the independent `IMERG_PRECTOT`
   retrieval — and it returns the fill value for every day unless the request sets
   `time-standard=UTC`. Same Lagos window: 131.7 mm independent against 109.5 mm corrected.
3. **Zetaris cannot read a local file**, and does not need to.
4. **A model returning valid JSON with invented keys is a prompting failure, not a model
   failure.** Burying the contract inside a payload object produced `{"plan":[...]}` where
   `{"explanation":...}` was required, on every call. Naming the exact keys in the system prompt
   took validation failures from 11 to 1 and deterministic fallbacks from 3 to 0.
5. **A reasoning model narrates before it answers.** `app/agents/modelJson.ts` extracts the first
   balanced JSON object rather than assuming the reply begins with a brace.
6. **Nightshift's bundled help is stale** about this Mac edition. It states in three places that
   the OpenAI-compatible endpoint is unavailable on the M1–M4 build. It works: `/healthz` returns
   200 and `/v1/models` lists 56 routes.
7. **`nvidia/nemotron-3.5-lightning-30b-a3b` returns `_empty_response`.** Broken lane, not a
   configuration error.

## 7. Where things live

| Path | Holds |
|---|---|
| `app/probes/` | The eight deterministic probes. Pure functions, no I/O |
| `app/agents/policyGate.ts` | The contract. The only path to a payout figure |
| `app/orchestrator.ts` | The bounded agent loop, tracing, memory writes |
| `app/memory/` | The vendored H-MEM reference plus the claim-scoped wrapper |
| `app/adapters/` | Zetaris and Nightshift, each with a cached-evidence twin |
| `scripts/register_zetaris.ts` | Generates and executes the live registrations |
| `scripts/dry_run_check.ts` | Validates every live statement and endpoint offline |
| `eval/` | 46 labelled cases, the fault injector and the reproducible results |
| `logs/` | Run traces as JSONL, one object per step, plus committed demo traces |
| `workbench/` | Gitignored. Raw downloads, submission drafts, internal notes |

## 8. House rules this repository follows

- Secrets never committed. `.env` and `.env.*` are ignored; `.env.example` carries placeholders
  only. The NVIDIA key belongs in Nightshift's Providers settings and nowhere else. A committed
  key is grounds for disqualification; if one ever reaches a public repository, rotate it rather
  than rewriting history.
- `workbench/` is gitignored and holds everything that is not the product.
- No emojis in code, documentation, interface copy or commit messages.
- Commit messages are short and proposed before they are made.
- Code comments say what the code does, briefly. No specification identifiers, no history, no
  names of people.
- Every configuration setting listed in a document is one the code reads.
- Deadlines are reference information. They never shape scope or sequencing.

## 9. If you change one thing, check these

- Change a probe threshold: `app/probes/config.ts`, then re-run `npm run eval` and confirm the
  verdict spread against `eval/results.md`. A threshold moved to make a case pass is a tuned
  result, not a measurement.
- Change the gate: `tests/policyGate.test.ts` holds the three guarantees in §4. They must still
  fail when the guard is removed.
- Change the memory wrapper: `npm run conformance` must stay at 13 of 13. The vendored reference
  under `app/memory/hmem/` is unmodified and must stay that way.
- Change the live SQL or an endpoint: `npm run dry-run` validates the quoting, the
  `IMERG_PRECTOT` parameter, `time-standard=UTC` on every URL and the `-999` fill handling.
- Change anything at all: `npm run check` before you commit.
