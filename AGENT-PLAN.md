# Pluvia as an agent: the full plan

Written 27 October 2026 against commit `f843100`. Each phase ends in a test that can be watched
passing; a phase is not done until that test passes.

Where it stands on 27 October 2026: phases 0 to 3 and 6 are built, phase 5 is built apart from
the Queue view, phase 7 has its agent story with the watcher scene still to come, and phase 4 is
the next piece of work. Each phase below says so under its heading.

Replaces `ai-reasoning-plan.md`, which made the model's opinion count inside the existing fixed
pipeline. This plan replaces the pipeline.

## What Pluvia becomes

A claims agent. Given a crop-insurance claim, it runs its own investigation, decides what the
rainfall record supports, and then carries the claim to the end: it opens inspections, holds or
releases payment, writes to the farmer group, tells the station operator about a failing gauge,
reads the inspector's report when it comes back, and closes the claim. A person signs off where
money is refused or released in large amounts. Between claims, it watches every insured station
and opens a case the day a gauge goes quiet, before anyone files a claim.

The person it serves is the claims officer. Today they reconcile rainfall records by hand for
every claim and chase inspections by email. With Pluvia they read a finished case and sign.

## Words used in this plan

- **Agent loop.** The model is given a goal and a set of tools. Each turn it picks one tool, the
  code runs it, and the result goes back to the model. It repeats until the model finishes the
  case or runs out of its step budget.
- **Tool.** One thing the agent can do, such as run a SQL query or open an inspection. Tools are
  plain code; the model only chooses which to call and with what.
- **Gate.** `app/agents/policyGate.ts`, the only code allowed to produce a payout figure. It stays
  the final word on money.
- **Case.** One claim's record of everything the agent did: queries, findings, actions, sign-offs,
  letters. It lives in Pluvia's own database.
- **Sign-off.** A step where the agent stops and a person approves before the action happens.
- **Replay.** A saved live run that can be played back without Nightshift or Zetaris. Replays
  are always labelled as replays.

## What stays exactly as it is

- The gate's three guarantees and their tests: no refusal without complete satellite data, no
  refusal on a gauge below the coverage minimum, and every refusal carries the strongest case
  for paying.
- The borderline rule (P8) and the rule that no model raises a payout above what the contract
  allows.
- The vendored H-MEM code, passing 13 of 13 on the official conformance runner.
- Honest labelling of anything cached, replayed or rule-made.
- The front page's look and camera journey, and the desk's tabs-and-sheets design.

## Sign-off rules

A person approves before any of these happen:

| Action | Why |
|---|---|
| Any refusal (Do not pay) | A wrong refusal leaves a farmer without money in a drought |
| Closing an inspection | The inspector's report is free text; a person confirms the agent read it right |
| Any payout above ₦1,000,000 | Proposed threshold, 40% of the largest synthetic sum insured (₦2,500,000). Kitale's ₦14,088.05 releases without a person |

Everything else the agent does on its own and records in the case: opening inspections, drafting
letters, notifying operators, holding payment, and releasing payouts at or under the threshold.

---

## Phase 0. Groundwork and choosing the model

**Built.** Nemotron 3 Ultra chosen on three live Zetaris tasks; the trial is in `workbench/model-trial.md`.

**Why first.** The model has to write correct SQL and choose tools well across ten or more steps.
Picking it by guess risks building the whole agent around one that cannot do the job.

**Do.**
1. Nightshift lists 56 routes (read 27 October 2026): six Meterless routing modes, five NVIDIA
   routes, 37 OpenRouter models and eight on-device models. Most cloud routes are marked
   "availability: unverified" by Nightshift itself, so each candidate is called before it is
   trusted. Candidates for the trial:

   | Route | Why it is a candidate | Listed price per million tokens (in / out) |
   |---|---|---|
   | `nvidia/nemotron-3-ultra-550b-a55b` | Largest Nemotron, keeps the NVIDIA award path | $0 / $0 through NVIDIA |
   | `openrouter/nvidia/nemotron-3-super-120b-a12b:free` | Mid-size Nemotron | $0 / $0 |
   | `nvidia/nemotron-3.5-bolt-e4b` | Small and fast, for routine steps | $0 / $0 through NVIDIA |
   | `openrouter/openai/gpt-5.6-luna` | Strong and cheap control, to see what Nemotron is up against | $0.20 / $1.20 |
   | `openrouter/deepseek/deepseek-v4.1-flash` | Cheap control | $0.15 / listed |
   | `meterless/deep` | Nightshift's own routing for heavy work | varies by lane |

   `nvidia/nemotron-3.5-lightning-30b-a3b` stays out: the handover records it returning empty
   responses on this build. Using Nemotron for the agent's decisions keeps the NVIDIA award
   requirement (Nemotron in a working feature, with per-request model logging) met by the core
   of the product, not a side call.
