# Pluvia — Product Requirements

**Event** Open Agent Hackathon 2026 (GenAI Works, HackOS)
**Track** 03 — Reasoning Architecture: *turn data, knowledge, memory and reasoning into
reliable decisions and actions*
**Companion documents** `Architecture.md` for how it is built.

## 1. One line

**Pluvia checks whether the rain data behind a crop-insurance payout is telling the truth,
before any money moves.** It compares the ground weather station against an independent
satellite retrieval, catches broken and missing records, and decides pay, pay anyway, send
an inspector, or do not pay, with the evidence attached. It remembers each decision as a
precedent, so the next claim on the same station is decided consistently.

The station said drought. Its record was unfit to settle the claim.


## 2. The project from zero

**The insurance.** A group of maize farmers near Lagos buys *index insurance*: if the rain
gauge near the farm measures less than 150 mm between 1 July and 31 August, the policy pays
automatically. There is no inspector and no paperwork, which is what makes it cheap enough
for smallholders. The whole arrangement trusts one number: what the gauge says.

**What the real data shows.** For July 2025 at the Lagos reference station `NIM00065201`:

| Source | Days with data | Window total |
|---|---|---|
| Ground gauge | **10 of 31** | **6.1 mm** |
| Independent satellite retrieval, same coordinates | **31 of 31** | **131.7 mm** |

July is the middle of the rainy season. The station was not reporting, and the twenty-one
absent days are *missing*, not zero. A payout rule that sums what is present sees 6.1 mm,
declares a severe drought, and triggers a full payout without settleable evidence. The satellite total does not establish farm loss or prove that no drought occurred.

Worse, nine of the ten days the gauge did report read exactly 0.0 mm, and every one of
them carries a blank quality flag, meaning it passed every check the archive performs.
**A blank quality flag means a value was not impossible, not that it was true.** Zero
rainfall is always physically plausible, so published quality control cannot catch this.
That gap is the reason this system exists.

**An unfit rainfall record can look exactly like a drought.** The reverse also happens: a real loss is
refused because the named gauge, working perfectly, measured a storm forty kilometres away
that the farm never received.

**What Pluvia does before money moves.**

1. Reads the claim and finds the policy.
2. Gathers the station readings and the satellite retrieval through Zetaris.
3. Runs deterministic probes: days actually recorded, missing days being treated as zero,
   the two sources disagreeing, station distance, records ending early.
4. An AI reviewer studies the findings and may request more evidence, such as whether
   131.7 mm is normal for Lagos in July.
5. A strict rule engine — plain code, not a model — makes the final call.
6. It shows the officer everything: a chart with the missing days visible, each probe's
   result, and what a naive station-only trigger would have paid.
7. It remembers that the Lagos station was unreliable for the 2025 rainy season. The next
   claim against that station is flagged immediately.

**Real against invented.** The rainfall data and its failures are real. The farmer groups,
policies, claims and amounts are invented and labelled as synthetic throughout.


## 3. The problem

### 3.1 How index insurance works

Smallholder farmers increasingly buy cover that pays automatically when rainfall falls below
a trigger, with no loss adjuster visiting the farm. This keeps premiums low enough to be
affordable. The known weakness is **basis risk**: the index says something different from
what happened on the farm.

### 3.2 The failure nobody surfaces

Broken data looks like drought, and the industry's answer to basis risk is to redesign the
index rather than to audit a single claim.

A World Climate Research Programme briefing on African weather data reports that station
records in the main global dataset often run out over the most recent decade, and that some
feeds record missing days as zero rainfall. Both were confirmed against the live archives.

### 3.3 Who is harmed

| Person | Harm today |
|---|---|
| **Smallholder farmer** | Not paid during a real drought because the index was wrong, or the scheme collapses because it paid for droughts that never happened |
| **Claims officer** at a microinsurer, cooperative, NGO or agricultural lender | Cannot see why the index says what it says, has no time to audit station records by hand, and decides inconsistently between officers |
| **Insurer or reinsurer** | Pays false claims, loses confidence in the product, raises premiums |

The error is two-sided, and **the farmer-facing direction is the one nobody builds for.**
These schemes fail from distrust after wrongful refusals, not from fraud losses. Building
only the insurer's side produces a tool that refuses claims with confidence.

**Primary user for the demonstration:** a claims officer reviewing drought claims for
Nigerian farmer groups.


## 4. What Pluvia does

1. **Claim arrives.** The officer selects or submits a claim: group, policy, location,
   season, event. Free text is accepted — "the Kano group says the rains failed in July".
