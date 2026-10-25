# Pluvia — Progress

**Now:** Sun 25 Oct, ~20:30 UTC (21:30 Lagos)
**Deadline:** Tue 27 Oct, 23:45 UTC (Wed 00:45 Lagos), hard
**Internal submit target:** Tue 27 Oct, 20:00 UTC (21:00 Lagos)
**Owners:** **S** = Sam (Windows, code, sample mode) · **T** = teammate (Mac, Zetaris + Nightshift live, demo)

**Rules**
1. A gate passes only when its **evidence** exists: command output, screenshot, or a log line committed to `docs/evidence/`.
2. If a gate misses its time, take its fallback **immediately**. No "almost done".
3. Push small commits often. T pulls before every live run.
4. Never stage a failure or hand-write a trace or an output example.

Legend: ☐ todo · ◐ in progress · ☑ done · ✖ blocked · ↪ fallback taken

---

## Gate 0 — Setup started · due **Sun 25 Oct, 22:30 UTC** (23:30 Lagos)

| # | Task | Owner | Status |
|---|---|---|---|
| 0.1 | Create the HackOS team (S as contact), invite T, T accepts. **We cannot submit without this** | S/T | ☐ |
| 0.2 | Agree the prize split in writing (a chat message is enough) | S/T | ☐ |
| 0.3 | T: register at Zetaris Cloud → download `zetaris-platform.zip` + copy the registry login command | T | ☐ |
| 0.4 | T: Docker Desktop, **Use Rosetta ON**, 8 GB RAM / 4 CPUs, ≥ 15 GB free disk | T | ☐ |
| 0.5 | T: `unzip`, `docker login`, `./preflight.sh` (all pass), edit `.env` admin email/password/org **before first start**, `docker compose pull && docker compose up -d` (runs while you do 0.6–0.7) | T | ☐ |
| 0.6 | Get an NVIDIA API key at build.nvidia.com (either of us; it goes only into Nightshift → Setup → Providers) | S/T | ☐ |
| 0.7 | T: install Nightshift for Mac (M1+ edition, **latest build from 25 Oct**), verify email, launch | T | ☐ |
| 0.8 | S: try **Nightshift Web hotspot** on the Windows laptop (announced 25 Oct). Record whether it exposes a Runtime URL + token | S | ☐ |
| 0.9 | S: create GitHub repo `pluvia`; push PRD.md, Architecture.md, progress.md, `.gitignore` (`.env`, `.env.*`, `!.env.example`, `node_modules`, `logs/*`) | S | ☐ |
| 0.10 | S: create a **public gist** (or make the repo public now) to host `data/register/*.json` for Zetaris (Architecture §7.2) | S | ☐ |

**Evidence:** HackOS team page with 2 members; `docker compose ps --all` output.

---

## Gate S0 — Sam's overnight build (sample mode, no Zetaris needed) · due **Mon 26 Oct, 08:00 UTC**

| # | Task | Owner | Status |
|---|---|---|---|
| S0.1 | Scaffold the repo per Architecture §3 (`package.json`, tsconfig, Hono, vitest, zod, openai, duckdb) | S | ☐ |
| S0.2 | `scripts/fetch_raw.ts`: download the per-station CSVs (7 Nigerian stations, plus 3 Ghana and 3 Kenya candidates) and NASA POWER JSON for each policy location (Jun–Sep 2024 and 2025, plus 2015–2024 for climatology) → `data/snapshots/` | S | ☐ |
| S0.3 | Read the GHCN `readme.txt`: confirm PRCP unit (tenths of mm?) and the `M/Q/S` flag meanings (A4). Write them into `data/README.md` | S | ☐ |
| S0.4 | `scripts/climatology.ts`: compute trigger/exit per location from prior-year satellite data; write `data/register/policies.json` (8–12 synthetic policies, `synthetic: true`) and `claims.json` | S | ☐ |
| S0.5 | `app/types.ts`, `domain/series.ts`, `domain/payout.ts`, `domain/naive.ts` + tests | S | ☐ |
| S0.6 | Probes P1–P8 + fixture tests (each fails on bad, passes on fixed) | S | ☐ |
| S0.7 | PolicyGate + tests for every rule | S | ☐ |
| S0.8 | `zetarisSample.ts` (DuckDB views with the **same names/columns** as Architecture §7) | S | ☐ |
| S0.9 | `trace.ts` JSONL logger | S | ☐ |
| S0.10 | Vendor H-MEM reference into `app/memory/hmem/`, run its tests and `examples/07-conflict-resolution` on Windows, then `hmem_conformance.sh` green against `app/memory/index.ts` | S | ☐ |

