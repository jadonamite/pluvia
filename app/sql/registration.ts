import { setTimeout as delay } from 'node:timers/promises';
import type { QueryAdapter } from '../adapters/contracts.js';

export interface Registration {
  container: string;
  name?: string;
  sql: string;
  // Omitted where Zetaris has no listing (SchemaStore containers); a duplicate CREATE then
  // reports that the object already exists and is counted as skipped.
  metadata_sql?: string;
  always?: boolean;
  verify_columns?: string[];
}

export async function registerStatements(
  adapter: QueryAdapter,
  items: Registration[],
  options: { signal?: AbortSignal; wait?: (ms: number) => Promise<void> } = {}
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const expected = (item.name ?? item.container).toLowerCase();
    // SHOW TABLES FROM <db> lists qualified names such as GHCN_S3.station_x.
    const exists = async () => {
      if (!item.metadata_sql) return false;
      const rows = await adapter.query(item.metadata_sql, {
        signal: options.signal,
      });
      return rows.some((row) =>
        Object.values(row).some((val) => {
          const name = String(val).toLowerCase();
          return name === expected || name.endsWith(`.${expected}`);
        })
      );
    };

    let attemptedWrite = false;
    if ((await exists()) && !item.always) {
      skipped++;
    } else {
      attemptedWrite = true;
      try {
        await adapter.query(item.sql, { signal: options.signal });
        created++;
      } catch (error) {
        const duplicate = /already exists/i.test(
          (error as { detail?: unknown }).detail?.toString() ?? ''
        );
        if (!/^\s*CREATE\b/i.test(item.sql) || !(duplicate || (await exists()))) {
          throw error;
        }
        skipped++;
      }
    }

    if (item.verify_columns) {
      const columns = await adapter.query(
        `DESCRIBE ${item.container}.${item.name}`,
        { signal: options.signal }
      );
      const names = new Set(
        columns.flatMap((row) =>
          Object.values(row).map((val) => String(val).toUpperCase())
        )
      );
      if (item.verify_columns.some((name) => !names.has(name))) {
        throw new Error(
          `Source schema mismatch: ${item.container}.${item.name}`
        );
      }
    }

    if (attemptedWrite) {
      if (options.wait) {
        await options.wait(5000);
      } else {
        await delay(5000, undefined, { signal: options.signal });
      }
    }
  }

  return { created, skipped };
}