2. **Intake** turns free text into a structured claim and matches it to a policy.
3. **Planner** reads the policy terms, recalls precedents from memory, and writes a plan:
   which sources, which windows, which probes.
4. **Data** queries Zetaris for the policy register, the reference station's daily rainfall,
   and the satellite retrieval for the farm's coordinates.
5. **Auditor** runs the deterministic probes in §6.3 and explains the findings in plain
   language.
6. **Adjudicator** weighs the evidence and either proposes a decision with the index source
   it trusts, or requests more evidence, such as a neighbouring station, the same window in prior
   years or a shifted window, which returns to the Data step. At most two extra rounds.
7. **Before any refusal stands, the Adjudicator must state the strongest case for paying.**
   A refusal that was never argued against is invalid. This is what keeps the
   farmer-facing direction in the design rather than in the pitch.
8. **PolicyGate**, code and not a model, applies the contract and the guardrails: computes
   the index and the payout, and forces an inspection where data quality is insufficient,
   where the sources conflict beyond tolerance with no resolution, or where the result sits
   in the borderline band around the trigger.
9. **Reporter** produces a decision card and a plain-language letter: the outcome, the
   payout, the index used, every probe finding with its evidence, and what a naive
   station-only trigger would have done.
10. **Memory** stores a precedent, a station reliability lesson, and a conflict record
    between the two sources. The engine's conflict resolution auto-resolves only at or
    above 0.70 confidence and otherwise queues for human review. **That queue is the
    inspection outcome.**
11. **The next claim on the same station** recalls the lesson, goes straight to the right
    evidence, and needs no repair round. This is the memory demonstration.

### 4.1 The four outcomes

| Outcome | When |
|---|---|
| **Pay** | Trigger met and the record is sound |
| **Pay anyway** | Trigger not met, but the record is faulty in the direction that suppressed the payout, or the gauge is sound and measuring the wrong place. This re-evaluates the contractual trigger on a corrected record; it does not pay outside the contract |
| **Send an inspector** | Evidence conflicts, or quality is insufficient, or the result is borderline. A person goes, carrying the specific question to resolve |
| **Do not pay** | Never final. Routes to a human with the counter-case attached |

Two guarantees hold regardless of what any model proposes. **No refusal is reachable when
the satellite source is unavailable.** Missing evidence must not cost a farmer a payout.
And **no refusal is reachable on a station whose record is too incomplete to judge.**


## 5. Requirements

### 5.1 Must have

| ID | Requirement | Evidence for judges |
|---|---|---|
| M1 | **Zetaris is the data layer.** Station rainfall, satellite rainfall and the policy register are read through Zetaris. No agent reads object storage or the satellite API directly in live mode | Trace lines carrying the Zetaris SQL |
| M2 | **Nightshift is the primary AI provider**, serving an NVIDIA Nemotron model on every call | Per-call model name in the trace |
| M3 | **H-MEM in a working feature.** Precedents, station lessons and conflict records are written and recalled across sessions, and the official conformance suite passes against the build | Conformance output in the README, plus a second-session trace |
| M4 | **A real agent loop** — planner, auditor and adjudicator with visible handoffs, an evidence-request branch, and retries | Trace files |
| M5 | **Traces** as JSONL in `logs/` and on stdout, carrying agent, action, Zetaris SQL, probe results, memory reads and writes, and the model per request | `logs/` |
| M6 | **`SAMPLE_MODE=true`** runs the real agent logic on cached data with Zetaris, Nightshift and all credentials absent | Fresh-clone test |
| M7 | **Programmatic entry point** — `POST /run`, JSON in and JSON out, plus a command-line interface | README |
| M8 | **At least three sample inputs with their real outputs** | `input_examples/`, `output_examples/` |
| M9 | Public repository, README, `.env.example` with placeholders only, and no secrets anywhere — repository, video, deck or logs | Secret scan |
| M10 | Demo video of one to four minutes, slide deck covering the eight required points, sponsor technology explanation | Submission form |
| M11 | **Honesty labels.** Policies and claims are synthetic and say so; rainfall data is real and says so | README and interface footer |

### 5.2 Should have