**Evidence:** `npm test` green; conformance output; `data/README.md` with confirmed units/flags.

---

## Gate 1 — Both sponsor layers alive + three Zetaris registrations proven · due **Mon 26 Oct, 09:00 UTC** (10:00 Lagos)

| # | Task | Owner | Status |
|---|---|---|---|
| 1.1 | `./verify.sh` → 9/9; `SELECT 1 AS one;` in the SQL Editor | T | ☐ |
| 1.2 | Create a Zetaris API key; confirm the org id (Management → Organisation; usually 1); put both in the Mac's `.env` | T | ☐ |
| 1.3 | Nightshift: NVIDIA in Providers; a lane on **Nemotron 3.5 Lightning** and/or **Nemotron 3 Ultra**; Reasoning-budget slider at default | T | ☐ |
| 1.4 | Console URL + token → `curl …/v1/models` lists `meterless/*`; one chat request with `max_tokens 800` answers; record **which model served it** (response or receipt) | T | ☐ |
| 1.5 | **A1:** register `station_nim00065201` per-station CSV (`header "true"`) + `CACHE TABLE` + `DESCRIBE` + `SELECT COUNT(*)`, and compare the count with the raw CSV row count | T | ☐ |
| 1.6 | **A2:** register `power_lagos_2025` REST table + the map-decoding view; `SELECT SUM(mm)` for July 2025 = **109.5 ± 0.1** | T | ☐ |
| 1.7 | **A3:** register `policies_raw` from the gist/raw URL + the explode view; row count = policies.json length | T | ☐ |
| 1.8 | Commit `docs/evidence/gate1.md` with outputs (tokens and keys hidden) | T | ☐ |

**Fallbacks (decide at 09:00 UTC, no debate):**
- 1.1 not done → S starts **Zetaris on AWS** (managed cluster guide); T keeps trying locally in parallel.
- 1.5 fails → use the verified `by_year/2025.csv` table (cached once) and filter by station.
- 1.6 fails → register POWER **snapshots** from the public gist/repo via the same REST pattern.
- 1.4 fails → swap Lightning/Ultra, raise `max_tokens`, post in **Help Meterless** with the exact error.

---

## Gate 2 — One real claim end to end, live · due **Mon 26 Oct, 15:00 UTC** (16:00 Lagos)

| # | Task | Owner | Status |
|---|---|---|---|
| 2.1 | `scripts/register_zetaris.sql` + `.ts` for all stations, POWER tables and the register (one statement at a time, 5 s pauses) | S (run by T) | ☐ |
| 2.2 | `zetaris.ts` live adapter + DataAgent SQL templates | S | ☐ |
| 2.3 | `nightshift.ts` adapter (`/v1/models` check, headers, timeout, retries, model logging) | S | ☐ |
| 2.4 | Intake, Planner, Auditor-explainer, Adjudicator, Reporter prompts + zod schemas | S | ☐ |
| 2.5 | Orchestrator loop with budgets and `partial` | S | ☐ |
| 2.6 | **Live run** of the Lagos claim (Jul–Aug 2025) on the Mac: probes fire (P1, P2, P6), naive trigger = PAY, Pluvia ≠ blind PAY, trace shows the Nemotron model on every LLM call | T | ☐ |
| 2.7 | `scripts/snapshot.ts` run on the Mac → exact Zetaris view outputs saved to `data/snapshots/` (sample mode now mirrors live) | T | ☐ |

**Evidence:** `logs/<run>.jsonl` committed as `docs/evidence/gate2-run.jsonl`.

---

## Gate 3 — Agent depth + memory + eval set · due **Mon 26 Oct, 22:00 UTC** (23:00 Lagos)