2. Check that Nightshift passes tool definitions through to the model (the OpenAI-compatible
   `tools` field). If it does not, the agent uses the JSON action format Pluvia already parses
   in `app/agents/modelJson.ts`.
3. Restore live Zetaris on this machine: the API key is blank in this checkout's `.env`, and the
   AWS container and SSH tunnel must be up.
4. Run a trial of each candidate model on three fixed tasks against the real Lagos data in
   Zetaris: write a query for the July 2025 gauge days, find the days the gauge was silent, and
   compare July 2025 satellite rainfall with prior Julys. Score each on correct SQL on first try,
   correct SQL after one error message, right tool chosen, steps taken, cost and time.
5. Confirm whether Zetaris can give Pluvia a read-only user. If it cannot, the SQL guard in
   phase 1 is the only protection, and the plan says so.

**Done when.** A table in `workbench/model-trial.md` names the chosen model (or a pair: a stronger
one for planning, a cheaper one for routine steps) with its measured scores, and Pluvia runs one
live query through Zetaris from this machine.

## Phase 1. The case store, the tools and the SQL guard

**Built.** `app/agent/cases.ts`, `app/agent/sqlGuard.ts` and the tools in `app/agent/caseAgent.ts`, each tested.

No agent yet. Every tool is built and tested on its own first.

**The case store.** Tables in Pluvia's own DuckDB file: cases, case events, inspections, outbox
messages, sign-off requests, station watch state. A case moves through fixed states:

```
open → investigating → proposed → awaiting sign-off → settled → closed
                    ↘ inspection open → report received → investigating
                    ↘ escalated to a person
```

Only code moves a case between states; the agent asks through tools.

**The tools.**

| Tool | What it does |
|---|---|
| `list_tables`, `describe_table` | Lets the agent discover what Zetaris holds before querying |
| `sql_query` | Runs the agent's own SELECT against Zetaris, through the guard |
| `summarise_rows` | Counts, sums, gaps and percentiles over a query result, computed by code so the model never does arithmetic |
| `run_check` | Runs any of the eight existing checks (P1 to P8) on a series the agent names |
| `recall_station`, `record_lesson` | Reads and writes H-MEM memory about a station |
| `propose_settlement` | Hands a verdict and its evidence to the gate; returns the gate's answer and reasons |
| `open_inspection` | Creates an inspection with the exact dates and readings to verify |
| `draft_letter` | Writes the letter to the farmer group into the outbox |
| `notify_operator` | Writes a station fault notice into the outbox |
| `request_signoff` | Parks the case for a person, with a summary |
| `escalate` | Hands the case to a person with one precise question |
| `finish_case` | Ends the agent's turn on a case; refused by code unless the case is in a state that allows it |

**The SQL guard.** Every query the agent writes passes through code before it reaches Zetaris:
one statement only; SELECT or WITH only; no CREATE, INSERT, UPDATE, DELETE, DROP, ALTER or CALL
anywhere; only tables and views on an allowed list; a row cap added if missing; a 60-second time
limit. A refused or failed query returns the reason to the agent as a normal result, so it can
correct itself. Every query, refused or not, is written to the case.

The agent sees summaries, not raw rows. A query returning 8,766 days comes back as its row
count, date range, totals, gaps and a sample of ten rows.

**Zetaris gains the data the agent needs.** Prior years of satellite rainfall are registered as
Zetaris views over NASA POWER, so the agent's prior-year comparison is SQL in Zetaris rather than
a separate download. Kitale, Teresina and Dodoma stations are registered alongside Lagos so the
agent can work every sample claim live.

**Done when.** Each tool has its own tests, including a test file of hostile queries the guard
must refuse (writes, multiple statements, comments hiding a second statement, tables off the
list), and the case store walks a claim through every state in a test.

## Phase 2. The investigator