| ID | Requirement |
|---|---|
| S1 | **The headline evaluation** in §7: wrong-payout rate for a naive station trigger, satellite only, a model given raw totals, and Pluvia, across a labelled case set |
| S2 | **Interface:** claim inbox; claim page with a daily rainfall chart showing station against satellite with missing days highlighted; probe findings; decision card; a panel showing what a naive trigger would have done; trace timeline; memory panel |
| S3 | **Memory across sessions:** the first claim on a station needs an evidence-request round, the second needs none |
| S4 | **Nemotron visibly carries the reasoning** — intake, planning, adjudication, explanation — with the model logged on every call |
| S5 | A container image whose build reaches Zetaris and Nightshift on the host |
| S6 | A sponsor-use description file at the repository root |

### 5.3 Could have

- A second engine holding farms, stations, policies and their distances as linked entities.
- Ghana and Kenya stations alongside Nigeria.
- A portfolio view: every claim for a season, and how many naive payouts were blocked or
  rescued.
- The **learned-bias detector** described in §6.4, which is a second tier rather than a
  requirement and only works where records are dense.

### 5.4 Out of scope

- Real policyholder data. Every policyholder is synthetic.
- Real payments, mobile money or settlement.
- Weather forecasting and crop-yield modelling.
- Pricing or underwriting new policies.
- Additional memory engines. One engine done properly beats four done badly.


## 6. Domain model and rules

### 6.1 Policy, synthetic and labelled as such

| Field | Example |
|---|---|
| `policy_id` | `POL-LAG-2025-014` |
| `group_name` | Ikorodu Maize Cooperative (synthetic) |
| `crop` | maize |
| `farm_lat`, `farm_lon` | 6.60, 3.35 |
| `ref_station_id` | `NIM00065201` |
| `window_start`, `window_end` | 2025-07-01, 2025-08-31 |
| `trigger_mm` | cumulative rainfall below which the policy pays |
| `exit_mm` | rainfall at or below which the maximum payout applies |
| `sum_insured_ngn` | per group |
| `borderline_band_mm` | band around the trigger that forces an inspection |
| `min_coverage` | minimum share of window days carrying valid data |
| `max_station_km` | maximum farm-to-station distance for the station to be the sole index |

**Payout rule**, linear and standard for index insurance: at or above `trigger_mm`, nothing;
at or below `exit_mm`, the full sum insured; between the two, proportional.

Trigger values are computed per region from the satellite climatology of prior years by a
documented script. They are not chosen by hand.

### 6.2 Claim

`claim_id`, `policy_id`, `submitted_at`, `event_text` as free text, and an optional window
override.

### 6.3 Probes — deterministic and unit-tested

| ID | Probe | Rule | Why |
|---|---|---|---|
| **P1** | Station coverage | valid station days ÷ window days below `min_coverage` fails | Nigerian stations in this archive report between two and sixty-four days a year |
| **P2** | Missing treated as zero | count days a naive sum would read as zero, and reported zeros on days the satellite shows 5 mm or more | Documented in the feeds themselves |
| **P3** | Quality and measurement flags | exclude rows with a non-empty quality flag; count and report the measurement and source flags | Flags mark failed checks and data provenance |
| **P4** | Record ends early | last valid station date more than three days before the window end fails | Records run out |
| **P5** | Station distance | farm-to-station distance above `max_station_km` warns and bars the station as sole index | Distant gauges measure different weather |
| **P6** | Source divergence | on days both sources carry data, compare totals; a large relative or absolute gap fails | The two sources genuinely disagree |
| **P7** | Satellite fill values | exclude the documented fill value; more than three in a window warns | The retrieval has gaps of its own |
| **P8** | Borderline | an index within the borderline band of the trigger forces an inspection | Too close to call automatically |

**P2 carries a caveat that must survive into the submission.** The suspect runs of zeros
cluster in 2002 to 2005 across Brazil, Kenya, South Africa and Tanzania. Gauges do not fail
simultaneously on three continents, so the likely cause is an archive ingest fault — missing
values written as zero at scale, rather than blocked funnels. **Do not claim to detect
broken instruments.** What is demonstrably caught is a record unfit to settle a claim, which
is the thing that matters and is the stronger claim anyway, because a systemic archive fault
affects every policy written against that archive rather than one farm.

### 6.4 Second-tier detector, where records allow it

Where a station has a dense record, disagreement can be judged against *that station's own
historical distribution of disagreement* rather than an absolute threshold. A point gauge
and a gridded area average disagree constantly and legitimately, so an absolute threshold
fires on nearly every claim.

Measured behaviour across four well-covered stations: gauge-to-satellite correlation runs
0.30 to 0.37 daily and 0.58 to 0.80 over ten-day periods, so ten days is the smallest usable
unit. A station's bias distribution settles after roughly eight years of overlapping record
and fifty ten-day blocks. Thresholds are each station's own 95th and 99th percentile absolute
bias rather than a normal-curve score, because the distributions are heavy-tailed.

