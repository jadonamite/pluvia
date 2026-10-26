# TODO

Everything still open between this commit and a finished submission. One list, ordered by
dependency rather than by date, with the exact command and the acceptance test for each item.

**This file is deleted when the last item is done.** Its presence means work remains; its
absence means the build is complete. Do not leave a half-ticked copy in the repository.

## How to read an item

Each item carries four things:

- **Owner** — `person` means it needs an account, a key, a signature or a camera and cannot be
  done by an agent. `code` means it can be done from a checkout with no credentials.
- **Why** — what breaks or what is lost if it is skipped.
- **Do** — the literal commands or steps.
- **Done when** — the observable result that closes the item. If the result is not observable,
  the item is not finished.

Tick an item by deleting it. Items are not reordered to fit a deadline; the submission date is
reference information and appears once, in the submission section, as a fact rather than a plan.

## Verified state at this commit

Measured, not estimated. Re-run `npm run check` to reproduce the first four lines.

| | |
|---|---|
| Tests | 81 passing across 16 files |
| TypeScript | `tsc --noEmit`, zero errors |
| Meterless H-MEM | Official vendor conformance runner, 13 of 13 |
| Offline dry run | 22 Zetaris statements and 2 NASA POWER endpoints validated |
| Evaluation | 46 labelled cases; Pluvia 0 wrong payouts, 0 missed payouts |
| Verdict spread | `NO_PAY` 14, `INSPECT` 26, `PAY` 5, `PAY_ANYWAY` 1 |
| Naive station baseline | 5 wrong payouts, 1 missed payout on the same 46 cases |
| Application code | about 6,000 lines of TypeScript across `app/`, `eval/`, `scripts/` |
| Sample input/output pairs | 5 |
| Zetaris platform | Running locally, 9 of 9 verification checks, **no API key yet** |
| Nightshift | **Live.** `/v1/models` lists 56 routes; one full claim completed in 175 s |
| NVIDIA Nemotron | **Serving.** `nvidia/nemotron-3.5-bolt-e4b`, with a compute receipt per call |

---

# A. Needs a person

Nothing in this section can be done from a checkout. Each one is a hard dependency for
something below it.

## A1. Zetaris API key and live registration

- **Owner:** person
- **Why:** Zetaris is a required sponsor component and absent sponsor integration is on the
  disqualification list. The adapter, the registration SQL and the schema checks are all written
  and tested offline, but nothing has ever authenticated. Until one statement executes against
  the live service, the data layer is proven in code and unproven in fact.
- **Do:**
  1. Generate an API key in the Zetaris Cloud dashboard and note the organisation ID.
  2. Fill `ZETARIS_API_KEY` and `ZETARIS_ORG_ID` in `.env`.
  3. Set `CONTACT_EMAIL` to a real address. Registration refuses to run on the placeholder
     because the address is sent as the user agent on NASA POWER requests.
  4. `npx tsx --env-file=.env scripts/register_zetaris.ts --print` and read the statements.
  5. Re-run without `--print` to register. It checks for existing objects, executes one
     statement at a time, caches each source and verifies the NOAA columns before creating
     dependent views. It stops on the first failure.
  6. `npx tsx run.ts health`
- **Done when:** health reports `"zetaris":"online"` and `"sample_data":false`, and one claim
  submitted with both services live writes a trace to `logs/` that is kept.

## A2. HackOS team

- **Owner:** person
- **Why:** Submission is impossible without a team, solo entries included, and composition locks
  the moment the first submission is created. There is no technical workaround and no recovery
  after the fact.
- **Do:** Create the team on HackOS. Confirm sponsor credits appear on the task board afterwards.
- **Done when:** a team exists and the submission form will accept an entry.

## A3. Record the demo video

- **Owner:** person
- **Why:** Demonstration clarity is a scored category and a demo video is a required deliverable.
- **Do:** Follow `workbench/submission/demo-script.md`, which carries the shot list and the
  rehearsal evidence. Record a cursor-driven walkthrough of the claims desk. Every number spoken
  must be one the running application displays on screen.
