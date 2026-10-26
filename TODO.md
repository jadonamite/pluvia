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
| Tests | 86 passing across 17 files |
| TypeScript | `tsc --noEmit`, zero errors |
| Meterless H-MEM | Official vendor conformance runner, 13 of 13; scorecard committed at `logs/hmem-conformance.txt` |
| Offline dry run | 22 Zetaris statements and 2 NASA POWER endpoints validated |
| Evaluation | 46 labelled cases; Pluvia 0 wrong payouts, 0 missed payouts |
| Verdict spread | `NO_PAY` 14, `INSPECT` 26, `PAY` 5, `PAY_ANYWAY` 1 |
| Naive station baseline | 5 wrong payouts, 1 missed payout on the same 46 cases |
| Application code | about 6,000 lines of TypeScript across `app/`, `eval/`, `scripts/` |
| Sample input/output pairs | 6, run with one `npm run claim` command; Kitale returns `PAY_ANYWAY` |
| Zetaris | **Live.** Own instance on AWS EC2, 9 of 9 checks; 22 objects registered; a claim ran through six Zetaris queries |
| Nightshift | **Live.** `/v1/models` lists 56 routes; one full claim completed in 175 s |
| NVIDIA Nemotron | **Serving.** `nvidia/nemotron-3.5-bolt-e4b`, with a compute receipt per call |

---

# A. Needs a person

Nothing in this section can be done from a checkout. Each one is a hard dependency for
something below it.

## A1. One claim with both services live

- **Owner:** person
- **Why:** Zetaris is a required sponsor component and absent sponsor integration is on the
  disqualification list. The data path is now proven live: a Zetaris instance in Docker on an
  AWS EC2 virtual machine, reached through an SSH tunnel, authenticated and registered all 22
  objects (21 created, the container already present). Its views return the measured Lagos
  figures (gauge 10 days and 6.1 mm, satellite 31 of 31 days and 131.7 mm, 8,766 prior-year
  days), and a claim with live data and `sample-rules` returned `INSPECT` through six Zetaris
  queries. No claim has yet run with live data and a live model in the same process.
- **Do:** on one machine with both credentials in `.env` (Zetaris key and organisation ID,
  Nightshift token, pinned route), run `npx tsx run.ts health`, then
  `npm run claim -- input_examples/lagos_01.json` on fresh memory. Copy the trace to a committed
  `logs/trace-demo-*.jsonl` name.
- **Done when:** health reports `"sample_data":false` and `"sample_model":false`, and that claim's
  trace is kept in the repository.

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

## B2. Confirm a complete live run with two extra rounds

- **Owner:** person, after pulling
- **Why:** A live claim with the default two evidence rounds used to need about 479 seconds of
  model time against a 240 second budget and returned `partial`. The prompts are now compact:
  probe findings as one line each, the contract terms, and extra evidence reduced to totals
  (`app/agents/modelPayloads.ts`). On the cached Lagos claim the second Adjudicator prompt fell
  from 379,361 to 3,033 characters, and the Auditor and Reporter request the 800-token floor. The
  evaluation spread is unchanged. Only a live run shows whether the budget now holds.
- **Do:** with Nightshift live and the route pinned (B1), run
  `npm run claim -- input_examples/lagos_01.json` on a fresh memory directory and read the status.
  Do not raise the run budget to hide the cost.
- **Done when:** the live claim returns `status: success` with at least one evidence request in
  the trace.

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
