CREATE LIGHTNING DATABASE GHCN_S3 DESCRIBE BY 'Pluvia GHCN_S3';

CREATE LIGHTNING DATABASE POWER_REST DESCRIBE BY 'Pluvia POWER_REST';

CREATE LIGHTNING DATABASE PLUVIA_REGISTER DESCRIBE BY 'Pluvia PLUVIA_REGISTER';

CREATE SCHEMASTORE CONTAINER pluvia;

CREATE LIGHTNING FILESTORE TABLE station_nim00065201 FROM GHCN_S3 FORMAT CSV OPTIONS (PATH "s3a://noaa-ghcn-pds/csv/by_station/NIM00065201.csv", inferSchema "true", header "true", isS3BucketPublic "true", useS3PathStyleAccess "true", s3Endpoint "s3.us-east-1.amazonaws.com");

CACHE TABLE GHCN_S3.station_nim00065201;

CREATE SCHEMASTORE VIEW ghcn_prcp WITH CONTAINER pluvia AS SELECT ID AS station_id, to_date(CAST(DATE AS STRING), 'yyyyMMdd') AS obs_date, CAST(DATA_VALUE AS DOUBLE) / 10.0 AS mm, M_FLAG AS m_flag, Q_FLAG AS q_flag, S_FLAG AS s_flag FROM GHCN_S3.station_nim00065201 WHERE ELEMENT = 'PRCP';

CREATE LIGHTNING REST TABLE policies_raw FROM PLUVIA_REGISTER REQUEST(endpoint 'http://host.docker.internal:8000/register/policies.json', method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent 'Pluvia contact@example.invalid') BODY();

CACHE TABLE PLUVIA_REGISTER.policies_raw;

CREATE SCHEMASTORE VIEW policies WITH CONTAINER pluvia AS SELECT p.* FROM PLUVIA_REGISTER.policies_raw LATERAL VIEW explode(policies) AS p;

CREATE LIGHTNING REST TABLE claims_raw FROM PLUVIA_REGISTER REQUEST(endpoint 'http://host.docker.internal:8000/register/claims.json', method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent 'Pluvia contact@example.invalid') BODY();

CACHE TABLE PLUVIA_REGISTER.claims_raw;

CREATE SCHEMASTORE VIEW claims WITH CONTAINER pluvia AS SELECT p.* FROM PLUVIA_REGISTER.claims_raw LATERAL VIEW explode(claims) AS p;

CREATE LIGHTNING REST TABLE stations_raw FROM PLUVIA_REGISTER REQUEST(endpoint 'http://host.docker.internal:8000/register/stations.json', method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent 'Pluvia contact@example.invalid') BODY();

CACHE TABLE PLUVIA_REGISTER.stations_raw;

CREATE SCHEMASTORE VIEW stations WITH CONTAINER pluvia AS SELECT p.* FROM PLUVIA_REGISTER.stations_raw LATERAL VIEW explode(stations) AS p;

CREATE LIGHTNING REST TABLE power_lagos_2025 FROM POWER_REST REQUEST(endpoint 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=3.321&latitude=6.577&start=20250701&end=20250731&format=JSON&time-standard=UTC', method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent 'Pluvia contact@example.invalid') BODY();

CACHE TABLE POWER_REST.power_lagos_2025;

CREATE SCHEMASTORE VIEW power_lagos_2025_daily WITH CONTAINER pluvia AS SELECT to_date(d, 'yyyyMMdd') AS obs_date, CASE WHEN v = -999 THEN NULL ELSE v END AS mm, 'power_lagos_2025_daily' AS source_id, 6.577 AS latitude, 3.321 AS longitude FROM POWER_REST.power_lagos_2025 LATERAL VIEW explode(from_json(to_json(properties.parameter.IMERG_PRECTOT), 'map<string,double>')) AS d, v;

CREATE LIGHTNING REST TABLE power_lagos_2025_prior FROM POWER_REST REQUEST(endpoint 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=IMERG_PRECTOT&community=AG&longitude=3.321&latitude=6.577&start=20010101&end=20241231&format=JSON&time-standard=UTC', method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent 'Pluvia contact@example.invalid') BODY();

CACHE TABLE POWER_REST.power_lagos_2025_prior;

CREATE SCHEMASTORE VIEW power_lagos_2025_prior_daily WITH CONTAINER pluvia AS SELECT to_date(d, 'yyyyMMdd') AS obs_date, CASE WHEN v = -999 THEN NULL ELSE v END AS mm, 'power_lagos_2025_prior_daily' AS source_id, 6.577 AS latitude, 3.321 AS longitude FROM POWER_REST.power_lagos_2025_prior LATERAL VIEW explode(from_json(to_json(properties.parameter.IMERG_PRECTOT), 'map<string,double>')) AS d, v;
