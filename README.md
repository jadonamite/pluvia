# Pluvia

Pluvia checks whether the rain data behind a crop-insurance payout is telling the truth,
before any money moves.

A weather-index policy pays out automatically when rainfall over a growing window falls below
a threshold, measured at one named gauge. No inspector visits. That number is the contract,
and nothing in the contract tests the instrument that produced it.

## The failure

For July 2025 at the Lagos reference station `NIM00065201`:

| Source | Days with data | Window total |
|---|---|---|
| Ground gauge | **10 of 31** | **6.1 mm** |
| Independent satellite retrieval, same coordinates | **31 of 31** | **131.7 mm** |

July is the middle of the rainy season. The station was not reporting, and the twenty-one
absent days are *missing*, not zero. A payout rule that sums what is present sees 6.1 mm,
declares a severe drought, and pays in full for a drought that never happened.

Nine of the ten days the gauge did report read exactly 0.0 mm, and every one carries a blank
quality flag, meaning it passed every check the archive performs. A blank quality flag means
a value was not impossible, not that it was true. Zero rainfall is always physically
plausible, so published quality control cannot reach this. That gap is why Pluvia exists.

The reverse failure matters more. A gauge working perfectly, forty kilometres away, measures
a storm the farm never received, and a real loss is refused with no route to argue. Index
schemes collapse from distrust after wrongful refusals, not from fraud losses.

## What it does

Pluvia runs deterministic probes over both sources, has a model reason about what they mean,
and then lets plain code make the call. The model proposes. The code disposes.

| Probe | Catches |
|---|---|
| Station coverage | A gauge that barely reported during the window |
| Missing treated as zero | Absent days silently summed as no-rain |
| Quality and measurement flags | Values the archive itself marks as suspect or accumulated |
| Record ends early | A record that runs out before the window closes |
| Station distance | A gauge too far from the farm to be the sole index |
| Source divergence | Two sources that disagree beyond tolerance |
| Satellite fill values | Gaps in the satellite retrieval |
| Borderline | A result too close to the trigger to call automatically |

### The four outcomes

- **Pay.** The trigger was met and the record is sound.
- **Pay anyway.** The trigger was not met, but the record is faulty in the direction that
  suppressed the payout, or the gauge is sound and measuring the wrong place. This
  re-evaluates the contractual trigger on a corrected record. It does not pay outside the
  contract.
- **Send an inspector.** The evidence conflicts. A person goes, carrying the specific
  question to resolve.
- **Do not pay.** Never final. It routes to a human with the counter-case attached.

Two guarantees hold whatever a model proposes. No refusal is reachable when the satellite
source is unavailable, because missing evidence must not cost a farmer a payout. And no
refusal is reachable on a station whose record is too incomplete to judge.

Every adjudication is remembered: a precedent, a station reliability lesson, and a record of
the conflict between the two sources. The next claim on the same station is decided
consistently, and a conflict the memory cannot resolve confidently becomes an inspection.

## Data

All rainfall inputs are free and public, and neither source needs an API key.

- **Ground stations.** GHCN-Daily, carrying the measurement and quality flags the probes
  read. Precipitation is recorded in tenths of a millimetre.
- **Satellite.** The IMERG retrieval through NASA POWER. Deliberately **not** the
  bias-corrected series, which is adjusted using gauge observations and would make a
  gauge-against-satellite comparison partly circular. For the Lagos window above the two
  differ materially: 131.7 mm independent against 109.5 mm corrected.
- **Policies and claims are synthetic** and labelled as such throughout. No insurer
  publishes claims, and that is the only invented part.

Everything is read through Zetaris as the single query surface. No agent reads object storage
or the satellite API directly in live mode.

## Limitations

Stated here rather than left for a reader to find.

- **Pluvia catches an untrustworthy record, not a broken instrument.** The suspect runs of
  zeros in this archive cluster between 2002 and 2005 across Brazil, Kenya, South Africa and
  Tanzania. Gauges do not fail simultaneously on three continents, so the likely cause is an
  archive ingest fault rather than blocked funnels. Either way the record cannot settle a
  claim, which is the thing that matters.
- **It needs two independent measurements of the same rain.** Where a contract uses the
  satellite itself as the official index and no ground station is in range, there is nothing
  to compare.
- **Ground coverage is thin where the problem bites hardest.** Nigeria has ten stations
  carrying rainfall in this archive, roughly 2,050 station-days across 52 years. That
  sparseness is why index insurance moved to satellite triggers, and it is also why coverage
  probes rather than long-run statistics are the primary detector here.
- **Policies, claims and payout amounts are invented.** The rainfall data and its failures
  are real.
- Pluvia does not forecast weather, model crop yields, price policies or move money.

## Documents

- [`PRD.md`](PRD.md) — what it does and why, the probe rules, the evaluation method, and the
  measured facts behind all of it.
- [`Architecture.md`](Architecture.md) — how it is built: stack, repository layout, agent
  contracts, the data-layer registrations, and the failure modes.

## Status

Specification, product requirements and architecture are complete. The data layer is running
and verified. Implementation has not started. This README describes what is being built and
the measurements it rests on.

## Licence

MIT. See [LICENSE](LICENSE).