**Built.** It also writes and ticks off a plan, and answers the claims officer mid-case.

**The loop.** The agent receives the claim, the policy terms and anything memory holds about the
station, and a goal: settle the claim correctly, or hand it to a person with one precise
question. It has a step budget, proposed at 16 tool calls and a cost ceiling per case. It works
until it calls `propose_settlement` and the gate accepts, or calls `escalate`, or runs out of
budget, which escalates automatically with what it found so far.

**The gate as a tool.** The agent proposes; the gate checks. If the proposal breaks the contract
or a safety rule, the gate refuses with exact reasons ("Downgraded from Pay: the gauge reported
10 of 31 days; minimum 80%"), and the agent can investigate further or propose again. The gate
can move a proposal toward inspection, never toward paying.

**Checking the agent's numbers.** When the agent's proposal rests on figures ("the prior Julys
range from 41 to 302 mm"), the code reruns the queries it cited and compares. Counts and dates
must match exactly; totals within 0.1 mm, matching how the archive reports rainfall. A mismatch
goes back to the agent with what was wrong, once. A second mismatch sends the case to an
inspector with the mismatch written down.

**Record and replay.** Every live model answer and Zetaris result is saved with the case. The
same case can be replayed without Nightshift or Zetaris, and the desk labels it as a replay. The
hosted site runs replays of real live investigations rather than a rules stand-in.

**Done when.** On the Lagos claim, live, the agent writes its own queries, finds the 21 silent
days and the disagreement, compares prior years, and either resolves the disagreement with
numbers the code reproduces or escalates with a specific question. The same run replays offline
and reaches the same result.

## Phase 3. The end-to-end handler

**Built.** Inspection, report, re-investigation, sign-off, letters and operator notices.

**After the verdict, the agent acts.**
- **Pay or pay anyway**, at or under the threshold: releases payment through the gate, drafts the
  letter, closes the case. Above the threshold: parks it for sign-off, then completes once
  approved.
- **Inspect**: opens an inspection naming the exact dates and readings to verify, holds payment,
  writes to the group explaining the delay.
- **Do not pay**: always parks for sign-off with the strongest case for paying attached.
- **A failing gauge**, in any outcome: notifies the station operator with the silent dates.

**The inspection comes back.** An inspector's report is submitted on the desk as text and
optional readings. The agent reads it, reopens its investigation with the new evidence, proposes
a settlement, and the close-out goes to sign-off.

**Memory changes behaviour.** A station caught with false zeros is recorded. The next case on
that station starts by checking for them, and the trail shows the agent doing so because of what
it remembered.

**Done when.** A test drives Lagos from claim to closed: agent investigates, opens an
inspection, a test report arrives, the agent re-investigates and proposes, a person signs off,
the letter lands in the outbox and the case closes. Each step is in the case record.

## Phase 4. The evaluation, rebuilt for an agent

**Next.** Not built yet.

**New cases where the satellite is wrong.** Every current fault is injected into the gauge, so an
agent that always trusts the satellite would look perfect. Add cases with injected false dry days
in the satellite, and satellite totals pushed far outside the place's prior-year range while the
gauge record is complete. Built first in this phase and run against today's code, so the
baseline is measured before the agent.

**What is measured.**
- Final verdicts: zero wrong payouts, zero missed payouts, cases needlessly sent to inspection.
- The path: did it query what the case needed, did it repeat itself, did it cite numbers that
  reproduce, how many steps and how much it cost.
- Satellite-fault cases: does it side with the gauge or escalate, rather than trusting the
  satellite by habit.

**Two runs, compared.** The full case set on replay, and the hard cases live. The difference is
what the agent contributes, written down whatever it shows. If the agent causes even one wrong
payout, that is reported as it is and the gate's rules are tightened.

**Done when.** `eval/results.md` reports both runs, including the satellite-fault cases, and
`npm run check` passes.

## Phase 5. The desk

**Built, apart from Queue.** Watch shipped as Stations beside Claims; the Investigation tab also holds the plan and the conversation.

Same design system, more of the work visible:

- **Investigation tab**, replacing Trail: the agent's steps as a readable timeline, each query
  shown with its SQL in a sheet, each finding in a sentence, live while it runs.
- **Decision tab**: the agent's proposal, the gate's answer with any downgrade and its reason, and
  the sign-off controls where one is pending.
- **Actions tab**: the inspection with its dates and status, the letters and operator notices in
  the outbox, and the form to submit an inspector's report.
- **Queue**, a new top-level view: every case waiting on a person, oldest first.
- **Watch**, a new top-level view: every insured station and its state (healthy, quiet, diverging)
  with the cases the watcher opened.
- Evidence and Memory tabs stay.

**Done when.** The phase 3 walkthrough can be done entirely from the desk, on a phone and on a
laptop, in both themes, passing the HIG checklist and the anti-slop pass.

## Phase 6. The watcher

**Built.** It opens the Lagos watch case on 4 July and every later claim starts with it in the agent's brief. The agent does not yet investigate a watch case on its own before a claim.

**What it does.** For every insured station inside its cover window, once a day: query Zetaris
for the latest gauge days and the satellite. Open a watch case when the gauge is silent for three
days running, or when gauge and satellite disagree beyond the P6 threshold. The agent then
investigates early, notifies the operator, and attaches its findings so a later claim starts
half-done.

**Showing it honestly.** The real records are historical, so the watcher runs against a
simulated calendar stepping through July 2025 day by day, labelled as a replay of the season. On
day 3 the Lagos gauge goes quiet and the watcher opens its case that day.

**Done when.** Stepping the simulated calendar through July 2025 opens the Lagos watch case on
the first silent stretch, the operator notice lands in the outbox, and a claim filed afterwards
starts from the watch case's findings.

## Phase 7. The front page

**Agent story built.** The watcher scene waits until after this round.

Storyboard first, for approval, before code. The camera journey and look stay; the story changes
from a checking tool to an agent working the case. Frames expected to change: the opening
promise, Record and Storm (the agent finding the silent days and the missed storm itself),
Checked (the agent investigating, its own query being written), a new watcher scene (the gauge
falls quiet on day 3 and the agent notices that night), and Fair (each outcome card shows what
the agent then does).

**Done when.** The storyboard is approved and the built page passes the same checks as the last
build: every frame at desktop and phone size, no sideways scroll, reduced motion, clean copy scan.

## Phase 8. Documents, deployment and video

- `README.md`, `Architecture.md`, `SPONSORS.md` and `DESIGN.md` rewritten to match the agent.
- The hosted copy redeployed, serving replays of real live investigations.
- The demo script rewritten for the agent and the new desk, then the recording, with live
  Zetaris on camera.
- The Zetaris Demo Challenge cut, with the 40 to 60 second segment in Jadon's own words.

**Done when.** A fresh checkout runs with `npm ci && npm start`, the hosted copy matches it, and
the videos are recorded from the build as it stands.

---

## Cost

- The model sees summaries, never thousands of rows.
- Code does every calculation.
- A step budget and cost ceiling per case, enforced by code.
- Easy cases are cheap by nature: a clean record takes the agent a few steps.
- Live runs are recorded once and replayed for tests, evaluation and the hosted site.
- Live evaluation runs only on the hard cases.

## Open questions

[NEEDS CLARIFICATION: which model or pair, decided by the phase 0 trial.]

[NEEDS CLARIFICATION: can Zetaris issue a read-only user? Decides whether the SQL guard is the
only protection.]

[NEEDS CLARIFICATION: the Zetaris Demo Challenge scores "working with SpaceXSI's coding agents"
(Cursor with Grok or Composer). Pluvia is built in Claude Code. Earning those points honestly
means building a real piece in Cursor; the SQL guard or the watcher's queries would suit. Jadon
decides whether to do that.]

[NEEDS CLARIFICATION: the ₦1,000,000 sign-off threshold is a proposal.]

## Files this touches

New: `app/agent/` (loop, tools, SQL guard, replay), `app/cases/` (store and state machine),
`app/watch/` (watcher), tests for each. Changed: `app/orchestrator.ts` (replaced by the agent
loop), `app/agents/policyGate.ts` (proposal checking, reasons), `app/adapters/nightshift.ts`
(tools, record and replay), `app/adapters/zetaris.ts` (guarded queries), `scripts/register_zetaris.ts`
(prior years, more stations), `app/server.ts` (case, sign-off, inspection and watch routes),
`public/desk.html`, `public/app.js`, `public/styles.css`, `public/index.html`,
`public/landing.js`, `public/landing.css`, `eval/`, and the four documents.
