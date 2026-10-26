# Sponsor technology use

Pluvia reviews the rainfall record behind a crop-insurance claim. Zetaris is
the sole live data path. Meterless H-MEM stores precedents and station lessons.
Nightshift is the primary live model provider; NVIDIA Nemotron is reached through
Nightshift. The sample application executes real SQL, probes, contract rules and
memory operations using cached rainfall and a deterministic model stand-in.

## What is proven today

| Integration | Verified offline | Awaiting credentials |
|---|---|---|
| Zetaris | Registration generation, source-schema checks, adapter request/response tests and the DataAgent SQL executed against DuckDB snapshots | Authenticated registration, schema inspection and an end-to-end claim through the live Zetaris service |
| Meterless H-MEM | Official conformance: 13/13; persistent recall across separate processes; conflict queue integrated with the inspection decision | Nothing for the local engine; it requires no provider credentials |
| Nightshift | Adapter tests for route selection, returned serving-model evidence, retries and validation fallback; per-call traces in the sample loop | Authenticated model discovery and a real completion through the configured route |
| NVIDIA | The Nightshift integration can request the configured Nemotron route | A response or Nightshift receipt proving which NVIDIA model actually served the claim |

These are different kinds of proof. DuckDB execution does not establish that a
Zetaris registration succeeded. `sample-rules` is deterministic application code;
it is not NVIDIA inference or a recorded Nemotron answer.

## Zetaris: one live query boundary

The live DataAgent sends SQL through `app/adapters/zetaris.ts` to
`POST /sql-editor/sqls/run`. Policies, claims, station metadata, NOAA ground
rainfall and independent NASA satellite rainfall all pass through that boundary.
The agents do not fetch NOAA or NASA directly. Direct-download scripts prepare
the offline evidence; they are outside the live agent path.

`scripts/register_zetaris.ts` generates the registrations. The checked-in
[SQL bundle](scripts/register_zetaris.sql) contains the actual statements for the
demonstration register. For example:

```sql
CREATE LIGHTNING DATABASE GHCN_S3 DESCRIBE BY 'Pluvia GHCN_S3';

CREATE LIGHTNING FILESTORE TABLE station_nim00065201 FROM GHCN_S3
FORMAT CSV OPTIONS (
  PATH "s3a://noaa-ghcn-pds/csv/by_station/NIM00065201.csv",
  inferSchema "true", header "true", isS3BucketPublic "true",
  useS3PathStyleAccess "true", s3Endpoint "s3.us-east-1.amazonaws.com"
);

CACHE TABLE GHCN_S3.station_nim00065201;

CREATE SCHEMASTORE CONTAINER pluvia;

CREATE SCHEMASTORE VIEW ghcn_prcp WITH CONTAINER pluvia AS
SELECT ID AS station_id,
       to_date(CAST(DATE AS STRING), 'yyyyMMdd') AS obs_date,
       CAST(DATA_VALUE AS DOUBLE) / 10.0 AS mm,
       M_FLAG AS m_flag, Q_FLAG AS q_flag, S_FLAG AS s_flag
FROM GHCN_S3.station_nim00065201 WHERE ELEMENT = 'PRCP';
```

The division by ten converts NOAA's precipitation units exactly once. Register
objects use a REST table and an exploded view:

```sql
CREATE LIGHTNING DATABASE PLUVIA_REGISTER
DESCRIBE BY 'Pluvia PLUVIA_REGISTER';

CREATE LIGHTNING REST TABLE policies_raw FROM PLUVIA_REGISTER REQUEST(
  endpoint 'http://host.docker.internal:8000/register/policies.json',
  method "get", response_type "json", http_encoding "URLENCODED"
) HEADER(user-agent 'Pluvia contact@example.invalid') BODY();

CACHE TABLE PLUVIA_REGISTER.policies_raw;

CREATE SCHEMASTORE VIEW policies WITH CONTAINER pluvia AS
SELECT p.* FROM PLUVIA_REGISTER.policies_raw
LATERAL VIEW explode(policies) AS p;
```

The committed contact is a placeholder. Generate deployment statements with a
configured `CONTACT_EMAIL` and a `REGISTER_BASE_URL` reachable from Zetaris.
Claims and stations use the same registration pattern. The independent satellite
registration for the Lagos contractual window is:

