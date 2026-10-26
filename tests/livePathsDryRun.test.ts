import { describe, it, expect } from 'vitest';
import {
  runDryRunValidation,
  validateEndpointUrl,
  validateStationPrefix,
  validateZetarisStatement,
} from '../scripts/dry_run_check.js';
import { identifier, literal } from '../app/sql/identifiers.js';

describe('live paths dry-run verification without credentials', () => {
  it('validates all Zetaris registration statements and NASA POWER endpoints', async () => {
    const result = await runDryRunValidation();
    expect(result.statementCount).toBeGreaterThan(0);
    expect(result.endpointCount).toBeGreaterThan(0);
    expect(result.stationCount).toBeGreaterThan(0);
    expect(result.policyCount).toBeGreaterThan(0);
  });

  describe('identifier quoting and SQL injection defense', () => {
    it('accepts valid SQL identifiers', () => {
      expect(identifier('power_lagos_2025')).toBe('power_lagos_2025');
      expect(identifier('GHCN_S3')).toBe('GHCN_S3');
    });

    it('rejects identifiers with illegal characters or SQL injection attempts', () => {
      expect(() => identifier('table; DROP DATABASE')).toThrow(/Invalid SQL identifier/);
      expect(() => identifier('table name')).toThrow(/Invalid SQL identifier/);
      expect(() => identifier('table-name')).toThrow(/Invalid SQL identifier/);
    });

    it('escapes SQL literals safely', () => {
      expect(literal('hello')).toBe("'hello'");
      expect(literal("O'Reilly")).toBe("'O''Reilly'");
    });

    it('rejects literals with embedded newlines', () => {
      expect(() => literal('line1\nline2')).toThrow(/Invalid SQL literal/);
      expect(() => literal('line1\rline2')).toThrow(/Invalid SQL literal/);
    });
  });

  describe('NASA POWER endpoint verification', () => {
    it('accepts properly formed POWER endpoints', () => {
      const valid =
        'https://power.larc.nasa.gov/api/temporal/daily/point' +
        '?parameters=IMERG_PRECTOT&community=AG' +
        '&longitude=3.321&latitude=6.577&start=20250701&end=20250731&format=JSON&time-standard=UTC';
      expect(() => validateEndpointUrl(valid)).not.toThrow();
    });

    it('fails if parameters is not strictly IMERG_PRECTOT', () => {
      const nonIndependent =
        'https://power.larc.nasa.gov/api/temporal/daily/point' +
        '?parameters=PRECTOTCORR&community=AG' +
        '&longitude=3.321&latitude=6.577&start=20250701&end=20250731&format=JSON&time-standard=UTC';
      expect(() => validateEndpointUrl(nonIndependent)).toThrow(
        /must be strictly 'IMERG_PRECTOT'/
      );
    });

    it('fails loudly if time-standard=UTC is missing', () => {
      const missingUtc =
        'https://power.larc.nasa.gov/api/temporal/daily/point' +
        '?parameters=IMERG_PRECTOT&community=AG' +
        '&longitude=3.321&latitude=6.577&start=20250701&end=20250731&format=JSON';
      expect(() => validateEndpointUrl(missingUtc)).toThrow(
        /must include 'time-standard=UTC'/
      );
    });
  });

  describe('Fill value -999 handling', () => {
    it('accepts views that map -999 to NULL', () => {
      const viewSql =
        'CREATE SCHEMASTORE VIEW power_lagos_2025_daily WITH CONTAINER pluvia AS ' +
        "SELECT to_date(d, 'yyyyMMdd') AS obs_date, " +
        'CASE WHEN v = -999 THEN NULL ELSE v END AS mm, ' +
        "'power_lagos_2025_daily' AS source_id, 6.577 AS latitude, 3.321 AS longitude " +
        'FROM POWER_REST.power_lagos_2025 ' +
        "LATERAL VIEW explode(from_json(to_json(properties.parameter.IMERG_PRECTOT), 'map<string,double>')) AS d, v";
      expect(() => validateZetarisStatement(viewSql)).not.toThrow();
    });

    it('fails loudly if -999 fill value is not nullified', () => {
      const badViewSql =
        'CREATE SCHEMASTORE VIEW power_lagos_2025_daily WITH CONTAINER pluvia AS ' +
        "SELECT to_date(d, 'yyyyMMdd') AS obs_date, v AS mm " +
        'FROM POWER_REST.power_lagos_2025';
      expect(() => validateZetarisStatement(badViewSql)).toThrow(
        /missing -999 fill-value handling/
      );
    });
  });

  describe('NI country prefix verification', () => {
    it('accepts Nigerian stations with NI prefix', () => {
      expect(() =>
        validateStationPrefix('NIM00065201', 'MURTALA MUHAMMED')
      ).not.toThrow();
    });

    it('fails loudly on Nigerian station using NG prefix (Niger)', () => {
      expect(() =>
        validateStationPrefix('NGM00065201', 'LAGOS AIRPORT')
      ).toThrow(/prefix 'NI'/);
    });
  });
});