- **Done when:** a 1 to 4 minute recording exists, shows a claim adjudicated end to end, and
  names no figure that is not visible in the interface.

## A4. Build the slide deck

- **Owner:** person
- **Why:** Required deliverable.
- **Do:** Build from `workbench/submission/slide-outline.md`, which is already scoped to the
  eight sections the event asks for. No ask slide, no architecture-diagram slide.
- **Done when:** the deck covers all eight sections and every claim in it traces to a measured
  figure in `PRD.md`, `eval/results.md` or a committed trace.

---

# B. The model path

Nightshift is live and Nemotron is serving. These items decide whether the evidence is strong
enough to claim, and whether a full run finishes inside its own budget.

## B1. Pin the Nemotron route instead of automatic routing

- **Owner:** code
- **Why:** `meterless/auto` does not stay on NVIDIA. In the completed live run one of five calls
  was served by `openrouter/z-ai/glm-5.3-flash`. The hardware award is judged on use of Nemotron,
  so a trace where a fifth of the reasoning came from a different vendor weakens the claim for no
  gain. Nightshift's routing is worth describing in `SPONSORS.md`; it is not worth relying on in
  a demonstration.
- **Do:** set `METERLESS_MODEL=nvidia/nemotron-3.5-bolt-e4b` in `.env`. The health check accepts
  a pinned provider route as of commit `75413ef`. Avoid
  `nvidia/nemotron-3.5-lightning-30b-a3b`, which returns `_empty_response`, and
  `openrouter/nvidia/nemotron-3.5-lightning:free`, which returned HTTP 502.
  `nvidia/nemotron-3-ultra-550b-a55b` works and narrates before its JSON, which the parser now
  tolerates, but it is slower.
- **Done when:** a full claim trace shows every `model_response` line carrying
  `model: nvidia/...` and `model_identity: served_identifier`, with no other vendor present.

## B2. Trim the Auditor and Adjudicator payloads

- **Owner:** code
- **Why:** These two calls take 22 to 54 seconds each because their payloads carry every probe's
  full metric object plus the policy plus recalled memory. With the default two evidence rounds a
  run needs about 479 seconds of model time against a 240 second budget, so it returns `partial`:
  the decision is still made and written, but the reporter never finishes. With
  `max_extra_rounds: 0` the same claim completes in 175 seconds. A judge running the documented
  command should see a complete run, not a truncated one.
- **Do:** send the probe `id`, `name`, `status` and `evidence` line rather than the whole metric
  dictionary. Cap `max_tokens` per agent where the schema already caps the output; the Auditor
  explanation is limited to 120 words and does not need 1,200 tokens. Do not raise the run
  budget to hide the cost.
- **Done when:** a live claim with the default two extra rounds returns `status: success`, and
  the evaluation verdict spread is unchanged at `NO_PAY` 14, `INSPECT` 26, `PAY` 5,
  `PAY_ANYWAY` 1.

## B3. Measure the fourth evaluation decider

- **Owner:** code, after B1
- **Why:** `eval/results.md` reports `raw_totals_model` as unmeasured. That is the one comparison
  that answers the obvious challenge: why not just hand the rainfall totals to a model and ask?
  Without it the evaluation compares Pluvia against two arithmetic baselines only. Nightshift is
  live now, so the blocker is gone.
- **Do:** implement the decider to send the station and satellite totals and the policy terms to
  the configured route and parse a pay or refuse answer, then re-run `npm run eval`.
- **Done when:** `eval/results.md` carries four measured rows and states the model baseline's
  wrong and missed payout counts instead of the word unmeasured.

---

# C. Evidence and reproducibility

Items a judge trips over. Each one is small and each one is visible from the repository.

## C1. Add a sample pair that pays

- **Owner:** code
- **Why:** All five sample pairs return `INSPECT`. A judge who runs the documented commands never
  sees Pluvia pay anyone, so the product's central argument — that it restores payouts a station
  wrongly suppresses — is invisible from the command line. The Kitale case already exists as a
  case file.
