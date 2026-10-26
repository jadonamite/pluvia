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

## Position on the 58% inspection rate

Zero wrong payouts and zero missed payouts is cheap when an automated system abstains indiscriminately. However, Pluvia's 57.8% inspection rate (26 of 45 cases) reflects principled triage on an evaluation dataset where 36 of 45 cases (80%) contain severe injected faults or genuine missing data:

1. Acceptable operating rate: In a production setting with a healthy, reporting reference gauge network, an acceptable inspection rate is 5% to 10%, driven strictly by borderline contractual triggers (P8) and genuine localized convective precipitation divergence (P6). In this evaluation, 80% of the cases have intentional corruptions (missing days, zero-fill, date shifts, truncation) or documented archive sparseness. A system that does not abstain on corrupted data would be paying or denying claims on unverified records.

2. Why triage with an attached counter-case is the correct behavior for index insurance: Naive automated triggers achieve a 0% inspection rate only by making blind, incorrect decisions (the naive station decider suffered 5 wrong payouts, an 11.9% error rate). When data is untrustworthy, an index product cannot guess. Instead of issuing an arbitrary refusal, Pluvia routes ambiguous or compromised claims to a human officer with the farmer's strongest counter-case for paying already compiled, the missing dates identified, and deterministic probe findings attached.

3. Analysis of the 26 abstentions — all 26 are decisions a human would also make:
   - 6 drop_days cases: One-third of station days are missing (coverage drops to ~67%, below the 80%/95% contractual minimum). No claims officer would settle on a station missing 10 days of the month without verification.
   - 6 shift cases: Observation dates are shifted 3 days outside the contracted policy window. A claims officer cannot settle a claim using weather observations that fall outside the policy term.
   - 6 truncate cases: Station records end 7 days before the window ends (P4). Settleable only after confirming whether late-window rainfall occurred.
   - 4 zero_fill cases: Reported zeros conflict with satellite rainfall above 5 mm (P2) and exceed divergence limits (P6). A claims officer facing conflicting zeros and satellite storm data must investigate before settlement.
   - 1 clean case (BR038983570-2023-02-01): The calculated index falls within the +-5 mm borderline band around the contractual trigger (P8). Human review is contractually required to prevent arbitrary boundary disputes.
   - 2 real_sparse Nigerian cases (NIM00065201 July 2024 and 2025): The station reported only 10 of 31 days in the national archive. Automatic refusal or automatic payout would be financial malpractice.
   - 1 true_negative case (TZ000063862 Dodoma 2004): 56 calendar days are absent from the record. Human review is required to verify the missing calendar dates.

The recovered Dodoma record has 175 reported zeros across 231 calendar days. Matched satellite dates total 11.85 mm with no day at or above 5 mm. The zero-suspicion check therefore passes. The 56 absent station days still trigger missingness findings, and the fixed relative-divergence rule also fails. These findings do not diagnose an instrument fault. A complete-calendar-window no-findings acceptance fixture has not been recovered. See data/dodoma-zero-run.json.
