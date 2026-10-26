# Evaluation results

46 cases. Unmeasured: Nightshift is not configured for this run. No model score is claimed.

Inspections are abstentions. Payout error rates use 43 cases with known contractual payout labels; sparse Nigerian and incomplete Dodoma records have unknown payout truth. The full bounded Orchestrator uses DuckDB, probes, PolicyGate and isolated H-MEM for each case. Its model steps use sample-rules unless EVAL_PLUVIA_LIVE=true; the raw-totals baseline uses the live model whenever Nightshift is configured.

| Decider | Cases run | Wrong payouts | Missed payouts | Inspections |
|---|---:|---:|---:|---:|
| naive_station | 46 | 5 | 1 | 0 |
| satellite_only | 46 | 0 | 0 | 0 |
| raw_totals_model | unmeasured | unmeasured | unmeasured | unmeasured |
| pluvia | 46 | 0 | 0 | 26 |

Pluvia verdict counts: {"NO_PAY":14,"INSPECT":26,"PAY":5,"PAY_ANYWAY":1}. These measurements do not establish a production inspection rate or what every human officer would decide.

## Measured Kitale window

The 2021-08-15 through 2021-09-14 window is not a calendar month. Its real gauge total is 147.3 mm over 30 of 31 days; the complete independent satellite total is 128.0 mm. Ten complete prior-year windows calibrate the synthetic trigger to 139.2 mm and exit to 59.7 mm. The station-only trigger refuses while the satellite supports a payout. Only distance metadata is injected (station latitude +1 degree); the satellite and farm retain the requested 1.016,35 point. This is measured rainfall with a synthetic distance assumption, not proof of a distant farm's loss. Case result: PAY_ANYWAY, payout NGN 14088.05. P1 passes at 96.8% coverage; P2 fails on four reported zeros with satellite rainfall at least 5 mm, so this is not a verified healthy gauge. P5 warns at the synthetic 111.2 km distance. P6 passes at 18.8% overlap divergence, P7 has no gaps and P8 passes at 11.2 mm from trigger. Monthly-only selection missed this window; policies and probes have no first-of-month requirement.

## Dodoma limitation

The recovered record has 175 reported zeros across 231 calendar days, with 56 absent station days. Matched satellite dates total 11.85 mm and none reach 5 mm, so suspect-zero detection does not fire. Missingness and the fixed relative-divergence rule still fail. The complete-window no-findings requirement remains unresolved. These findings do not diagnose an instrument fault.