| # | Task | Owner | Status |
|---|---|---|---|
| 3.1 | Adjudicator evidence requests: `neighbor_station`, `prior_years`, `shift_window` → DataAgent → second round | S | ☐ |
| 3.2 | `pluviaMemory.ts`: recall, writePrecedent, writeStationLesson, recordConflict (H-MEM conflicts), feedback | S | ☐ |
| 3.3 | PolicyGate rule 5 wired to H-MEM conflict status | S | ☐ |
| 3.4 | `tests/memory.session.test.ts`: second claim on the same station → 0 extra rounds | S | ☐ |
| 3.5 | Live memory demo on the Mac: claim A, then claim B in a **fresh process**; traces show the recall | T | ☐ |
| 3.6 | Find ≥ 5 clean station-windows (coverage ≥ 95%) among Ghana/Kenya candidates (A7); `eval/build_cases.ts` generates labelled cases (target 20+) | S | ☐ |
| 3.7 | Record **cassettes** from live runs for the 3 shipped examples | T | ☐ |

**Evidence:** memory test green; `eval/cases/` committed; cassette files present.

---

## Gate 4 — Judgeable · due **Tue 27 Oct, 10:00 UTC** (11:00 Lagos) — FEATURE FREEZE

| # | Task | Owner | Status |
|---|---|---|---|
| 4.1 | `eval/run_eval.ts`: four deciders → `eval/results.md` (sample mode; live too if time) | S (live by T) | ☐ |
| 4.2 | UI: inbox, chart (missing days visible), decision card, naive box, probes, trace, memory, Confirm/Override | S | ☐ |
| 4.3 | `POST /run`, `GET /claims`, `GET /runs/:id`, `GET /health`, CLI; structured errors | S | ☐ |
| 4.4 | Rule-based sample stand-ins so a judge's **new** claim runs in sample mode | S | ☐ |
| 4.5 | Dockerfile builds; the container reaches the Mac's Zetaris and Nightshift via `host.docker.internal` | T | ☐ |
| 4.6 | 3 input examples + their **real** outputs saved from runs | T | ☐ |
| 4.7 | **Fresh-clone test:** new folder, empty `.env`, Zetaris and Nightshift stopped, `SAMPLE_MODE=true`, 3 examples pass | S | ☐ |
| 4.8 | Mutation check: disable P1 → orchestrator test fails | S | ☐ |
| 4.9 | Secret scan + `git ls-files` check | S | ☐ |

**After 10:00 UTC Tuesday: bug fixes only.**

---

## Gate 5 — Package · due **Tue 27 Oct, 17:00 UTC** (18:00 Lagos)

| # | Task | Owner | Status |
|---|---|---|---|
| 5.1 | README: problem, user, track, the Lagos July 2025 numbers, setup (link the Participant Setup Guide), `register_zetaris.sql` instructions, usage (CLI, API, UI), agents, probes and thresholds, H-MEM conformance output, eval table, **sample-mode honesty note**, synthetic-data labels, limitations | S | ☐ |
| 5.2 | Sponsor technology explanation: Zetaris (3 source types federated), H-MEM (feature + conformance + memory test), Nightshift connection (+ model evidence), NVIDIA Nemotron use, coding tool used, what was unique | S | ☐ |
| 5.3 | `metadata.json` (community schema) | S | ☐ |
| 5.4 | Slide deck covering the 8 required points (problem/users, solution, architecture, stack, Zetaris+Meterless use, what was unique, product visuals, future) | S | ☐ |
| 5.5 | Demo video 1–4 min (script below): checked frame by frame for keys/tokens (Nightshift Console and Providers tabs!); public link tested in a private window | T | ☐ |
| 5.6 | Repo **public**; tested logged out | S | ☐ |

---

## Gate 6 — Submit · due **Tue 27 Oct, 20:00 UTC** (21:00 Lagos)

| # | Task | Owner | Status |
|---|---|---|---|
| 6.1 | Roster final **before** creating the submission (it locks) | S | ☐ |
| 6.2 | HackOS form: name, one-line and short description, **Track 03**, members (names, HackOS emails, GitHub usernames, roles, contact), repo URL, video, deck, sponsor explanation, pre-existing components | S | ☐ |
| 6.3 | Submit; screenshot the confirmation | S | ☐ |
| 6.4 | Buffer until 23:45 UTC: fixes only; the submission can be updated until the deadline | S/T | ☐ |