- **Do:** add `input_examples/kitale_basis_risk.json` pointing at
  `eval/cases/KE000063661-2021-08-15-basis-risk.json`, run it through
  `scripts/run_sample_case.ts`, and commit the real output to `output_examples/`.
- **Done when:** one committed sample pair shows verdict `PAY_ANYWAY` and payout
  `14088.05`, and the README table lists it.

## C2. Resolve the two input schemas in `input_examples/`

- **Owner:** code
- **Why:** `input_examples/lagos_01.json` is a claim reference and runs with
  `npm run claim -- <file>`. `input_examples/teresina_zero_run.json` is `{"case_file": ...}` and
  fails that same command with `invalid_input`; it needs
  `npx tsx scripts/run_sample_case.ts <file>`. Both commands are documented, but the README shows
  the first form nine lines above the second, so the obvious extrapolation breaks. A judge who
  hits an error reads it as a broken build.
- **Do:** either teach `readClaimArgument` in `run.ts` to accept a `case_file` input and delegate,
  or move the case-file inputs into their own directory with their own heading.
- **Done when:** every file in `input_examples/` runs with one documented command, or each
  directory states its own command next to the files it holds.

## C3. Commit the conformance scorecard

- **Owner:** code
- **Why:** `logs/hmem-conformance.txt` is deliberately not committed because it contains an
  absolute machine path. The event asks for evidence in `logs/`, and the Meterless engine
  scorecard is the single strongest piece of sponsor evidence in the project.
- **Do:** write a path-stripped copy to a committed file, or make `scripts/hmem_conformance.ts`
  emit the path relative to the repository root so the output is safe to commit.
- **Done when:** the 13 of 13 scorecard is readable from the repository without running anything.

## C4. Rebuild and re-test the container

- **Owner:** code
- **Why:** The image was verified before the configuration split. `Dockerfile` sets
  `ENV SAMPLE_MODE=true`, which now forces both services onto cached evidence. That is still the
  right default for a judge with no credentials, but it must be re-confirmed rather than assumed,
  and the judge test is `docker build` followed by `docker run -p 8000:8000`.
- **Do:**
  ```sh
  docker build -t pluvia .
  docker run --rm -d --name pluvia-check -p 8000:8000 pluvia
  curl http://localhost:8000/health
  curl -X POST http://localhost:8000/run -H 'Content-Type: application/json' \
    -d '{"input":{"claim_id":"CLM-LAG-2025-001"}}'
  docker rm -f pluvia-check
  ```
- **Done when:** the container starts with no `-e` flags, health reports sample mode with its
  reason, and a posted claim returns a complete decision.

## C5. Update `.env.example` for the split mode

- **Owner:** code
- **Why:** It still implies `SAMPLE_MODE` is a single switch. Since commit `8b6c7bf` each service
  chooses live or cached from its own credential, and leaving the flag unset is now the useful
  default. Every setting a reader sees should be one the code actually reads, and its comment
  should be true.
- **Done when:** `.env.example` explains that the flag overrides both services and that omitting
  it lets each decide, and lists `METERLESS_MODEL` with a real route as the example value.

---

# D. Documents that must match the build

These are the last things written, because each one describes a state that items above change.

## D1. `SPONSORS.md`

- **Owner:** code, after A1 and B1
- **Why:** Its "What is proven today" table currently lists authenticated Zetaris registration and
  a served Nemotron completion in the *awaiting credentials* column. Half of that is now false:
  Nemotron has served real claims with receipts. The table is the most credible thing in the
  repository precisely because it is accurate, so it must not go stale in either direction.
- **Do:** move Nightshift and NVIDIA into the proven column with the receipt schema name, the
  routed model and the per-call logging as evidence. Move Zetaris across once A1 is done. Record
  that `meterless/auto` can route away from NVIDIA and that the route is pinned for this reason.
- **Done when:** every cell states what was actually observed, and nothing claims a credentialed
  execution that has not happened.

## D2. `README.md`

- **Owner:** code
- **Why:** The run instructions predate the configuration split and the sample pair table will
  change with C1 and C2.
- **Done when:** a reader with no credentials can follow it top to bottom and reach a decided
  claim, and every command in it has been executed as written.

