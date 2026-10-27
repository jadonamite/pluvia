import { describe, it, expect } from 'vitest';
import { guardSql } from '../app/agent/sqlGuard.js';

const refused = (sql: string) => {
  const result = guardSql(sql);
  return result.ok ? '' : result.reason;
};

describe('SQL guard', () => {
  it('passes a read-only query over the registered views and adds a row cap', () => {
    const result = guardSql("SELECT COUNT(*) FROM pluvia.ghcn_prcp WHERE station_id = 'NIM00065201';");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sql).toMatch(/LIMIT 2000$/);
  });

  it('keeps a limit the agent wrote', () => {
    const result = guardSql('SELECT * FROM pluvia.power_lagos_2025_daily LIMIT 5');
    expect(result.ok && result.sql.endsWith('LIMIT 5')).toBe(true);
  });

  it('allows common table expressions and joins between views', () => {
    expect(guardSql(
      'WITH g AS (SELECT obs_date, mm FROM pluvia.ghcn_prcp) SELECT * FROM g JOIN pluvia.power_lagos_2025_daily p ON g.obs_date = p.obs_date'
    ).ok).toBe(true);
  });

  it.each([
    ['DROP VIEW pluvia.ghcn_prcp', 'Only SELECT'],
    ['SELECT 1 FROM pluvia.claims; DROP VIEW pluvia.claims', 'one statement'],
    ['SELECT 1 FROM pluvia.claims /* ; */ ; DELETE FROM pluvia.claims', 'one statement'],
    ['SELECT 1 FROM pluvia.claims -- harmless\n; INSERT INTO pluvia.claims VALUES (1)', 'one statement'],
    ['WITH x AS (SELECT 1) INSERT INTO pluvia.claims SELECT * FROM x', 'INSERT'],
    ['SELECT * FROM GHCN_S3.station_nim00065201', 'not an allowed table'],
    ['SELECT * FROM pluvia.secrets', 'not an allowed table'],
    ['SELECT * FROM other.catalog.table', 'not an allowed table'],
    ['SELECT 7', 'Query a pluvia view'],
    ['SET spark.sql.x = 1', 'Only SELECT'],
    ['', 'empty'],
  ])('refuses %s', (sql, reason) => {
    expect(refused(sql)).toContain(reason);
  });

  it('reads FROM inside EXTRACT as part of the function', () => {
    expect(guardSql('SELECT EXTRACT(YEAR FROM obs_date) AS y, SUM(mm) FROM pluvia.power_lagos_2025_prior_daily WHERE EXTRACT(MONTH FROM obs_date) = 7 GROUP BY EXTRACT(YEAR FROM obs_date)').ok).toBe(true);
    expect(refused('SELECT EXTRACT(YEAR FROM obs_date) FROM GHCN_S3.raw')).toContain('not an allowed table');
  });

  it('does not mistake words inside quoted text for commands', () => {
    expect(guardSql("SELECT * FROM pluvia.claims WHERE event_text = 'please drop by; update us'").ok).toBe(true);
  });
});