This is explicitly **not** the primary mechanism. It needs years of overlap that the target
country does not have, where P1 and P2 catch the same failures with no history at all.

### 6.5 Decision rules — PolicyGate, in code

The Adjudicator proposes. The PolicyGate disposes. No model can move money on its own, and a
failed probe can only be cleared by new evidence that passes the probes.

1. Station passes P1 to P4 and P6. The station is the index, because it is the contract's
   reference.
2. Station fails P1, P2 or P4 while the satellite passes P7. The satellite becomes the
   index, but only where the Adjudicator cites the failed probes. Where this produces a
   payout the station would have refused, the outcome is recorded as **pay anyway** and the
   reason is stated.
3. Both sources fail, or P6 fails with nothing resolving it after the permitted rounds:
   inspection.
4. P8 borderline: inspection, whichever source is used.
5. A memory conflict left unresolved below 0.70 confidence: inspection.
6. Otherwise apply the payout rule.


## 7. Evaluation

No ground truth exists for what really happened on the farm, so the method is fault
injection on real data alongside real Nigerian cases.

1. **Clean reference series.** Real station-windows with high coverage and close satellite
   agreement. Eight candidates are confirmed by measurement in §8.
2. For each, compute the decision from the clean data, then produce labelled variants with
   known injected faults: drop days, replace missing with zeros, truncate the record, shift
   it by three days, substitute a distant station.
3. **A true negative is included deliberately.** Dodoma `TZ000063862` carries a 175-day run
   of zeros that the satellite independently corroborates at 11.8 mm total with no day above
   10 mm. It is a genuine dry spell, and a detector that fires on it is wrong. Any evaluation
   built only from faults measures the wrong thing.
4. **Real Nigerian cases** for 2024 and 2025, labelled from documented coverage facts alone
   and never from the system's own output.
5. **Four deciders compared:** naive station trigger, satellite only, a model given raw
   totals, and Pluvia.
6. **Metrics:** wrong payouts, missed payouts, inspection rate, mean time per claim.

Target twenty or more cases. Report whatever is measured. The script and the case files ship
in the repository so the result can be re-run.


## 8. Verified facts

Measured against the live archives on 25 and 26 October 2026.

### 8.1 The data

| Fact | How |
|---|---|
| Nigeria has **ten** stations carrying rainfall in this archive, of which eight are usable. The whole national record is roughly **2,050 station-days across 52 years**. Lagos `NIM00065201` is 5.3 per cent complete across its lifetime and 10.8 per cent since 2001; Makurdi holds nine days in total; Enugu holds one year | Filtered the inventory, then counted every station's rows |
| Lagos July 2025: gauge **10 of 31 days, 6.1 mm**, with nine of the ten reported days reading exactly 0.0 and every one carrying a blank quality flag. Satellite **31 of 31 days, 131.7 mm**, no fill values | Both fetched directly |
| Lagos reported 44 days in all of 2025. Kano `NIM00065046` reported 5 days in 2024 | Counted |
| Precipitation in this archive is recorded in **tenths of a millimetre** | Archive readme |
| Measurement flag `A` marks a multi-day accumulation; `B` and `D` mark twelve- and six-hour parts; companion fields carry the multi-day total and its day count. A blank quality flag means the value passed every check | Archive readme |
| Station completeness must be measured over the **satellite-overlap era, not the lifetime**. One station measures 73 per cent complete across its full record and 10 per cent since 2001 | Measured both ways |
| **Eight clean station-windows** for the evaluation, by satellite-era coverage: Maceió 65%, São Paulo 62%, Teresina 56%, Kitale 54%, Dar es Salaam 43%, Zanzibar 42%, Mombasa 42%, Mwanza 40% | Measured per station |
| A definitive unfit-record case: Teresina `BR037041370`, **534 consecutive reported zero observations** from 2 June 2002 to 21 July 2005, spanning 1,146 calendar days with 612 absent station days. Satellite rainfall on those reported dates totalled 379.2 mm, including one day at 42.8 mm | Measured |
| A true-negative case: Dodoma `TZ000063862`, a 175-day run of zeros the satellite corroborates | Measured |

### 8.2 Two traps, already paid for