---

## Cut list (in this order, if behind)

1. Could-haves: World Model, Ghana/Kenya in the UI, portfolio view, streaming
2. `shift_window` evidence request (keep `neighbor_station` and `prior_years`)
3. LLM-judge baseline in the eval (keep naive station and satellite-only)
4. Eval from 20+ cases → 10
5. UI → CLI + markdown decision letter only
6. **Never cut:** Zetaris live path, Nightshift + model logging, H-MEM conformance + memory test, the Lagos case, sample mode, traces, README honesty

---

## Demo video script (target 2:45)

| Time | Shot |
|---|---|
| 0:00–0:20 | Hook: "This farmer group is insured against drought. In July 2025 the Lagos station recorded **6.1 mm**. A normal index policy pays out. But it rained, and the satellite saw **109.5 mm**. The station only reported **10 of 31 days**." |
| 0:20–0:40 | Problem: index insurance and basis risk in one sentence; "broken data looks like drought". |
| 0:40–1:40 | Live run of the claim: Planner recalls nothing; DataAgent queries Zetaris (show SQL across the S3 station file, the NASA REST table and the policy register); Auditor probes fail P1, P2, P6; Adjudicator requests prior years; PolicyGate → **INSPECT**, not a blind payout. The "naive trigger would have paid ₦X" box. Trace with the Nemotron model on each call. |
| 1:40–2:10 | Memory: second claim on the same station, fresh process: H-MEM recalls the station lesson, no extra round; the conflict record and its trust-ledger entry. |
| 2:10–2:30 | Eval table: wrong payouts, naive vs Pluvia. |
| 2:30–2:45 | Sponsor stack in one slide; close: "The station said drought. The station was broken." |

---

## Decisions log

| When (UTC) | Decision | Why |
|---|---|---|
| Sun 25 Oct 13:45 | Tiresias chosen | Data-layer verification gap |
| Sun 25 Oct ~20:30 | **Pivot to Pluvia**, Track 03 | Field check: Tiresias's "verify against data" pattern is used by several strong teams; Pluvia keeps the core idea but has a concrete victim, an empty niche, and a failure verified on real 2025 Nigerian data |
| Sun 25 Oct ~20:30 | TypeScript stack; H-MEM as the required engine | H-MEM has a runnable TS reference, a conformance suite, and conflict resolution with a human-review gate that maps onto INSPECT |
| Sun 25 Oct ~20:30 | One Nemotron route; log the served model | Lane routing reported to collapse to `auto` |
| Sun 25 Oct ~20:30 | Policies and claims synthetic, rainfall real | Rules allow synthetic data; honesty labels everywhere |

---

## Verified facts (25 Oct) — see PRD §10

- **Nigerian stations:** 7 with PRCP into 2024–2025. Per-station CSVs exist at `s3://noaa-ghcn-pds/csv/by_station/<ID>.csv`, with a header.
- **Lagos (NIM00065201), July 2025:** 10 of 31 days reported, summing to 61 (6.1 mm if unit = tenths of mm).
- **NASA POWER, same point, same month:** 31 of 31 days, 109.5 mm. No key; fill −999; values keyed `YYYYMMDD`.
- **Kano (NIM00065046):** 5 reported days in 2024, 2 in 2025.

## Open questions (fill in as answered)

| # | Question | Answer |
|---|---|---|
| Q1 | A1: does Zetaris register a per-station CSV with `header "true"`? | |
| Q2 | A2: does the POWER REST table + map view return 109.5 mm for Lagos July 2025? | |
| Q3 | A3: does Zetaris read the register JSON from a public gist/raw URL? | |
| Q4 | A4: GHCN PRCP unit and `S` / `B` flag meanings (readme) | |
| Q5 | A5: exact Nemotron route id; does the response name the model? | |
| Q6 | A6: does Nightshift Web hotspot run on Sam's laptop? | |
| Q7 | A7: which Ghana/Kenya stations have ≥ 95% coverage for a full window? | |
| Q8 | Teammate's available hours Sun night – Tue night | |
