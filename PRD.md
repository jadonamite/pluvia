# Pluvia — Product Requirements Document

**Event:** Open Agent Hackathon 2026 (GenAI.Works, HackOS)
**Track:** 03 — Reasoning Architecture ("turn data, knowledge, memory, and reasoning into reliable decisions and actions")
**Team:** 2 builders. **S** = Sam (Windows laptop), **T** = teammate (MacBook M1 Pro, 16 GB)
**Submission deadline:** Tue 27 Oct 2026, 23:45 UTC (Wed 28 Oct, 00:45 Lagos). Hard.
**Internal submit target:** Tue 27 Oct, 20:00 UTC (21:00 Lagos)
**Name:** Pluvia (Latin for "rain"). Chosen by Sam, 25 Oct.

Companion docs: `Architecture.md` (how it's built), `progress.md` (gates, owners, tasks).

---

## 1. One-liner

**Pluvia checks whether the rain data behind a crop-insurance payout is telling the truth, before any money moves.** It compares the ground weather station with satellite rainfall, catches broken or missing records, and decides **pay**, **don't pay**, or **send an inspector**, with the evidence attached. It remembers each decision as a precedent, so the next claim on the same station is decided the same way.

Tagline: **"The station said drought. The station was broken."**

---

## 1a. The project explained from zero (read this first)

**The insurance.** A group of maize farmers near Lagos buys *index insurance*: "If the rain gauge near your farm measures less than 150 mm of rain between 1 July and 31 August, we pay you automatically." There's no inspector and no paperwork, so it's cheap enough for small farmers. The whole system trusts one number: what the gauge says.

**What we found in real data (25 Oct 2026).** For July 2025 at the Lagos station:
- the official record has readings on only **10 of 31 days**, adding up to **6.1 mm**;
- NASA's satellite estimate for the same spot has all **31 days**, totalling **109.5 mm**.

July is the rainy season. The station simply wasn't reporting, so the missing days aren't "zero rain", they're missing. A simple payout rule adds up what's there, sees 6.1 mm, and pays the full amount for a drought that never happened. Kano's station reported on only 5 days in all of 2024.

**A broken gauge looks exactly like a drought.** The opposite also happens: a real drought hidden by a wrong source, and a farmer who lost their crop gets nothing.

**What Pluvia does,** before any money moves:
1. Reads the claim and finds the policy.
2. Gathers the station readings and the satellite estimate through Zetaris.
3. Runs checks: days actually recorded, missing days counted as zero, the two sources disagreeing, station distance, and records that end early.
4. An AI reviewer (NVIDIA Nemotron) studies the failures and can ask for more evidence, such as "is 109.5 mm normal for Lagos in July?"
5. A strict rule engine, plain code rather than AI, makes the final call: **PAY**, **DON'T PAY**, or **SEND AN INSPECTOR**.
6. It shows the officer everything: a chart with the missing days visible, each check's result, and "a normal automatic policy would have paid ₦2,500,000 here".
7. It remembers (Meterless H-MEM): "Lagos station unreliable for the 2025 rainy season". The next claim on that station is flagged immediately, and similar cases get the same decision.

**Real vs invented.** The rainfall data and its failures are real. The farmer groups, policies, claims and amounts are invented and labelled as synthetic.

**One sentence:** index insurance pays farmers automatically from rain gauges, but broken gauges look exactly like droughts. Pluvia checks the gauge against satellite data before money moves, decides pay / don't pay / send an inspector, shows the evidence, and remembers which stations can't be trusted.

---

## 2. The problem, in plain words

### 2.1 How index ("parametric") crop insurance works

Smallholder farmers in Africa increasingly buy insurance that pays **automatically when rainfall falls below a trigger**. There is no loss adjuster visiting the farm. For example: *"If cumulative rainfall at the reference station from 1 July to 31 August is below 150 mm, pay ₦X per hectare."*

This keeps premiums low enough for small farmers. The weakness is well known: the industry calls it **basis risk**, when the index says something different from what actually happened on the farm. Arbol, a parametric insurer, describes this as the main drawback of the model.

### 2.2 The failure nobody surfaces: broken data looks like drought

A World Climate Research Programme (WCRP) briefing on African weather data reports:
- African station records in the main global dataset (GHCN) "often run out in past ten years";
- some feeds record **missing days as zero rain**, which the author calls a potential "BIG PROBLEM".

**We confirmed this live, on 25 Oct 2026, with real 2025 data:**

| Source | Location | July 2025 | Days reported |
|---|---|---|---|
| NOAA GHCN-Daily ground station `NIM00065201` (Lagos / Ikeja area, 6.577°N 3.321°E) | Station | **6.1 mm** (sum of reported values, 61 in tenths of mm) | **10 of 31** |
| NASA POWER satellite/model estimate, same coordinates | Grid point | **109.5 mm** | **31 of 31** |

The Lagos station reported only 44 days of rain observations in all of 2025. The Kano station (`NIM00065046`) reported **5 days in all of 2024 and 2 in 2025**.

A naive trigger that sums the station's July values would declare a **severe drought in Lagos during the rainy season** and pay out. The opposite error also happens: a real drought can be hidden if the satellite overestimates rain and nobody looks at the ground.

### 2.3 Who is harmed

| Person | Harm today |
|---|---|
| **Smallholder farmer** | Doesn't get paid in a real drought (index wrong), or the scheme collapses because it paid for droughts that never happened |
| **Claims officer** at a microinsurer, cooperative, NGO or agri-lender running index insurance | Can't see *why* the index says what it says; no time to audit station records by hand; decisions inconsistent between officers |
| **The insurer / reinsurer** | Pays false claims, loses trust in the product, raises premiums |

**Primary user for the demo:** a claims officer reviewing drought claims for Nigerian farmer groups.

---

## 3. What Pluvia does (user flow)

1. **Claim arrives.** The officer selects or submits a claim: farmer group, policy, location, season, event ("drought, July–August 2025"). Free text is accepted too: "Kano group says the rains failed in July."
2. **IntakeAgent** (Nemotron) turns free text into a structured claim and matches it to a policy.
3. **PlannerAgent** (Nemotron) reads the policy terms, recalls relevant **precedents** from H-MEM ("this station was unreliable last time"), and writes a plan: which sources, which windows, which checks.
4. **DataAgent** (code) queries **Zetaris** for:
   - the policy register;
   - the reference ground station's daily rainfall (NOAA GHCN-Daily);
   - satellite/model daily rainfall for the farm's coordinates (NASA POWER).
5. **AuditorAgent** runs deterministic **probes** (§5.3) on both sources and asks Nemotron to explain the findings in plain words.
6. **AdjudicatorAgent** (Nemotron) weighs the evidence and either:
   - proposes a decision and the trusted index source, or
   - **requests more evidence** (a neighbouring station, the same window in previous years, a shifted window), which sends the loop back to the DataAgent. At most 2 extra rounds.
7. **PolicyGate** (code, not an LLM) applies the contract and the guardrails:
   - computes the index and the payout;
   - forces **INSPECT** if data quality is insufficient, if the sources conflict beyond tolerance with no resolution, or if the result is within the borderline band of the trigger.
8. **ReporterAgent** produces the decision card and a plain-language decision letter:
   - PAY / NO PAY / INSPECT, the payout amount, the index used;
   - every probe finding with its evidence (for example, "21 of 31 July days missing at the station");
   - **what a naive station-only trigger would have done**.
9. **H-MEM** stores:
   - a **precedent** (claim facts → decision → reason);
   - a **station reliability lesson** ("NIM00065201, 2025 rainy season: coverage 32%, do not use alone");
   - a **conflict record** between "station says 6.1 mm" and "satellite says 109.5 mm", resolved by H-MEM's built-in conflict resolution (auto-resolve only when confidence ≥ 0.70, otherwise queued for human review). That queue *is* the INSPECT outcome.
10. **Next claim on the same station:** the Planner recalls the lesson. The first pass goes straight to the right evidence, with no repair round. This is the memory demo.

---

## 4. Requirements

### 4.1 Must have (submission is at risk without these)

| ID | Requirement | Evidence for judges |
|---|---|---|
| M1 | **Zetaris is the data layer.** Station rainfall, satellite rainfall and the policy register are all read through Zetaris over its REST API. No agent reads S3 or NASA directly in live mode | Trace lines with Zetaris SQL; README |
| M2 | **Meterless Nightshift is the primary AI provider.** Every LLM call goes through the Nightshift Runtime with an NVIDIA Nemotron model | Trace lines with `model` per call; Nightshift receipts |
| M3 | **H-MEM implemented in a working feature.** Precedents, station lessons and conflict records are written and recalled across sessions. The **official H-MEM conformance suite passes** against our build | Conformance output in README; session-2 trace |
| M4 | A **real agent loop:** at least Planner, Auditor and Adjudicator with visible handoffs, an evidence-request branch and retries | JSONL traces |
| M5 | **Traces:** JSONL in `logs/` and on stdout, with agent, action, Zetaris SQL, probe results, H-MEM reads/writes/conflicts, and the **model name per request** | `logs/*.jsonl` |
| M6 | **`SAMPLE_MODE=true`** runs real agent logic on cached data with Zetaris, Nightshift and credentials all absent | Fresh-clone test |
| M7 | **Programmatic entry point:** `POST /run` (JSON in, JSON out) plus a CLI | README |
| M8 | **At least 3 sample inputs with their real outputs** (`input_examples/`, `output_examples/`) | Repo |
| M9 | Public repo, README, `.env.example` with placeholders only, **no secrets** anywhere (repo, video, deck, logs) | Secret scan |
| M10 | Demo video (1–4 min), slide deck (8 required points), sponsor technology explanation | Submission form |
| M11 | **Honesty labels:** policies and claims are synthetic and say so; rainfall data is real and says so | README, UI footer |

### 4.2 Should have (needed to score well)

| ID | Requirement |
|---|---|
| S1 | **Headline eval** (§6): wrong-payout rate of a naive station trigger vs satellite-only vs an LLM judge vs Pluvia, on a labelled case set |
| S2 | **UI:** claim inbox; claim page with a daily rainfall chart (station vs satellite, missing days highlighted), probe findings, decision card, a "naive trigger would have…" box, trace timeline, memory panel |
| S3 | **Memory demo across sessions:** the first claim on a station needs an evidence-request round; the second claim on the same station needs none |
| S4 | **Nemotron visibly does the reasoning** (intake, planning, adjudication, explanations), with the model logged on every call, for the DGX Spark award |
| S5 | Dockerfile; container reaches Zetaris and Nightshift on the host via `host.docker.internal` |
| S6 | `metadata.json` at repo root describing each sponsor's use (community schema posted in #use-case-help; not official) |

### 4.3 Could have (only if ahead of schedule)

- A second engine: **World Model** holding farms, stations, policies and their distances as linked entities.
- Ghana and Kenya stations, alongside Nigeria.
- A "portfolio view": all claims for a season, with how many naive payouts Pluvia blocked or rescued.
- Streaming progress to the UI.

### 4.4 Out of scope

- Real farmer personal data. All policyholders are synthetic.
- Real payments, mobile money or smart contracts.
- Weather forecasting or crop-yield modelling.
- Pricing or underwriting new policies.
- Scout Intent, Markovian. One engine done properly beats four done badly.

---

## 5. Domain model and rules

### 5.1 Policy (synthetic, labelled as such)

| Field | Example |
|---|---|
| `policy_id` | `POL-LAG-2025-014` |
| `group_name` | "Ikorodu Maize Cooperative (synthetic)" |
| `crop` | maize |
| `farm_lat`, `farm_lon` | 6.60, 3.35 |
| `ref_station_id` | `NIM00065201` |
| `window_start`, `window_end` | 2025-07-01, 2025-08-31 |
| `trigger_mm` | cumulative rainfall below which the policy pays (e.g. 150) |
| `exit_mm` | rainfall at or below which the **maximum** payout applies (e.g. 60) |
| `sum_insured_ngn` | per group (e.g. 2,500,000) |
| `borderline_band_mm` | ± band around the trigger that forces INSPECT (e.g. 15) |
| `min_coverage` | minimum share of window days with valid data (e.g. 0.85) |
| `max_station_km` | maximum farm–station distance for the station to be the sole index (e.g. 25) |

**Payout rule (linear, standard in index insurance):**
- index ≥ `trigger_mm` → 0
- index ≤ `exit_mm` → 100% of sum insured
- in between → `(trigger_mm − index) / (trigger_mm − exit_mm) × sum_insured`

Trigger values are chosen per region from the **satellite climatology of previous years** (computed by a script, documented), not invented.

### 5.2 Claim

`claim_id`, `policy_id`, `submitted_at`, `event_text` (free text), and optional `window_override`.

### 5.3 Probes (deterministic, unit-tested)

| ID | Probe | Rule | Why |
|---|---|---|---|
| **P1** | Station coverage | valid station days in window ÷ window days < `min_coverage` → **fail** | GHCN Nigerian stations report 2–64 days a year (verified) |
| **P2** | Missing-as-zero | missing days silently treated as 0 by a naive SUM; also count reported zeros on days the satellite shows ≥ 5 mm → **fail** if material | WCRP warns some feeds record missing days as zero |
| **P3** | Quality and measurement flags | rows with non-empty `Q_FLAG` excluded; `M_FLAG` and `S_FLAG` counts reported (meanings confirmed from the GHCN readme at Gate 1) | Flags mark failed checks and data sources |
| **P4** | Record ends early | last valid station date < window end − 3 days → **fail** | Records "run out" |
| **P5** | Station distance | haversine(farm, station) > `max_station_km` → **warn** (cannot be sole index) | Pluvia risk from distant stations |
| **P6** | Source divergence | on days both sources have data, compare totals; relative difference > 40% or absolute > 50 mm → **fail** | Ground and satellite disagree |
| **P7** | Satellite fill | NASA POWER days equal to −999 → excluded; > 3 in window → **warn** | POWER's documented fill value |
| **P8** | Borderline | chosen index within ± `borderline_band_mm` of trigger → **INSPECT** | Too close to call automatically |

### 5.4 Decision rules (PolicyGate, code)

The Adjudicator (LLM) **proposes**; the PolicyGate (code) **disposes**.

1. If the station passes P1–P4 and P6 → station is the index (it is the contract's reference).
2. If the station fails P1/P2/P4 but the satellite passes P7 → satellite is the index, **only if** the Adjudicator cites the failed probes. The decision is labelled "station unreliable; satellite used".
3. If both sources fail, or P6 fails with no resolving evidence after the allowed rounds → **INSPECT**.
4. P8 borderline → **INSPECT**, regardless of source.
5. H-MEM conflict between sources unresolved (confidence < 0.70) → **INSPECT**.
6. Otherwise apply the payout rule → **PAY** (amount) or **NO PAY**.

The LLM can't move money on its own. A probe failure can only be cleared by new evidence that passes the probes.

---

## 6. Evaluation (honest, measurable)

**Problem:** no ground truth exists for "what really happened on the farm".

**Method: fault injection on real data, plus real Nigerian cases.**

1. **Clean reference series:** real station-windows with high coverage (≥ 95% days) and close satellite agreement. Candidate stations are in Ghana or Kenya, or any well-covered GHCN station. They are confirmed at Gate 3; if none qualify we say so.
2. For each clean series, compute the true decision from the clean data. Then create labelled variants with **known injected faults**: drop N days, replace missing with zeros, truncate the end of the record, add a 3-day shift, and use a distant station.
3. **Real Nigerian cases** (Lagos, Kano and others for 2024–2025), labelled **INSPECT** or "station unreliable" based only on documented coverage facts, never on our model's output.
4. **Compare four deciders:**
   - naive station trigger;
   - satellite only;
   - LLM judge given raw totals;
   - Pluvia.
5. **Metrics:**
   - wrong payouts (paid when it shouldn't);
   - missed payouts;
   - INSPECT rate;
   - mean time per claim.

Target 20+ cases. **Report whatever we measure.** The eval script and case files ship in the repo, so judges can re-run it.

---

## 7. Success metrics

| Metric | Target |
|---|---|
| The Lagos July 2025 case is caught (naive = PAY, Pluvia = not a blind PAY) | 100% repeatable, live and in sample mode |
| Pluvia wrong-payout rate on the eval set | Lower than all three baselines, reported honestly |
| Memory demo | Second claim on the same station: 0 evidence-request rounds vs ≥ 1 on the first |
| Run time per claim | < 2 min live, < 20 s sample mode |
| Fresh clone | Someone who hasn't touched the repo follows the README without asking anything |

---

## 8. Judging rubric fit

| Criterion | Pts | How Pluvia earns it |
|---|---|---|
| Impact | 30 | Real farmers, real money, a documented industry problem (basis risk), a failure verified on real 2025 Nigerian data, built by a Lagos team |
| Technical | 20 | Two real sources that disagree, federated in Zetaris; deterministic probes; a code-enforced decision gate; a bounded evidence-request loop; measured eval; traces |
| Innovation | 15 | Treats data quality as part of the claim decision. Uses H-MEM's conflict resolution and human-review queue as the INSPECT mechanism |
| Demo | 15 | One chart: 10 grey "missing" bars and a satellite line. "Naive trigger pays. Pluvia sends an inspector." |
| Product & UX | 10 | A decision card a claims officer can act on, plus a plain-language letter |
| Sponsor Tech | 10 | Zetaris joins S3 CSVs, a REST satellite API and the policy register in SQL; H-MEM holds precedents and conflicts; Nemotron reasons; everything goes through Nightshift |

---

## 9. Prior art and field

| Prior art | What it does | How Pluvia differs |
|---|---|---|
| Parametric insurers (Arbol, ACRE Africa, Pula, IBISA) | Automate payouts from an index | Pluvia audits whether the **index data itself** is trustworthy for *this* claim, and explains it |
| Generic "AI for crop insurance" platforms (for example Stack AI's enterprise pages) | Workflow automation | No source-vs-source data-quality adjudication found |
| Hackathon field (1,044 teams checked 25 Oct) | — | No team mentions crop insurance claims. Closest: **RiverTruth** (why flood gauges and forecasts disagree, for flood forecasters): different user, different decision |

Honest weakness: a judge may ask "is this a real insurer's workflow?" Answer: the decision structure (index, trigger, exit, payout, basis risk) is standard. The policies are synthetic and labelled. The rainfall data and its failures are real.

---

## 10. Verified facts (25 Oct 2026) and remaining assumptions

### Verified

| Fact | How |
|---|---|
| Nigeria has 7 GHCN rainfall stations reporting into 2024–2025: `NIM00065046` (12.048, 8.525), `NIM00065101` (8.44, 4.494), `NIM00065123` (9.617, 6.533; last year 2024), `NIM00065134` (9.64, 8.869), `NIM00065167` (9.258, 12.43), `NIM00065201` (6.577, 3.321), `NIM00065250` (5.015, 6.95). Ghana: 16; Kenya: 10 | Filtered `ghcnd-inventory.txt` |
| Per-station CSVs exist at `s3://noaa-ghcn-pds/csv/by_station/<ID>.csv`, **with** a header row `ID,DATE,ELEMENT,DATA_VALUE,M_FLAG,Q_FLAG,S_FLAG,OBS_TIME` | Fetched directly |
| Nigerian stations have very sparse reporting (Kano 2024: 5 days; Lagos 2025: 44 days, July 2025: 10 days) | Counted |
| NASA POWER daily point API: no key, JSON, values at `properties.parameter.PRECTOTCORR` keyed `YYYYMMDD`, units mm/day, fill −999, Lagos July 2025 = 109.5 mm over 31 days | Called the API |
| Zetaris has a verified GHCN-Daily filestore recipe (public bucket, CSV, `CACHE TABLE` required) | Read `02_noaa_ghcn_create.sql` |
| Zetaris REST tables: endpoint, query and headers are fixed at CREATE; dynamic-key JSON is decoded with `from_json(to_json(..),'map<..>')` + `explode` | Read REST HOWTO + SQL Companion |
| H-MEM conflict resolution detects "divergent numeric values", auto-resolves at ≥ 0.70 confidence, else queues for human review; every resolution writes the trust ledger | Read `engines/hmem/docs/conflict-resolution.md` |
| H-MEM conformance runner: `HMEM_IMPL=/abs/path/index.ts npx tsx conformance/runner.ts`; implementation must export an `HMEM` class | Read `conformance/runner.ts` |

### Not yet verified (each has a gate in progress.md)

| # | Assumption | Fallback |
|---|---|---|
| A1 | Zetaris registers a **per-station** CSV (`header "true"`) | The verified `by_year/2025.csv` table plus `CACHE TABLE` (slow first load) |
| A2 | Zetaris registers NASA POWER as a REST table and decodes the date-keyed map | Same REST pattern against a snapshot JSON committed in our public repo (raw GitHub URL), still read through Zetaris |
| A3 | Zetaris registers the policy register as a REST table from a public raw GitHub JSON URL | Cache it in Zetaris from a different public HTTP host |
| A4 | GHCN PRCP unit is tenths of mm; `S` source flag = Global Summary of the Day; `M_FLAG` meanings | Read `readme.txt` before quoting units or flags anywhere |
| A5 | Nightshift serves Nemotron 3.5 Lightning and/or Nemotron 3 Ultra for us; the response names the model | Read Nightshift receipts; reported working for other builders |
| A6 | Nightshift **Web** edition works as a hotspot on Sam's Windows laptop (announced 25 Oct) | Mac runs all live LLM calls |
| A7 | At least 5 well-covered clean station-windows exist for the eval (Ghana, Kenya or elsewhere) | Smaller eval, stated honestly |

---

## 11. Known platform issues (from HackOS channels, 25 Oct)

- **Retired NVIDIA models:** Nemotron 3 Super 120B (free endpoint, returns 404) and Llama 3.3 Nemotron Super. Nemotron Super **VL** is not in Nightshift's list. **Working for others:** Nemotron 3.5 Lightning, Nemotron 3 Ultra. Current Nano id: `nvidia/nemotron-nano-3-30b-a3b`.
- **Lane routing:** one builder reports that `meterless/deep`, `meterless/fast` and `meterless/fusion` all route to `meterless/auto` and a single lane. **Pluvia uses one model route and logs what actually served each call.** It must not depend on two lanes.
- **Nightshift 1.2.3:** the "Reasoning budget" slider breaks Nemotron 3 Ultra calls. Leave it at default.
- Use `max_tokens` ≥ 500, or reasoning models can return empty content.
- Cursor is optional (official announcement, 22 Oct). The Help Cursor header still says required; that is stale.

---

## 12. Pre-existing components (declare in the submission form)

- Open-source libraries (npm). The Meterless H-MEM reference implementation (Apache 2.0) is vendored with attribution and extended.
- Zetaris getting-started recipe patterns (GHCN filestore, REST + SchemaStore view), used and adapted.
- **No pre-existing product code.** All Pluvia code is written during the build window.
