# Pluvia

Pluvia adjudicates the rainfall record behind a crop-insurance claim before any money moves.

A weather-index policy pays out when rainfall over a growing window falls below a threshold,
measured at one named gauge. No inspector visits. That number is the contract, and nothing in
the contract tests the instrument that produced it.

Two things follow. A blocked gauge reporting zeros invents a drought and triggers a payout
nobody was owed. A working gauge forty kilometres from the farm measures a storm the farm never
got, and a real loss is refused with no route to argue. The second failure is the one that ends
schemes, because they collapse from distrust after wrongful denials rather than from fraud.

Pluvia investigates the record four independent ways, argues against its own conclusion on the
farmer's behalf, and returns one of four decisions with the evidence attached.

## How it decides

Four investigations run independently. No stream's output feeds another, which is what makes
four findings evidence rather than one conclusion restated.

| Stream | Catches | Needs |
|---|---|---|
| Integrity | The impossible and the structurally odd | The record alone |
| Cross-source | The plausible lie | A learned model of this gauge's normal disagreement |
| Spatial | The honest but irrelevant gauge | Satellite over the farm against satellite over the gauge |
| Peer gauge | A broken instrument, with no satellite involved | A second independent ground station nearby |

An adjudicator proposes a decision. A challenger is then required to contest every proposed
refusal and to attempt the farmer's case; a refusal nothing contested is invalid. Each
adjudication writes a standing determination about that gauge, so the next claim is decided
consistently or departs from precedent with a stated reason.

### The four outcomes

- **Pay** — the trigger was met and the record is sound.
- **Pay anyway** — the trigger was not met, but the record is faulty in the direction that
  suppressed the payout, or the gauge is sound and measuring the wrong place. This re-evaluates
  the contractual trigger on a corrected record; it does not pay outside the contract.
- **Hold for inspection** — the evidence conflicts. A person goes, carrying the specific
  question to resolve.
- **Do not pay, with recourse** — never final. It routes to a human with the strongest
  counter-case already written.

If the satellite source cannot be reached, Pluvia may approve or hold but may never refuse.
Missing evidence must not cost a farmer a payout.

## Why disagreement alone proves nothing

A gauge measures one point. A satellite estimates an area average about five kilometres across.
They disagree constantly and legitimately, so flagging disagreement flags every claim.

Pluvia compares a claim's disagreement against **that station's own historical distribution of
disagreement**, learned across its full overlapping record and held in memory. A sixty-millimetre
gap is unremarkable at one gauge and a severe anomaly at another. The remembered profile is the
detector; without it there is nothing to measure against.

Published quality control does not cover this. It marks values that are impossible. A blocked
gauge reporting 0.0 mm passes every such check, because zero is always physically plausible —
and a plausible wrong number is the one that moves money.

## Evidence

Figures below were measured on 2026-10-26 against the live public archives, not assumed.

| Station | What the record shows |
|---|---|
| Teresina, Piauí, Brazil | **534 consecutive days of exactly 0.0 mm** from June 2002, while the independent satellite recorded **379 mm** over the same days, including one day at 42.8 mm |
| Kitale, Kenya | Effectively unbiased at **−0.26 mm** mean ten-day bias over 461 blocks. Its one long dry run is twenty days the satellite confirms |
| Dodoma, Tanzania | A **175-day run of zeros the satellite corroborates** — 11.8 mm total, no day above 10 mm. A long dry spell that is genuine |

The third case is the important one: a long run of zeros is not by itself a finding.

Measured thresholds behind the method: gauge-to-satellite correlation runs 0.30–0.37 daily and
0.58–0.80 over ten-day periods, so ten days is the smallest usable unit. A station's bias
profile settles after roughly eight years of overlapping record. Anomaly is judged against each
station's own 95th and 99th percentile absolute bias rather than a normal-curve threshold,
because the distributions are heavy-tailed.

## Data

All inputs are free and public. No API key is required for either rainfall source.

- **Ground stations** — GHCN-Daily, tens of thousands of stations, carrying the measurement and
  quality flags the integrity stream reads. Precipitation is recorded in tenths of a millimetre.
- **Synoptic stations** — the global hourly surface database and its daily summaries, for the
  peer-gauge comparison.
- **Satellite** — the IMERG retrieval via NASA POWER. Deliberately **not** the bias-corrected
  series, which is adjusted using the gauge observations under test and would make the
  comparison circular.
- **Policies and claims** are synthetic. No insurer publishes claims, and that is the only
  fabricated part.

## Status

Specification and technical plan are complete. Implementation has not started. This README
describes what is being built and the measurements it rests on.

## Licence

MIT.