```sql
CREATE LIGHTNING DATABASE POWER_REST DESCRIBE BY 'Pluvia POWER_REST';

CREATE LIGHTNING REST TABLE power_lagos_2025 FROM POWER_REST REQUEST(
  endpoint 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=3.321&latitude=6.577&start=20250701&end=20250731&format=JSON&time-standard=UTC',
  method "get", response_type "json", http_encoding "URLENCODED"
) HEADER(user-agent 'Pluvia contact@example.invalid') BODY();

CACHE TABLE POWER_REST.power_lagos_2025;

CREATE SCHEMASTORE VIEW power_lagos_2025_daily WITH CONTAINER pluvia AS
SELECT to_date(d, 'yyyyMMdd') AS obs_date,
       CASE WHEN v = -999 THEN NULL ELSE v END AS mm,
       'power_lagos_2025_daily' AS source_id,
       6.577 AS latitude, 3.321 AS longitude
FROM POWER_REST.power_lagos_2025
LATERAL VIEW explode(from_json(
  to_json(properties.parameter.IMERG_PRECTOT), 'map<string,double>'
)) AS d, v;
```

`IMERG_PRECTOT` with `time-standard=UTC` is the independent comparison. Fill value
`-999` becomes missing data. Source identifiers and coordinates remain in the
view so the application can reject evidence from the wrong point. The full bundle
also registers prior years for contextual evidence requests.

The registrar checks metadata, submits one statement at a time, caches sources
and verifies NOAA columns before creating dependent views. Passing the local
statement checks is not a live registration result.

## Meterless engine: H-MEM in the claims workflow

Pluvia vendors the unmodified H-MEM reference at revision
`1742dec56a66e58eef9dda2d2b865823758ca8cd`, retaining Apache 2.0 attribution.
`app/memory/index.ts` exports its facade; `pluviaMemory.ts` adds claim-scoped
precedents, station lessons and persistence.

Before planning, the next claim recalls the previous station lesson. In the
rehearsed sample sequence, the first Lagos claim requested prior-year evidence;
the second recalled that lesson and skipped the extra round. It still ran fresh
probes and returned inspection. Recall cannot authorize payment or clear a
failed current-window probe.

H-MEM's conflict service resolves only at confidence 0.70 or above. An open
conflict feeds the gate's inspection outcome. Officer feedback changes memory
reliability; it does not rewrite a decision or payout.

Run `npm run conformance`. It executes the official runner and vectors under
`scripts/vendor/hmem/` against `app/memory/index.ts`, prints the scorecard and
writes it to **`logs/hmem-conformance.txt`**. The observed scorecard is:

| Group | Checks passed |
|---|---:|
| Record validation | 2/2 |
| Feedback deltas and confidence bounds | 5/5 |
| Ranking order | 2/2 |
| Sleep guardrails | 1/1 |
| Conflict gate | 1/1 |
| Ledger audit | 1/1 |
| Dream approval boundary | 1/1 |
| Total | 13/13 |

The complete output is regenerated locally rather than committed with a machine
path. Application tests separately exercise cross-process recall and the
independent-satellite guards around refusals.

## Nightshift: primary live provider and model evidence

`app/adapters/nightshift.ts` uses Nightshift's OpenAI-compatible API. Configure
`METERLESS_BASE_URL`, `METERLESS_RUNTIME_TOKEN` and the exact `METERLESS_MODEL`
route returned by its authenticated `GET /v1/models`. Health requires that exact
`meterless/*` route to appear; an open port alone is insufficient.

Intake, planning, audit explanation, adjudication and reporting use this model
adapter. Data retrieval, probes and payout computation are code. Each model
attempt logs the requested **route**. A successful call logs **model** from
`response.model`, plus a `receipt` and `meterless` metadata when returned.
`app/orchestrator.ts` sets `model_identity` to `route_only` for a returned
`meterless/*` string and `served_identifier` otherwise. This is a prefix
classification of the returned field, not independent verification of a backend.
An alias or opaque identifier alone does not prove Nemotron served the call;
retain the Nightshift receipt for that proof.

Missing serving-model evidence is rejected by the adapter. Failed calls retain
the requested route and are marked unavailable; they receive no invented model
name. Invalid model JSON receives one validation retry, then a traced
deterministic fallback. The financial gate remains independent of model prose.

Offline traces show the actual serving adapter as `sample-rules`. Live route and
served-model logging are tested with mock responses; no credentialed Nightshift
completion is claimed today.

## NVIDIA through Nightshift

Select a Nemotron route in Nightshift and place the NVIDIA provider key only in
Nightshift's Providers settings. Pluvia holds no NVIDIA key and makes no direct
NVIDIA request. Nightshift owns that provider connection. The first live claim
must retain its serving-model response or receipt before a Nemotron execution
claim can be made.

## Development tools and the combined use

Cursor is optional under the binding rules and was not used for this work, so no
Cursor credit is claimed. The pre-existing H-MEM source and official runner are
attributed; Pluvia's adapters, claim loop, probes and contract gate are the
application integration.

The combined feature is a review that keeps evidence attached to money: Zetaris
returns source data and policy terms, Nightshift proposes the next evidence step,
H-MEM recalls what happened on the previous claim, and deterministic code decides
whether that evidence can settle the contract. Neither remembered confidence nor
model wording can permit a refusal without complete independent satellite data.