## D3. `Architecture.md`

- **Owner:** code
- **Why:** The adapter selection section describes a single sample flag. It now describes per
  service selection, and the build contract says that if the code and this document disagree, one
  of them is fixed on purpose.
- **Done when:** the document matches `app/runtime.ts` and `app/config.ts`.

---

# E. Submission

## E1. Final pre-flight

- **Owner:** code
- **Do:**
  ```sh
  npm ci
  npm run check
  SAMPLE_MODE=true npm run eval
  git ls-files -z | xargs -0 grep -nIE "(nvapi-|sk-[A-Za-z0-9]{16,}|Bearer [A-Za-z0-9]{12,})"
  git status --short
  ```
- **Done when:** the gate is green, the evaluation reproduces, the secret sweep returns nothing,
  and the tree is clean.

## E2. Submit

- **Owner:** person
- **Why:** Registration and submission both close at **2026-10-27 23:45 UTC**, and this is the
  only place that date appears in this file. It is a fact about the window, not an instruction to
  shrink anything. Judging opens immediately afterwards with at least three judges per entry.
- **Do:** submit with the primary track set to **03 Reasoning Architecture**, the public
  repository link, the demo video, the deck and `SPONSORS.md` as the written sponsor explanation.
- **Done when:** the entry is accepted and its track is confirmed.

## E3. Mark it submitted everywhere, in the same turn

- **Owner:** code
- **Why:** A submission recorded in one place and not the others is how a project loses track of
  what is frozen during judging.
- **Do:** update `HANDOVER.md` with a status box carrying the date, the repository and live links
  and what stays frozen; tick this file's remaining items and delete it; update the Inertia
  tracker, its event file and its state; update the project memory.
- **Done when:** no document still describes the project as unsubmitted.

---

# F. Carried, not fixed

Known and deliberately left. Each is recorded so nobody rediscovers it as a surprise, and each
belongs in the limitations section of whatever document describes it.

- **The Dodoma acceptance case is unresolved.** The recovered record has 56 absent calendar dates,
  so coverage and divergence findings fire even though the reported zeros are independently
  corroborated. A complete-window, no-findings fixture has not been recovered. The evaluation
  reports this rather than tuning a threshold until the case passes.
- **The learned-bias detector is not implemented.** It needs roughly eight years of overlap and
  fifty ten-day blocks per station, which the Nigerian records do not have. The coverage probes
  catch the hero case without it.
- **Pluvia identifies a record unfit to settle a claim, never a broken instrument.** Suspect runs
  of zeros cluster across four countries in 2002 to 2005, so an archive ingest fault is the more
  likely cause. No document may claim instrument diagnosis.
- **The Kitale case injects distance metadata only.** Rainfall and the satellite request point are
  real; the one degree of latitude is synthetic. It demonstrates substitution, not a measured
  distant farm loss. It also still fails P2 on four suspect zeros, so it is not a clean
  healthy-gauge case.
- **Policy terms are synthetic.** Triggers and exits are calibrated from prior complete windows of
  independent satellite data. They are a documented demonstration assumption, not actuarial
  pricing.
- **`nvidia/nemotron-3.5-lightning-30b-a3b` is a broken lane** on this build, returning
  `_empty_response`. The Nightshift bundled help also states that the OpenAI-compatible endpoint
  is unavailable on this Mac edition; that is stale, and the endpoint works.

---

# G. After the submission freeze

Not part of the entry. Written down so the work survives judging.

- Replace the synthetic register with a real policy schema, so terms come from a contract rather
  than a fixture.
- Implement the learned-bias detector against a station archive dense enough to support it, and
  report its false positive rate against the corroborated dry spells.
- Extend beyond two sources. A third independent retrieval turns a disagreement into a vote.
- Add the peer-gauge stream from the original specification, which compares a station against its
  neighbours rather than against satellite alone.
- Make the inspection queue a real work surface: assign, resolve, and feed the outcome back into
  memory as a confirmed or corrected precedent.
- Measure what the inspection rate would be on a healthy gauge network rather than on a
  fault-injected case set, and publish it.
