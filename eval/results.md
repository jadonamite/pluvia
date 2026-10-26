# Evaluation results

45 cases. Unmeasured: Nightshift is not configured for this run. No model score is claimed.

Inspections are abstentions and are reported separately from correct decisions. The two real Nigerian cases and the incomplete Dodoma record have unknown payout truth and are excluded from wrong/missed payout denominators. Rates use all 42 labelled cases as the denominator; inspections never count as correct decisions. Pluvia runs the full bounded Orchestrator, real DuckDB query path, probes, PolicyGate and isolated persistent H-MEM per case. With Nightshift unavailable, its model steps use the explicitly labelled sample-rules adapter. Fresh memory prevents cross-case leakage.

| Decider | Cases run | Wrong payouts | Missed payouts | Inspections |
|---|---:|---:|---:|---:|
| naive_station | 45 | 5 | 0 | 0 |
| satellite_only | 45 | 0 | 0 | 0 |
| raw_totals_model | unmeasured | unmeasured | unmeasured | unmeasured |
| pluvia | 45 | 0 | 0 | 26 |

Across all 45 evaluation cases, the verdicts are NO_PAY: 14, INSPECT: 26, PAY: 5, and PAY_ANYWAY: 0. Across all 1,440 historical calendar-month candidate windows in the public archive, no qualifying measured window produces PAY_ANYWAY: whenever station and satellite series agree within contractual divergence limits (P6 relative gap <= 40% and absolute gap <= 50 mm), separating the two across the 70% drought trigger while keeping the satellite index outside the +-5 mm borderline band (P8) does not occur. The distant-station fault variants either agree on refusal (6 cases) or payout (1 case), or fail coverage and force inspection. The PAY_ANYWAY gate mechanism is verified in unit tests (tests/policyGate.test.ts); no synthetic or manufactured window has been substituted into the evaluation.

The recovered Dodoma record has 175 reported zeros across 231 calendar days. Matched satellite dates total 11.85 mm with no day at or above 5 mm. The zero-suspicion check therefore passes. The 56 absent station days still trigger missingness findings, and the fixed relative-divergence rule also fails. These findings do not diagnose an instrument fault. A complete-calendar-window no-findings acceptance fixture has not been recovered. See data/dodoma-zero-run.json.