| Trap | Detail |
|---|---|
| **Country codes** | The archive's `NG` is **Niger**. Nigeria is `NI`. Latitudes near 18°N give the mistake away |
| **The satellite series** | The obvious precipitation field is **bias-corrected using gauge observations**, which makes any gauge-against-satellite comparison partly circular. The independent retrieval must be used instead, and it returns the fill value for every day unless the request also sets the UTC time standard. For the same Lagos window the two differ materially: 131.7 mm independent against 109.5 mm corrected |

### 8.3 The platform, verified on the build machine

| Fact | Detail |
|---|---|
| Zetaris | Running, **nine of nine verification checks pass**. Login and a full query path through interface, API, driver and engine all confirmed |
| Services | The default set is exactly `init postgres driver api bootstrap ui`. A reverse proxy exists in the compose file but is profile-gated and does not start |
| Ports | Interface 3000, API 8888 and 8889, driver 10000 and 4040. No conflict with the AI gateway's 8088 |
| Images | Driver 8.45 GB, API 982 MB, interface 316 MB — about 9.75 GB on disk |
| Configuration | The bundle ships its environment file already populated. Its own notes say nothing needs configuring, which contradicts the longer setup guide; the bundle is authoritative. The admin password should be checked against the complexity rule before the first start, because a rejection does not surface until several minutes in |
| Container runtime | A runtime with native Rosetta support works and is the fast path. A second Docker runtime must not be installed alongside it, because they contend for the same socket |

### 8.4 Open assumptions

Each has a fallback and none blocks the build.

| # | Assumption | Fallback |
|---|---|---|
| A1 | Zetaris registers a per-station CSV with a header row | Use the verified per-year table and filter by station |
| A2 | Zetaris registers the satellite API as a REST table and decodes its date-keyed response | Register committed snapshots through the same pattern from a public URL; data still flows through Zetaris and the README states the snapshot date |
| A3 | Zetaris registers the policy register from a public raw URL | Cache it in Zetaris from a different public host |
| A4 | The AI gateway serves the intended Nemotron models and names the model in the response | Read the gateway receipts; swap model |


## 9. Success metrics

| Metric | Target |
|---|---|
| The Lagos July 2025 case is caught — naive trigger pays, Pluvia does not pay blindly | Repeatable, live and in sample mode |
| Wrong-payout rate on the evaluation set | Below all three baselines, reported honestly |
| The true negative at Dodoma raises no finding | No false positive |
| Memory | Second claim on a station needs no evidence-request round where the first needed at least one |
| Run time per claim | Under two minutes live, under twenty seconds in sample mode |
| Fresh clone | Someone who has not touched the repository follows the README without asking a question |


## 10. How it earns the rubric

| Criterion | Points | How |
|---|---|---|
| Impact | 30 | Real farmers and real money, a documented industry problem, and a failure verified against real 2025 Nigerian data. Track 03's four nouns all carry weight, and the output is an action rather than an answer |
| Technical | 20 | Two genuinely disagreeing sources federated in one query layer, deterministic probes, a code-enforced decision gate, a bounded evidence-request loop, a measured evaluation with a true negative, and full traces |
| Innovation | 15 | Treats data quality as part of the claim decision, and uses the memory engine's own conflict resolution and human-review queue as the inspection mechanism |
| Demo | 15 | One chart: ten grey missing bars against a satellite line. A naive trigger pays. Pluvia sends an inspector |
| Product and UX | 10 | A decision card a claims officer can act on, and a plain-language letter |
| Sponsor technology | 10 | Zetaris joins object-storage CSV, a REST satellite API and the policy register in one SQL surface; H-MEM holds precedents and conflicts; Nemotron reasons; every call goes through Nightshift |


## 11. Prior art

| Prior art | What it does | How Pluvia differs |
|---|---|---|
| Parametric insurers | Automate payouts from an index | Pluvia audits whether the index data itself can be trusted for this claim, and explains why |
| Generic agricultural-insurance automation platforms | Workflow automation | No source-against-source data-quality adjudication found |
| The research literature on basis risk | Measures and reduces it by redesigning the index | Pluvia decides an individual claim under the index that already exists. One review argues the index should be measured transparently by a neutral third party, which is an argument for this product's existence |

**Honest weakness.** A judge may ask whether this is a real insurer's workflow. The decision structure of index,
trigger, exit, payout and basis risk is standard. The policies are
synthetic and labelled. The rainfall data and its failures are real.


## 12. Pre-existing components

To declare on the submission form:

- Open-source libraries.
- The Meterless H-MEM reference implementation, vendored with attribution and extended.
- Zetaris getting-started recipe patterns, used and adapted.
- **No pre-existing product code.** All Pluvia code is written inside the build window.
